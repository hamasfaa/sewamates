import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import type { Update } from "grammy/types";
import type { Database } from "@/src/db";
import * as s from "@/src/db/schema";
import { testDatabase, resetDatabase, user, campusId } from "./helpers/database";
import { startLogin, consumeLogin, findSession, revokeSession } from "@/src/services/auth-service";
import { hash, randomToken, decrypt } from "@/src/lib/crypto";
import { processTelegramUpdate } from "@/src/services/telegram-service";
import {
  decideVerification,
  verificationQueue,
  verificationDetail,
} from "@/src/services/admin-service";
import {
  requestPayoutChange,
  submitVerification,
  updateProfile,
} from "@/src/services/profile-service";
import { changeSettings, getSettings } from "@/src/services/settings-service";
import { expireLoginRequests } from "@/src/jobs/expire-login-requests";
import { signUpload } from "@/src/lib/storage";

const mocks = vi.hoisted(() => ({
  sendMessage: vi.fn().mockResolvedValue({}),
  answerCallbackQuery: vi.fn().mockResolvedValue(true),
  sendActionConfirmation: vi.fn().mockResolvedValue(undefined),
  download: vi.fn(),
  createSignedUploadUrl: vi.fn(),
}));
vi.mock("@/src/services/telegram-api", () => ({
  telegramApi: () => mocks,
  sendActionConfirmation: mocks.sendActionConfirmation,
}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    storage: {
      from: () => ({
        download: mocks.download,
        createSignedUploadUrl: mocks.createSignedUploadUrl,
        createSignedUrl: async () => ({ data: { signedUrl: "https://storage.test/signed" } }),
        getPublicUrl: () => ({ data: { publicUrl: "https://storage.test/avatar.jpg" } }),
      }),
    },
  }),
}));
let db: Database,
  close: () => Promise<void>,
  updateSequence = 0;
beforeAll(async () => {
  ({ db, close } = await testDatabase());
});
afterAll(async () => {
  await close?.();
});
beforeEach(async () => {
  await resetDatabase(db);
  vi.clearAllMocks();
  process.env.ACCOUNT_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  process.env.SUPABASE_URL = "https://storage.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test";
  mocks.download.mockResolvedValue({
    data: new Blob([new Uint8Array([255, 216, 255, 224, 0, 16, 74, 70, 73, 70, 0, 0])]),
    error: null,
  });
  mocks.createSignedUploadUrl.mockResolvedValue({
    data: { signedUrl: "https://storage.test/upload?token=upload-only" },
    error: null,
  });
});
function message(sender: number, content: object): Update {
  return {
    update_id: ++updateSequence,
    message: {
      message_id: 1,
      date: 1,
      from: { id: sender, is_bot: false, first_name: "Teman" },
      chat: { id: sender, type: "private", first_name: "Teman" },
      ...content,
    },
  } as Update;
}
function callback(sender: number, data: string): Update {
  return {
    update_id: ++updateSequence,
    callback_query: {
      id: `cb${updateSequence}`,
      from: { id: sender, is_bot: false, first_name: "Teman" },
      chat_instance: "test",
      data,
      message: {
        message_id: 2,
        date: 1,
        chat: { id: sender, type: "private", first_name: "Teman" },
      },
    },
  } as Update;
}
async function readyLogin(role: "user" | "admin" = "user") {
  const actor = await user(db, { role }),
    nonce = randomToken(),
    login = await startLogin(db, nonce, "127.0.0.1");
  await db
    .update(s.loginRequests)
    .set({ status: "disetujui", userId: actor.id })
    .where(eq(s.loginRequests.id, login.id));
  return { actor, nonce, login };
}
async function ticket(userId: string, purpose: "identity_card" | "identity_selfie") {
  const path = `${userId}/${purpose}/${crypto.randomUUID()}.jpg`;
  await db.insert(s.uploadTickets).values({
    userId,
    path,
    purpose,
    contentType: "image/jpeg",
    expiresAt: new Date(Date.now() + 3600000),
  });
  return path;
}
describe("Tiket unggah foto", () => {
  it("menerbitkan URL unggah dan tiket milik pengguna ketika Storage dikonfigurasi", async () => {
    const actor = await user(db);
    const result = await signUpload(db, actor.id, {
      purpose: "avatar",
      contentType: "image/jpeg",
      size: 1024,
    });
    expect(result.signedUrl).toBe("https://storage.test/upload?token=upload-only");
    expect(result.path.startsWith(`${actor.id}/avatar/`)).toBe(true);
    const [ticket] = await db.select().from(s.uploadTickets);
    expect(ticket).toMatchObject({
      userId: actor.id,
      path: result.path,
      purpose: "avatar",
      used: false,
    });
  });
});

