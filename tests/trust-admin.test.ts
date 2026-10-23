import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import type { Database } from "@/src/db";
import * as s from "@/src/db/schema";
import { campusId, resetDatabase, testDatabase, user } from "./helpers/database";
import { encrypt } from "@/src/lib/crypto";
import { addDays, wibDateKey, wibDayStart } from "@/src/domain/availability";
import { createRental, actOnRental, periodSql } from "@/src/services/rental-service";
import { decidePayment, savePlatformAccount, submitPayment } from "@/src/services/payment-service";
import {
  decideDispute,
  disputeDetail,
  openDispute,
  respondDispute,
} from "@/src/services/dispute-service";
import { settleRental } from "@/src/services/settlement-service";
import {
  publicReviews,
  rentalReviews,
  revealReviews,
  submitReview,
} from "@/src/services/review-service";
import {
  adminUserDetail,
  adminUsers,
  autoSuspend,
  changeRole,
  createReport,
  handleReport,
  manageUser,
} from "@/src/services/trust-service";
import {
  createAdjustment,
  financialRecap,
  recordReconciliation,
  withdrawCommission,
} from "@/src/services/admin-finance-service";
import { ledgerBalances } from "@/src/services/ledger-service";
import { purgeIdentity, requestAccountDeletion } from "@/src/services/account-deletion-service";
import { processTelegramUpdate } from "@/src/services/telegram-service";

const mocks = vi.hoisted(() => ({
  sendMessage: vi.fn(),
  answerCallbackQuery: vi.fn(),
  remove: vi.fn(),
}));
vi.mock("@/src/services/telegram-api", () => ({
  telegramApi: () => mocks,
  sendActionConfirmation: vi.fn(),
}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    storage: {
      from: () => ({
        download: async (path: string) => ({
          data: new Blob([
            Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.from(path)]),
          ]),
          error: null,
        }),
        createSignedUrl: async () => ({ data: { signedUrl: "https://storage.test/private" } }),
        remove: mocks.remove,
      }),
    },
  }),
}));
let db: Database, close: () => Promise<void>;
beforeAll(async () => {
  ({ db, close } = await testDatabase());
});
afterAll(async () => {
  await close?.();
});
beforeEach(async () => {
  await resetDatabase(db);
  vi.clearAllMocks();
  mocks.remove.mockResolvedValue({ error: null });
  process.env.ACCOUNT_ENCRYPTION_KEY = Buffer.alloc(32, 3).toString("base64");
  process.env.SUPABASE_URL = "https://storage.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "dummy";
  delete process.env.TELEGRAM_ADMIN_CHAT_ID;
});
const H = 3600000;
async function fixture() {
  const owner = await user(db, { name: "Pemilik Uji", verificationStatus: "terverifikasi" }),
    renter = await user(db, { name: "Penyewa Uji", verificationStatus: "terverifikasi" }),
    admin = await user(db, { role: "super_admin" }),
    otherAdmin = await user(db, { role: "admin" }),
    stranger = await user(db);
  for (const person of [owner, renter])
    await db.insert(s.payoutAccounts).values({
      userId: person.id,
      type: "ewallet",
      provider: "GoPay",
      accountNoEnc: encrypt("081200001111"),
      accountName: person.name,
    });
  const [category] = await db.insert(s.categories).values({ name: "Kamera" }).returning();
  const [point] = await db
    .insert(s.pickupPoints)
    .values({
      campusId,
      name: "Lobi",
      hours: Array.from({ length: 7 }, () => ({ open: "08:00", close: "20:00" })),
    })
    .returning();
  const [item] = await db
    .insert(s.items)
    .values({
      ownerId: owner.id,
      campusId,
      categoryId: category.id,
      title: "Kamera tugas",
      description: "Kamera dalam kondisi baik dan lengkap.",
      itemValue: 500000,
      pricePerDay: 50000,
      deposit: 100000,
      minDays: 1,
      maxDays: 7,
      status: "aktif",
      publishedAt: new Date(),
    })
    .returning();
  await db.insert(s.itemPickupPoints).values({ itemId: item.id, pickupPointId: point.id });
  const account = await savePlatformAccount(db, admin, null, {
    type: "bank",
    provider: "BCA",
    accountNo: "1234567890",
    accountName: "Platform Uji",
  });
  const start = new Date(wibDayStart(addDays(wibDateKey(new Date()), 2)).getTime() + 10 * H);
  const input = { itemId: item.id, pickupPointId: point.id, startAt: start.toISOString(), days: 1 };
  return { owner, renter, admin, otherAdmin, stranger, item, point, account, start, input };
}
type F = Awaited<ReturnType<typeof fixture>>;
async function ticket(userId: string, purpose: (typeof s.uploadTickets.$inferInsert)["purpose"]) {
  const path = `${userId}/${purpose}/${crypto.randomUUID()}.png`;
  await db.insert(s.uploadTickets).values({
    userId,
    path,
    purpose,
    contentType: "image/png",
    expiresAt: new Date(Date.now() + H),
  });
  return path;
}
const rental = async (id: string) =>
  (await db.select().from(s.rentals).where(eq(s.rentals.id, id)))[0];
async function funded(f: F) {
  const r = await createRental(db, f.renter, f.input);
  await actOnRental(db, f.owner, r.id, "approve", { version: 1 });
  let saved = await rental(r.id);
  const p = await submitPayment(db, f.renter, r.id, {
    platformAccountId: f.account.id,
    proofPath: await ticket(f.renter.id, "payment_proof"),
    senderName: f.renter.name,
    transferredAt: new Date().toISOString(),
    claimedAmount: saved.amountDue,
  });
  saved = await rental(r.id);
  await decidePayment(db, f.admin, p.id, {
    version: saved.version,
    decision: "diterima",
    verifiedAmount: saved.amountDue,
  });
  return rental(r.id);
}
async function disputed(f: F, from: "DIBAYAR" | "BERJALAN" | "DIKEMBALIKAN" = "BERJALAN") {
  const r = await funded(f);
  await db.update(s.rentals).set({ status: from }).where(eq(s.rentals.id, r.id));
  const current = await rental(r.id);
  return db.transaction(async (tx) =>
    openDispute(tx, current, {
      openedBy: f.owner.id,
      category: "rusak",
      description: "Kerusakan barang yang perlu diperiksa oleh admin.",
    }),
  );
}
async function finished(f: F) {
  const r = await funded(f);
  await db.transaction(async (tx) => {
    await settleRental(tx, r, "normal");
    await tx.update(s.rentals).set({ status: "PENCAIRAN_DIPROSES" }).where(eq(s.rentals.id, r.id));
  });
  return rental(r.id);
}