describe("Login dan sesi", () => {
  it("mengikat login ke nonce browser, menyimpan hash saja, dan hanya menerbitkan satu sesi", async () => {
    const { nonce, login } = await readyLogin();
    const [stored] = await db.select().from(s.loginRequests);
    expect(stored.tokenHash).toBe(hash(login.token));
    expect(stored.browserNonceHash).toBe(hash(nonce));
    await expect(
      consumeLogin(db, login.id, randomToken(), "browser", "local"),
    ).rejects.toMatchObject({ status: 404 });
    const result = await consumeLogin(db, login.id, nonce, "browser", "local");
    expect(result.status).toBe("authenticated");
    expect(await consumeLogin(db, login.id, nonce, "browser", "local")).toEqual({
      status: "dipakai",
    });
    const rows = await db.select().from(s.sessions);
    expect(rows).toHaveLength(1);
    if (result.status === "authenticated") {
      expect(rows[0].tokenHash).toBe(hash(result.token));
      expect(await findSession(db, result.token)).not.toBeNull();
    }
  });
  it("membatasi login per IP meskipun browser berubah", async () => {
    for (let i = 0; i < 5; i++) await startLogin(db, randomToken(), "same-ip");
    await expect(startLogin(db, randomToken(), "same-ip")).rejects.toMatchObject({ status: 429 });
  });
  it("membatasi login per browser meskipun IP berubah", async () => {
    const nonce = randomToken();
    for (let i = 0; i < 5; i++) await startLogin(db, nonce, `ip-${i}`);
    await expect(startLogin(db, nonce, "another-ip")).rejects.toMatchObject({ status: 429 });
  });
  it("menolak token kedaluwarsa tanpa menunggu job", async () => {
    const { nonce, login } = await readyLogin();
    await db
      .update(s.loginRequests)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(s.loginRequests.id, login.id));
    expect(await consumeLogin(db, login.id, nonce, "browser", "local")).toEqual({
      status: "kedaluwarsa",
    });
    expect(await db.select().from(s.sessions)).toHaveLength(0);
  });
  it("membatasi sesi admin 12 jam dan pengguna 30 hari", async () => {
    for (const role of ["user", "admin"] as const) {
      const { nonce, login } = await readyLogin(role),
        result = await consumeLogin(db, login.id, nonce, "browser", "local");
      if (result.status !== "authenticated") throw new Error("Login gagal");
      expect(Math.round((result.expiresAt.getTime() - Date.now()) / 3600000)).toBe(
        role === "admin" ? 12 : 720,
      );
    }
  });
  it("mencegah pencabutan sesi pengguna lain dan menolak sesi yang dicabut", async () => {
    const { actor, nonce, login } = await readyLogin(),
      other = await user(db),
      result = await consumeLogin(db, login.id, nonce, "browser", "local");
    const [session] = await db.select().from(s.sessions);
    await expect(revokeSession(db, other.id, session.id)).rejects.toMatchObject({ status: 404 });
    await revokeSession(db, actor.id, session.id);
    if (result.status === "authenticated") expect(await findSession(db, result.token)).toBeNull();
  });
});
describe("Telegram webhook", () => {
  it("menerima kontak milik pengirim dan menyelesaikan angka pencocokan", async () => {
    const login = await startLogin(db, randomToken(), "local"),
      sender = 991234;
    await processTelegramUpdate(db, message(sender, { text: `/start ${login.token}` }));
    await processTelegramUpdate(
      db,
      message(sender, {
        contact: { phone_number: "628111222333", first_name: "Teman", user_id: sender },
      }),
    );
    await processTelegramUpdate(db, callback(sender, `login:${login.id}:${login.matchCode}`));
    const [request] = await db.select().from(s.loginRequests);
    expect(request.status).toBe("disetujui");
    const [actor] = await db.select().from(s.users);
    expect(actor.telegramUserId).toBe(sender);
    expect(actor.phone).toBe("+628111222333");
  });
  it("menolak kontak pihak lain", async () => {
    const login = await startLogin(db, randomToken(), "local"),
      sender = 991235;
    await processTelegramUpdate(db, message(sender, { text: `/start ${login.token}` }));
    await processTelegramUpdate(
      db,
      message(sender, {
        contact: { phone_number: "628111222333", first_name: "Orang lain", user_id: sender + 1 },
      }),
    );
    expect(await db.select().from(s.users)).toHaveLength(0);
  });
  it("membatalkan login jika angka salah dan menolak persetujuan Telegram lain", async () => {
    const actor = await user(db),
      login = await startLogin(db, randomToken(), "local");
    await processTelegramUpdate(
      db,
      message(actor.telegramUserId!, { text: `/start ${login.token}` }),
    );
    await processTelegramUpdate(
      db,
      callback(actor.telegramUserId! + 1, `login:${login.id}:${login.matchCode}`),
    );
    expect((await db.select().from(s.loginRequests))[0].status).toBe("menunggu");
    await processTelegramUpdate(db, callback(actor.telegramUserId!, `login:${login.id}:00`));
    expect((await db.select().from(s.loginRequests))[0].status).toBe("kedaluwarsa");
  });
  it("deduplikasi update dan mengizinkan retry setelah pengiriman gagal", async () => {
    const update = message(99888, { text: "/bantuan" });
    mocks.sendMessage.mockRejectedValueOnce(new Error("network"));
    await expect(processTelegramUpdate(db, update)).rejects.toThrow("network");
    expect(await db.select().from(s.telegramUpdates)).toHaveLength(0);
    await processTelegramUpdate(db, update);
    expect(await processTelegramUpdate(db, update)).toEqual({ duplicate: true });
    expect(mocks.sendMessage).toHaveBeenCalledTimes(2);
  });
  it("memindahkan tautan hanya setelah angka benar serta mencabut sesi lama", async () => {
    const actor = await user(db),
      nonce = randomToken(),
      login = await startLogin(db, nonce, "local"),
      newSender = 999000;
    await db.insert(s.sessions).values({
      userId: actor.id,
      tokenHash: hash("old-session"),
      expiresAt: new Date(Date.now() + 3600000),
    });
    await processTelegramUpdate(db, message(newSender, { text: `/start ${login.token}` }));
    await processTelegramUpdate(
      db,
      message(newSender, {
        contact: { phone_number: actor.phone, first_name: "Teman", user_id: newSender },
      }),
    );
    expect((await db.select().from(s.users))[0].telegramUserId).toBe(actor.telegramUserId);
    await processTelegramUpdate(db, callback(newSender, `login:${login.id}:${login.matchCode}`));
    expect((await db.select().from(s.users))[0].telegramUserId).toBe(newSender);
    expect((await db.select().from(s.sessions))[0].revokedAt).not.toBeNull();
  });
});
describe("Profil, rekening, dan verifikasi", () => {
  it("mewajibkan persetujuan ketentuan dan mereset verifikasi setelah nama diubah", async () => {
    const actor = await user(db, { termsAcceptedAt: null });
    await expect(updateProfile(db, actor, { name: actor.name, campusId })).rejects.toMatchObject({
      code: "TERMS_REQUIRED",
    });
    await updateProfile(db, actor, { name: actor.name, campusId, acceptTerms: true });
    await db
      .update(s.users)
      .set({ verificationStatus: "terverifikasi" })
      .where(eq(s.users.id, actor.id));
    await updateProfile(db, actor, { name: "Nama Baru", campusId });
    expect((await db.select().from(s.users))[0].verificationStatus).toBe("belum");
  });
  it("menerapkan rekening hanya setelah konfirmasi pemilik lewat bot", async () => {
    const actor = await user(db),
      other = await user(db),
      request = await requestPayoutChange(db, actor, {
        type: "bank",
        provider: "BCA",
        accountNo: "1234567890",
        accountName: actor.name,
      });
    expect(await db.select().from(s.payoutAccounts)).toHaveLength(0);
    expect(
      JSON.stringify((await db.select().from(s.actionConfirmations))[0].payload),
    ).not.toContain("1234567890");
    await processTelegramUpdate(db, callback(other.telegramUserId!, `confirm:${request.id}:yes`));
    expect(await db.select().from(s.payoutAccounts)).toHaveLength(0);
    await processTelegramUpdate(db, callback(actor.telegramUserId!, `confirm:${request.id}:yes`));
    const [account] = await db.select().from(s.payoutAccounts);
    expect(decrypt(account.accountNoEnc)).toBe("1234567890");
    await processTelegramUpdate(db, callback(actor.telegramUserId!, `confirm:${request.id}:yes`));
    expect(await db.select().from(s.payoutAccounts)).toHaveLength(1);
  });
  it("menolak konfirmasi kedaluwarsa dan tombol Tolak tidak menerapkan rekening", async () => {
    const actor = await user(db),
      request = await requestPayoutChange(db, actor, {
        type: "bank",
        provider: "BCA",
        accountNo: "1234567890",
        accountName: actor.name,
      });
    await processTelegramUpdate(db, callback(actor.telegramUserId!, `confirm:${request.id}:no`));
    expect(await db.select().from(s.payoutAccounts)).toHaveLength(0);
    const next = await requestPayoutChange(db, actor, {
      type: "bank",
      provider: "BCA",
      accountNo: "1234567890",
      accountName: actor.name,
    });
    await db
      .update(s.actionConfirmations)
      .set({ expiresAt: new Date(Date.now() - 1) })
      .where(eq(s.actionConfirmations.id, next.id));
    await processTelegramUpdate(db, callback(actor.telegramUserId!, `confirm:${next.id}:yes`));
    expect(await db.select().from(s.payoutAccounts)).toHaveLength(0);
  });
  it("mencegah penggunaan unggahan milik orang lain dan memproses foto milik sendiri sekali", async () => {
    const actor = await user(db),
      other = await user(db),
      foreign = await ticket(other.id, "identity_card"),
      selfie = await ticket(actor.id, "identity_selfie");
    await expect(
      submitVerification(db, actor, {
        cardType: "ktm",
        cardPhotoPath: foreign,
        selfiePath: selfie,
      }),
    ).rejects.toMatchObject({ code: "INVALID_UPLOAD" });
    const card = await ticket(actor.id, "identity_card");
    await submitVerification(db, actor, {
      cardType: "ktm",
      cardPhotoPath: card,
      selfiePath: selfie,
    });
    await expect(
      submitVerification(db, actor, { cardType: "ktm", cardPhotoPath: card, selfiePath: selfie }),
    ).rejects.toMatchObject({ status: 409 });
    expect(await db.select().from(s.identityVerifications)).toHaveLength(1);
    expect(
      (await db.select().from(s.uploadTickets).where(eq(s.uploadTickets.path, card)))[0].used,
    ).toBe(true);
  });
  it("melarang pengguna mengakses antrean dan bukti admin", async () => {
    const actor = await user(db);
    await expect(verificationQueue(db, actor)).rejects.toMatchObject({ status: 403 });
    await expect(verificationDetail(db, actor, crypto.randomUUID())).rejects.toMatchObject({
      status: 403,
    });
  });
  it("mencatat keputusan dan notifikasi dalam transaksi yang sama; review ulang ditolak", async () => {
    const actor = await user(db),
      admin = await user(db, { role: "admin" }),
      [entry] = await db
        .insert(s.identityVerifications)
        .values({
          userId: actor.id,
          cardType: "ktm",
          cardPhotoPath: "private/card",
          selfiePath: "private/selfie",
        })
        .returning();
    await decideVerification(db, admin, entry.id, { decision: "diterima" });
    await expect(
      decideVerification(db, admin, entry.id, { decision: "ditolak", reason: "Foto kurang jelas" }),
    ).rejects.toMatchObject({ status: 409 });
    expect(
      (await db.select().from(s.users).where(eq(s.users.id, actor.id)))[0].verificationStatus,
    ).toBe("terverifikasi");
    expect(await db.select().from(s.adminAuditLogs)).toHaveLength(1);
    expect(await db.select().from(s.notifications)).toHaveLength(1);
  });
  it("dua admin yang memutuskan bersamaan hanya menghasilkan satu keputusan", async () => {
    const actor = await user(db),
      admin1 = await user(db, { role: "admin" }),
      admin2 = await user(db, { role: "admin" }),
      [entry] = await db
        .insert(s.identityVerifications)
        .values({
          userId: actor.id,
          cardType: "ktm",
          cardPhotoPath: "private/card",
          selfiePath: "private/selfie",
        })
        .returning();
    const results = await Promise.allSettled([
      decideVerification(db, admin1, entry.id, { decision: "diterima" }),
      decideVerification(db, admin2, entry.id, {
        decision: "ditolak",
        reason: "Foto kurang jelas",
      }),
    ]);
    expect(results.filter((v) => v.status === "fulfilled")).toHaveLength(1);
    expect(await db.select().from(s.adminAuditLogs)).toHaveLength(1);
  });
  it("penolakan membutuhkan alasan dan pengguna boleh mengajukan ulang", async () => {
    const actor = await user(db),
      admin = await user(db, { role: "admin" }),
      [entry] = await db
        .insert(s.identityVerifications)
        .values({
          userId: actor.id,
          cardType: "ktm",
          cardPhotoPath: "private/card",
          selfiePath: "private/selfie",
        })
        .returning();
    await expect(
      decideVerification(db, admin, entry.id, { decision: "ditolak" }),
    ).rejects.toThrow();
    await decideVerification(db, admin, entry.id, {
      decision: "ditolak",
      reason: "Kartu kurang jelas",
    });
    await submitVerification(db, actor, {
      cardType: "ktp",
      cardPhotoPath: await ticket(actor.id, "identity_card"),
      selfiePath: await ticket(actor.id, "identity_selfie"),
    });
    expect(await db.select().from(s.identityVerifications)).toHaveLength(2);
  });
});
describe("Pengaturan, job, dan RLS", () => {
  it("retry dengan Idempotency-Key yang sama tidak mengirim konfirmasi rekening kedua", async () => {
    const actor = await user(db);
    const input = {
      type: "bank",
      provider: "BCA",
      accountNo: "1234567890",
      accountName: actor.name,
    };
    const first = await requestPayoutChange(db, actor, input, "request-account-1");
    const retry = await requestPayoutChange(db, actor, input, "request-account-1");
    expect(retry.id).toBe(first.id);
    expect(mocks.sendActionConfirmation).toHaveBeenCalledTimes(1);
    expect(await db.select().from(s.actionConfirmations)).toHaveLength(1);
    await expect(
      requestPayoutChange(db, actor, { ...input, accountNo: "9876543210" }, "request-account-1"),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT", status: 409 });
  });
  it("kegagalan Telegram membatalkan permintaan rekening dan cache idempotensi", async () => {
    const actor = await user(db);
    mocks.sendActionConfirmation.mockRejectedValueOnce(new Error("Telegram unavailable"));
    await expect(
      requestPayoutChange(
        db,
        actor,
        { type: "bank", provider: "BCA", accountNo: "1234567890", accountName: actor.name },
        "request-account-2",
      ),
    ).rejects.toThrow();
    expect(await db.select().from(s.actionConfirmations)).toHaveLength(0);
    expect(await db.select().from(s.idempotencyKeys)).toHaveLength(0);
  });
  it("retry pengaturan tidak menggandakan audit dan audit tidak dapat diubah", async () => {
    const actor = await user(db, { role: "super_admin" });
    await changeSettings(db, actor, { login_ttl_minutes: 5 }, "settings-request-1");
    await changeSettings(db, actor, { login_ttl_minutes: 5 }, "settings-request-1");
    const entries = await db.select().from(s.adminAuditLogs);
    expect(entries).toHaveLength(1);
    await expect(
      db
        .update(s.adminAuditLogs)
        .set({ action: "tampered" })
        .where(eq(s.adminAuditLogs.id, entries[0].id)),
    ).rejects.toThrow();
    expect((await db.select().from(s.adminAuditLogs))[0].action).toBe("settings_updated");
  });
  it("pengaturan hanya dapat diubah super admin dan mencatat audit", async () => {
    const admin = await user(db, { role: "admin" }),
      superAdmin = await user(db, { role: "super_admin" });
    await expect(changeSettings(db, admin, { login_ttl_minutes: 5 })).rejects.toMatchObject({
      status: 403,
    });
    await changeSettings(db, superAdmin, { login_ttl_minutes: 5 });
    expect((await getSettings(db)).login_ttl_minutes).toBe(5);
    expect(await db.select().from(s.adminAuditLogs)).toHaveLength(1);
  });
  it("menolak key pengaturan database yang tidak dikenal", async () => {
    await db.insert(s.settings).values({ key: "unknown_setting", value: 1 });
    await expect(getSettings(db)).rejects.toThrow();
  });
  it("job kedaluwarsa idempoten", async () => {
    const login = await startLogin(db, randomToken(), "local");
    await db
      .update(s.loginRequests)
      .set({ expiresAt: new Date(Date.now() - 1) })
      .where(eq(s.loginRequests.id, login.id));
    expect(await expireLoginRequests(db)).toEqual({ expiredLogins: 1, expiredConfirmations: 0 });
    expect(await expireLoginRequests(db)).toEqual({ expiredLogins: 0, expiredConfirmations: 0 });
  });
  it("RLS hanya mengizinkan membaca notifikasi sendiri dan menolak tabel identitas", async () => {
    const actor = await user(db),
      other = await user(db);
    await db.insert(s.notifications).values(
      [actor, other].map((u) => ({
        userId: u.id,
        type: "test",
        title: "Kabar",
        body: "Test",
        link: "/profil",
      })),
    );
    await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL ROLE authenticated`);
      await tx.execute(
        sql`SELECT set_config('request.jwt.claims', ${JSON.stringify({ sub: actor.id })}, true)`,
      );
      expect(await tx.select().from(s.notifications)).toHaveLength(1);
    });
    await expect(
      db.transaction(async (tx) => {
        await tx.execute(sql`SET LOCAL ROLE authenticated`);
        await tx.select().from(s.identityVerifications);
      }),
    ).rejects.toThrow();
  });
});