describe("Sprint 5 disputes", () => {
  it("records a time-limited counterpart response and protects it from outsiders/repetition", async () => {
    const f = await fixture(),
      { dispute: d, rental: r } = await disputed(f);
    await expect(
      respondDispute(db, f.stranger, d.id, {
        body: "Saya menyampaikan tanggapan untuk kasus ini.",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      respondDispute(db, f.owner, d.id, { body: "Saya menyampaikan tanggapan untuk kasus ini." }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await respondDispute(db, f.renter, d.id, {
      body: "Kondisi barang sudah seperti ini saat diserahkan.",
    });
    expect((await disputeDetail(db, f.admin, d.id)).dispute.responses).toHaveLength(1);
    await expect(
      respondDispute(db, f.renter, d.id, {
        body: "Kondisi barang sudah seperti ini saat diserahkan.",
      }),
    ).rejects.toMatchObject({ code: "RESPONSE_EXISTS" });
    await db
      .update(s.disputes)
      .set({ respondBy: new Date(Date.now() - H) })
      .where(eq(s.disputes.id, d.id));
    await expect(
      respondDispute(db, f.renter, d.id, { body: "Ini tanggapan setelah batas waktu selesai." }),
    ).rejects.toMatchObject({ code: "RESPONSE_CLOSED" });
    expect(r.status).toBe("SENGKETA");
  });
  it("rejects self decisions and unbalanced splits, then settles once with a strike", async () => {
    const f = await fixture(),
      { dispute: d, rental: r } = await disputed(f);
    const input = {
      version: r.version,
      outcome: "bagi_dana",
      reason: "Bukti menunjukkan kerusakan yang disebabkan oleh penyewa.",
      ownerAmount: 70000,
      renterAmount: r.amountReceived - r.commissionAmount - 70000,
      strikeUserId: f.renter.id,
    };
    await expect(
      decideDispute(db, { ...f.owner, role: "super_admin" }, d.id, input),
    ).rejects.toMatchObject({ code: "SELF_REVIEW_FORBIDDEN" });
    await expect(
      decideDispute(db, f.admin, d.id, { ...input, renterAmount: 1 }),
    ).rejects.toMatchObject({ code: "INVALID_SPLIT" });
    const result = await decideDispute(db, f.admin, d.id, input, "decision-key");
    expect(result.status).toBe("PENCAIRAN_DIPROSES");
    await decideDispute(db, f.admin, d.id, input, "decision-key");
    expect(await db.select().from(s.payoutTasks)).toHaveLength(2);
    expect(await db.select().from(s.strikes)).toHaveLength(1);
    const b = await ledgerBalances(db, [
      "dana_ditahan",
      "hutang_pemilik",
      "hutang_penyewa",
      "pendapatan_komisi",
    ]);
    expect(b.get("dana_ditahan")).toBe(0);
    expect(-b.get("pendapatan_komisi")!).toBe(5000);
    await expect(decideDispute(db, f.otherAdmin, d.id, input)).rejects.toMatchObject({
      code: "DISPUTE_CHANGED",
    });
  });
  it("cancels only pre-handover disputes without commission or zero tasks", async () => {
    const f = await fixture(),
      { dispute: d, rental: r } = await disputed(f, "DIBAYAR");
    await expect(
      decideDispute(db, f.admin, d.id, {
        version: r.version,
        outcome: "bagi_dana",
        reason: "Pembagian diminta pada tahap sebelum serah terima.",
        ownerAmount: 0,
        renterAmount: r.amountReceived - 5000,
      }),
    ).rejects.toMatchObject({ code: "INVALID_OUTCOME" });
    await decideDispute(db, f.admin, d.id, {
      version: r.version,
      outcome: "batal",
      reason: "Bukti menunjukkan barang tidak sesuai dengan listing.",
      ownerAmount: 0,
      renterAmount: r.amountReceived,
    });
    expect((await rental(r.id)).status).toBe("DIBATALKAN");
    const tasks = await db.select().from(s.payoutTasks);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].amount).toBe(r.amountReceived);
    expect((await ledgerBalances(db, ["pendapatan_komisi"])).get("pendapatan_komisi") ?? 0).toBe(0);
  });
  it("continuing a paid dispute rechecks holds and resets the photo epoch", async () => {
    const f = await fixture(),
      { dispute: d, rental: r } = await disputed(f, "DIBAYAR");
    const [h] = await db
      .insert(s.handoverRecords)
      .values({
        rentalId: r.id,
        type: "start",
        ownerArrivedAt: new Date(),
        renterArrivedAt: new Date(),
        codeHash: "old",
        photosConfirmedAt: new Date(),
      })
      .returning();
    await db.insert(s.handoverPhotos).values({
      handoverId: h.id,
      uploadedBy: f.renter.id,
      path: `${f.renter.id}/old.png`,
      source: "camera",
    });
    const input = {
      version: r.version,
      outcome: "lanjutkan",
      reason: "Kedua pihak dapat melanjutkan dengan jadwal baru.",
      newStartAt: new Date(f.start.getTime() + 2 * 86400000).toISOString(),
    };
    await expect(
      decideDispute(db, f.admin, d.id, { ...input, newStartAt: undefined }),
    ).rejects.toMatchObject({ code: "SCHEDULE_REQUIRED" });
    await db
      .update(s.rentals)
      .set({ rescheduleCount: r.rulesSnapshot.reschedule_max })
      .where(eq(s.rentals.id, r.id));
    await expect(decideDispute(db, f.admin, d.id, input)).rejects.toMatchObject({
      code: "RESCHEDULE_LIMIT",
    });
    await db.update(s.rentals).set({ rescheduleCount: 0 }).where(eq(s.rentals.id, r.id));
    await expect(
      decideDispute(db, f.admin, d.id, { ...input, newStartAt: f.start.toISOString() }),
    ).rejects.toMatchObject({ code: "SAME_SCHEDULE" });
    const start = new Date(input.newStartAt),
      end = new Date(start.getTime() + 2 * 86400000);
    const [block] = await db
      .insert(s.availabilityBlocks)
      .values({ itemId: f.item.id, period: periodSql(start, end) })
      .returning();
    await expect(decideDispute(db, f.admin, d.id, input)).rejects.toMatchObject({
      code: "DATES_UNAVAILABLE",
    });
    await db.delete(s.availabilityBlocks).where(eq(s.availabilityBlocks.id, block.id));
    await decideDispute(db, f.admin, d.id, input);
    const next = await rental(r.id);
    expect(next.rescheduleCount).toBe(1);
    const [record] = await db.select().from(s.handoverRecords);
    expect(record.ownerArrivedAt).toBeNull();
    expect(record.photosConfirmedAt).toBeNull();
    expect(record.codeHash).toBeNull();
    expect((await db.select().from(s.handoverPhotos))[0].rescheduleCount).toBe(0);
  });
});
describe("Sprint 5 reviews and moderation", () => {
  it("hides the counterpart review until both submit and aggregates directions separately", async () => {
    const f = await fixture(),
      r = await finished(f);
    await submitReview(db, f.renter, r.id, {
      score: 4,
      tags: ["komunikatif"],
      comment: "Kamera sesuai.",
    });
    expect(await publicReviews(db, { userId: f.owner.id })).toHaveLength(0);
    expect((await rentalReviews(db, f.owner, r.id)).received).toHaveLength(0);
    await submitReview(db, f.renter, r.id, { score: 5 });
    await submitReview(db, f.owner, r.id, { score: 3 });
    expect(await publicReviews(db, { itemId: f.item.id })).toHaveLength(1);
    const [item] = await db.select().from(s.items);
    expect(item.ratingAvg).toBe(500);
    const people = await db.select().from(s.users);
    expect(people.find((u) => u.id === f.renter.id)?.ratingAvg).toBe(300);
    await expect(submitReview(db, f.renter, r.id, { score: 1 })).rejects.toMatchObject({
      code: "REVIEW_VISIBLE",
    });
  });
  it("reveals one-sided reviews after the snapshot deadline and excludes cancelled transactions", async () => {
    const f = await fixture(),
      r = await finished(f);
    await submitReview(db, f.renter, r.id, { score: 4 });
    await db
      .update(s.rentals)
      .set({ settledAt: new Date(Date.now() - 8 * 86400000) })
      .where(eq(s.rentals.id, r.id));
    expect((await revealReviews(db)).revealed).toBe(1);
    expect((await revealReviews(db)).revealed).toBe(0);
    await expect(submitReview(db, f.owner, r.id, { score: 5 })).rejects.toMatchObject({
      code: "REVIEW_CLOSED",
    });
    await db
      .update(s.rentals)
      .set({ status: "DIBATALKAN", settledAt: new Date() })
      .where(eq(s.rentals.id, r.id));
    await expect(submitReview(db, f.owner, r.id, { score: 5 })).rejects.toMatchObject({
      code: "REVIEW_CLOSED",
    });
  });
  it("hides reported reviews, removes their aggregate and notifies the reporter", async () => {
    const f = await fixture(),
      r = await finished(f);
    const review = await submitReview(db, f.renter, r.id, {
      score: 5,
      comment: "Komentar yang perlu diperiksa.",
    });
    await submitReview(db, f.owner, r.id, { score: 4 });
    const report = await createReport(db, f.owner, {
      targetType: "review",
      targetId: review.id,
      reason: "Pelecehan dalam ulasan",
    });
    await expect(
      handleReport(db, { ...f.owner, role: "admin" }, report.id, {
        action: "sembunyikan",
        reason: "Konten melanggar aturan komunitas.",
      }),
    ).rejects.toMatchObject({ code: "SELF_REVIEW_FORBIDDEN" });
    await handleReport(db, f.admin, report.id, {
      action: "sembunyikan",
      reason: "Konten melanggar aturan komunitas.",
    });
    expect(await publicReviews(db, { itemId: f.item.id })).toHaveLength(0);
    expect((await db.select().from(s.items))[0].ratingCount).toBe(0);
    expect(
      await db.select().from(s.notifications).where(eq(s.notifications.type, "report_handled")),
    ).toHaveLength(1);
  });
  it("only permits reporting visible accessible content and stops self handling", async () => {
    const f = await fixture();
    await expect(
      createReport(db, f.owner, {
        targetType: "item",
        targetId: f.item.id,
        reason: "Laporan barang sendiri",
      }),
    ).rejects.toMatchObject({ code: "SELF_REPORT" });
    const report = await createReport(db, f.renter, {
      targetType: "item",
      targetId: f.item.id,
      reason: "Informasi barang palsu",
    });
    await expect(
      handleReport(db, { ...f.owner, role: "admin" }, report.id, {
        action: "strike",
        reason: "Konten dilaporkan dan terbukti.",
      }),
    ).rejects.toMatchObject({ code: "SELF_REVIEW_FORBIDDEN" });
    await handleReport(db, f.admin, report.id, {
      action: "strike",
      reason: "Konten dilaporkan dan terbukti.",
    });
    await expect(
      handleReport(db, f.otherAdmin, report.id, {
        action: "strike",
        reason: "Konten dilaporkan dan terbukti.",
      }),
    ).rejects.toMatchObject({ code: "REPORT_CLOSED" });
    expect(await db.select().from(s.strikes)).toHaveLength(1);
  });
});
describe("Sprint 5 accounts", () => {
  it("keeps a final rental account available while a payment proof still needs verification", async () => {
    const f = await fixture();
    const r = await createRental(db, f.renter, f.input);
    await actOnRental(db, f.owner, r.id, "approve", { version: 1 });
    await submitPayment(db, f.renter, r.id, {
      platformAccountId: f.account.id,
      proofPath: await ticket(f.renter.id, "payment_proof"),
      senderName: f.renter.name,
      transferredAt: new Date().toISOString(),
      claimedAmount: (await rental(r.id)).amountDue,
    });
    await db.update(s.rentals).set({ status: "DIBATALKAN" }).where(eq(s.rentals.id, r.id));
    await expect(requestAccountDeletion(db, f.renter)).rejects.toMatchObject({
      code: "ACCOUNT_HAS_OBLIGATIONS",
    });
  });
  it("serializes new requests against suspension so no pending obligation escapes", async () => {
    const f = await fixture();
    const result = await Promise.allSettled([
      createRental(db, f.renter, f.input),
      manageUser(db, f.admin, f.owner.id, "suspend", {
        reason: "Akun ditangguhkan untuk peninjauan laporan.",
      }),
    ]);
    expect(result[1].status).toBe("fulfilled");
    expect(await db.select().from(s.rentals).where(eq(s.rentals.status, "DIAJUKAN"))).toHaveLength(
      0,
    );
    expect(
      (await db.select().from(s.users).where(eq(s.users.id, f.owner.id)))[0].accountStatus,
    ).toBe("ditangguhkan");
  });
  it("auto-suspends at threshold, closes only pending requests, and keeps approved obligations", async () => {
    const f = await fixture();
    const paid = await funded(f);
    const pending = await createRental(db, f.renter, {
      ...f.input,
      startAt: new Date(f.start.getTime() + 3 * 86400000).toISOString(),
    });
    for (let i = 0; i < 3; i++)
      await manageUser(db, f.admin, f.owner.id, "strike", {
        reason: `Pelanggaran terbukti ke ${i + 1}.`,
      });
    expect((await autoSuspend(db)).suspended).toBe(1);
    expect((await autoSuspend(db)).suspended).toBe(0);
    expect((await rental(pending.id)).status).toBe("DITOLAK");
    expect((await rental(paid.id)).status).toBe("DIBAYAR");
    expect((await adminUsers(db, f.admin, paid.publicCode)).some((u) => u.id === f.owner.id)).toBe(
      true,
    );
    await manageUser(db, f.admin, f.owner.id, "reactivate", {
      reason: "Peninjauan selesai dan kewajiban telah dipahami.",
    });
    expect((await autoSuspend(db)).suspended).toBe(0);
    await manageUser(db, f.admin, f.owner.id, "strike", {
      reason: "Pelanggaran baru setelah peninjauan.",
    });
    expect((await autoSuspend(db)).suspended).toBe(0);
  });
  it("revokes sessions on role changes and enforces super-admin and self restrictions", async () => {
    const f = await fixture();
    await db
      .insert(s.sessions)
      .values({ userId: f.renter.id, tokenHash: "session", expiresAt: new Date(Date.now() + H) });
    await expect(
      changeRole(db, f.otherAdmin, f.renter.id, {
        role: "admin",
        reason: "Menambah petugas untuk pengujian.",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await changeRole(db, f.admin, f.renter.id, {
      role: "admin",
      reason: "Menambah petugas untuk pengujian.",
    });
    expect((await db.select().from(s.sessions))[0].revokedAt).not.toBeNull();
    await expect(
      manageUser(db, f.admin, f.admin.id, "suspend", { reason: "Menangguhkan akun sendiri." }),
    ).rejects.toMatchObject({ code: "SELF_REVIEW_FORBIDDEN" });
    expect((await adminUserDetail(db, f.admin, f.renter.id)).user.role).toBe("admin");
  });
  it("rechecks deletion obligations at Telegram confirmation and supports rejection", async () => {
    const f = await fixture();
    const c = await requestAccountDeletion(db, f.renter);
    await funded(f);
    const callback = (value: string, update_id: number) => ({
      update_id,
      callback_query: {
        id: `cb${update_id}`,
        from: { id: f.renter.telegramUserId!, is_bot: false, first_name: "Uji" },
        chat_instance: "test",
        message: {
          message_id: 1,
          date: 1,
          chat: { id: f.renter.telegramChatId!, type: "private" as const, first_name: "Uji" },
        },
        data: `confirm:${c.id}:${value}`,
      },
    });
    await processTelegramUpdate(db, callback("yes", 1));
    expect(
      (await db.select().from(s.users).where(eq(s.users.id, f.renter.id)))[0].accountStatus,
    ).toBe("aktif");
    expect(mocks.answerCallbackQuery).toHaveBeenCalledWith(
      "cb1",
      expect.objectContaining({ show_alert: true }),
    );
    await processTelegramUpdate(db, callback("no", 2));
    expect((await db.select().from(s.actionConfirmations))[0].status).toBe("ditolak");
  });
  it("anonymizes, frees phone/Telegram for a fresh account, revokes sessions and purges identity at 30 days", async () => {
    const f = await fixture();
    await db.insert(s.sessions).values({
      userId: f.renter.id,
      tokenHash: "session",
      expiresAt: new Date(Date.now() + H),
      ip: "127.0.0.1",
    });
    await db.insert(s.identityVerifications).values({
      userId: f.renter.id,
      cardType: "ktm",
      cardPhotoPath: `${f.renter.id}/card.png`,
      selfiePath: `${f.renter.id}/selfie.png`,
    });
    const c = await requestAccountDeletion(db, f.renter);
    await processTelegramUpdate(db, {
      update_id: 5,
      callback_query: {
        id: "delete",
        from: { id: f.renter.telegramUserId!, is_bot: false, first_name: "Uji" },
        chat_instance: "test",
        message: {
          message_id: 1,
          date: 1,
          chat: { id: f.renter.telegramChatId!, type: "private", first_name: "Uji" },
        },
        data: `confirm:${c.id}:yes`,
      },
    });
    const [deleted] = await db.select().from(s.users).where(eq(s.users.id, f.renter.id));
    expect(deleted.accountStatus).toBe("dihapus");
    expect(deleted.telegramUserId).toBeNull();
    expect(deleted.phone).not.toBe(f.renter.phone);
    expect((await db.select().from(s.sessions))[0].revokedAt).not.toBeNull();
    await user(db, { phone: f.renter.phone, telegramUserId: f.renter.telegramUserId });
    expect((await purgeIdentity(db)).purged).toBe(0);
    await db
      .update(s.users)
      .set({ deletedAt: new Date(Date.now() - 31 * 86400000) })
      .where(eq(s.users.id, f.renter.id));
    mocks.remove.mockResolvedValueOnce({ error: new Error("offline") });
    expect((await purgeIdentity(db)).purged).toBe(0);
    expect((await purgeIdentity(db)).purged).toBe(1);
    expect((await purgeIdentity(db)).purged).toBe(0);
    expect((await db.select().from(s.identityVerifications))[0].cardPhotoPath).toBe("");
  });
});
describe("Sprint 5 finance", () => {
  it("requires discrepancy notes and makes reconciliations immutable", async () => {
    const f = await fixture(),
      r = await funded(f);
    const input = {
      date: wibDateKey(new Date()),
      platformAccountId: f.account.id,
      actualBalance: r.amountReceived + 1,
    };
    await expect(recordReconciliation(db, f.admin, input)).rejects.toMatchObject({
      code: "NOTE_REQUIRED",
    });
    const saved = await recordReconciliation(
      db,
      f.admin,
      { ...input, note: "Ada selisih satu rupiah yang sedang ditelusuri." },
      "recon-key",
    );
    expect(saved.difference).toBe(1);
    await recordReconciliation(
      db,
      f.admin,
      { ...input, note: "Ada selisih satu rupiah yang sedang ditelusuri." },
      "recon-key",
    );
    expect(await db.select().from(s.reconciliations)).toHaveLength(1);
    await expect(db.update(s.reconciliations).set({ note: "diubah" })).rejects.toThrow();
    expect((await financialRecap(db, f.admin)).held).toBe(r.amountReceived);
  });
  it("serializes commission withdrawals so revenue cannot become negative", async () => {
    const f = await fixture();
    await finished(f);
    const a = {
        fromAccountId: f.account.id,
        amount: 4000,
        note: "Penarikan komisi untuk operasional.",
        proofPath: await ticket(f.admin.id, "cash_proof"),
      },
      b = { ...a, proofPath: await ticket(f.admin.id, "cash_proof") };
    await expect(withdrawCommission(db, f.otherAdmin, a)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    const results = await Promise.allSettled([
      withdrawCommission(db, f.admin, a),
      withdrawCommission(db, f.admin, b),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await financialRecap(db, f.admin)).commission).toBe(1000);
  });
  it("reserves funded adjustments without rewriting the original task or ledger", async () => {
    const f = await fixture(),
      r = await finished(f);
    const [task] = await db
      .select()
      .from(s.payoutTasks)
      .where(eq(s.payoutTasks.recipientId, f.owner.id));
    await db
      .update(s.payoutTasks)
      .set({
        status: "selesai",
        sourceAccountId: f.account.id,
        transferredAmount: task.amount,
        transferFee: 0,
        proofPath: `${f.admin.id}/paid.png`,
        transferredAt: new Date(),
        completedBy: f.admin.id,
        completedAt: new Date(),
      })
      .where(eq(s.payoutTasks.id, task.id));
    await expect(
      createAdjustment(
        db,
        { ...f.owner, role: "super_admin" },
        { originalTaskId: task.id, amount: 500, reason: "Koreksi nominal transfer sebelumnya." },
      ),
    ).rejects.toMatchObject({ code: "SELF_PAYOUT_FORBIDDEN" });
    const added = await createAdjustment(db, f.admin, {
      originalTaskId: task.id,
      amount: 500,
      reason: "Koreksi nominal transfer sebelumnya.",
    });
    const [adjustment] = await db
      .select()
      .from(s.payoutTasks)
      .where(eq(s.payoutTasks.id, added.id));
    expect(adjustment.accountSnapshot).toEqual(task.accountSnapshot);
    expect((await financialRecap(db, f.admin)).commission).toBe(4500);
    await expect(
      createAdjustment(db, f.admin, {
        originalTaskId: task.id,
        amount: 5000,
        reason: "Koreksi nominal transfer sebelumnya.",
      }),
    ).rejects.toMatchObject({ code: "INSUFFICIENT_COMMISSION" });
    expect((await rental(r.id)).settlement?.received).toBe(r.amountReceived);
  });
});
