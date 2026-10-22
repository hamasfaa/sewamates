import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import type { Database } from "@/src/db";
import * as s from "@/src/db/schema";
import { campusId, resetDatabase, testDatabase, user } from "./helpers/database";
import {
  addDays,
  rentalPeriod,
  wibDateKey,
  wibDayStart,
  paymentReviewTarget,
  withinPickupHours,
} from "@/src/domain/availability";
import { canTransition, RENTAL_STATUSES } from "@/src/domain/rental-state-machine";
import { firstFreeCode, paymentTotals } from "@/src/domain/pricing";
import { redactChat } from "@/src/domain/chat";
import { actOnRental, createRental, rentalDetail } from "@/src/services/rental-service";
import {
  decidePayment,
  deletePlatformAccount,
  savePlatformAccount,
  submitPayment,
} from "@/src/services/payment-service";
import {
  adminConversation,
  blockUser,
  conversationList,
  conversationMessages,
  markConversationRead,
  openConversation,
  reportMessage,
  sendMessage,
} from "@/src/services/chat-service";
import { addBlock, changeItemStatus, itemAvailability } from "@/src/services/item-service";
import { searchItems } from "@/src/services/search-service";
import { changeSettings } from "@/src/services/settings-service";
import { expireRentals } from "@/src/jobs/expire-rentals";
import { deliverNotifications } from "@/src/jobs/deliver-notifications";
import { DEFAULT_SETTINGS } from "@/src/domain/settings";
import { notify, notifyAdmins } from "@/src/services/notification-service";

const mocks = vi.hoisted(() => ({ download: vi.fn(), sendMessage: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    storage: {
      from: () => ({
        download: mocks.download,
        createSignedUrl: async () => ({ data: { signedUrl: "https://storage.test/private" } }),
      }),
    },
  }),
}));
vi.mock("@/src/services/telegram-api", () => ({ telegramApi: () => mocks }));
let db: Database, close: () => Promise<void>;
beforeAll(async () => {
  ({ db, close } = await testDatabase());
});
afterAll(async () => {
  await close?.();
});
beforeEach(async () => {
  await resetDatabase(db);
  await db.execute(sql`TRUNCATE delivery_throttles`);
  vi.clearAllMocks();
  process.env.SUPABASE_URL = "https://storage.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test";
  process.env.TELEGRAM_BOT_TOKEN = "12345:test";
  delete process.env.TELEGRAM_ADMIN_CHAT_ID;
  mocks.download.mockImplementation(async (path: string) => ({
    data: new Blob([
      Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.from(path)]),
    ]),
    error: null,
  }));
  mocks.sendMessage.mockResolvedValue({});
});
const getRental = async (id: string) =>
  (await db.select().from(s.rentals).where(eq(s.rentals.id, id)))[0];
async function setup() {
  const owner = await user(db, { verificationStatus: "terverifikasi" }),
    renter = await user(db, { verificationStatus: "terverifikasi" }),
    admin = await user(db, { role: "super_admin", verificationStatus: "terverifikasi" });
  for (const person of [owner, renter])
    await db.insert(s.payoutAccounts).values({
      userId: person.id,
      type: "ewallet",
      provider: "GoPay",
      accountNoEnc: "v1.test-encrypted",
      accountName: person.name,
    });
  const [category] = await db.insert(s.categories).values({ name: "Kamera" }).returning();
  const hours = Array.from({ length: 7 }, () => ({ open: "08:00", close: "20:00" }));
  const [point] = await db
    .insert(s.pickupPoints)
    .values({ campusId, name: "Lobi kampus", hours })
    .returning();
  const [item] = await db
    .insert(s.items)
    .values({
      ownerId: owner.id,
      campusId,
      categoryId: category.id,
      title: "Kamera untuk tugas",
      description: "Kamera lengkap dan dalam kondisi baik.",
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
  const start = new Date(wibDayStart(addDays(wibDateKey(new Date()), 2)).getTime() + 10 * 3600000);
  const input = { itemId: item.id, pickupPointId: point.id, startAt: start.toISOString(), days: 1 };
  return { owner, renter, admin, item, point, account, input, start };
}
type Fixture = Awaited<ReturnType<typeof setup>>;
async function approved(f: Fixture) {
  const request = await createRental(db, f.renter, f.input);
  await actOnRental(db, f.owner, request.id, "approve", { version: 1 });
  return getRental(request.id);
}
async function proof(f: Fixture, rentalId: string, amount: number) {
  const path = `${f.renter.id}/payment_proof/${crypto.randomUUID()}.png`;
  await db.insert(s.uploadTickets).values({
    userId: f.renter.id,
    path,
    purpose: "payment_proof",
    contentType: "image/png",
    expiresAt: new Date(Date.now() + 3600000),
  });
  return submitPayment(db, f.renter, rentalId, {
    platformAccountId: f.account.id,
    proofPath: path,
    senderName: "Penyewa Uji",
    transferredAt: new Date().toISOString(),
    claimedAmount: amount,
  });
}
async function decide(
  f: Fixture,
  paymentId: string,
  rentalId: string,
  amount: number,
  key?: string,
) {
  return decidePayment(
    db,
    f.admin,
    paymentId,
    { decision: "diterima", verifiedAmount: amount, version: (await getRental(rentalId)).version },
    key,
  );
}

describe("aturan transaksi", () => {
  it("menolak semua transisi dari status final dan menjaga verifikasi tidak dapat dibatalkan pengguna", () => {
    for (const from of ["SELESAI", "DITOLAK", "KADALUARSA", "DIBATALKAN"] as const)
      for (const to of RENTAL_STATUSES) expect(canTransition(from, to)).toBe(false);
    expect(canTransition("DIAJUKAN", "DISETUJUI")).toBe(true);
    expect(canTransition("DIAJUKAN", "DIBAYAR")).toBe(false);
    expect(canTransition("MENUNGGU_VERIFIKASI", "DISETUJUI")).toBe(true);
  });
  it("menghitung kode unik sebagai deposit yang dikembalikan, termasuk kelebihan bayar", () => {
    expect(paymentTotals(100000, 60000, 347, 170347)).toEqual({
      amountDue: 160347,
      remaining: 0,
      overpayment: 10000,
      refundableDeposit: 70347,
    });
    expect(firstFreeCode([1, 2, 4])).toBe(3);
    expect(firstFreeCode(Array.from({ length: 999 }, (_, i) => i + 1))).toBeNull();
  });
  it("memakai 24 jam per hari, jeda, WIB, dan target verifikasi di luar jam operasional", () => {
    const start = new Date("2026-10-21T03:00:00Z"),
      range = rentalPeriod(start, 2, 3);
    expect(range.due.toISOString()).toBe("2026-10-23T03:00:00.000Z");
    expect(range.period.end.toISOString()).toBe("2026-10-23T06:00:00.000Z");
    expect(
      paymentReviewTarget(new Date("2026-10-21T15:00:00Z"), DEFAULT_SETTINGS).toISOString(),
    ).toBe("2026-10-22T03:00:00.000Z");
    expect(
      withinPickupHours(
        new Date("2026-10-21T13:00:00Z"),
        Array.from({ length: 7 }, () => ({ open: "08:00", close: "20:00" })),
      ),
    ).toBe(false);
  });
  it("menyamarkan nomor dengan separator dan tautan tanpa mengubah bukti asli", () => {
    const original =
      "Kontak +62 851-0125-1234 lalu transfer 12345678 ke https://example.com/pay atau www.example.org";
    const result = redactChat(original);
    expect(result.redacted).toBe(true);
    expect(result.text).not.toMatch(/851|12345678|example/);
    expect(original).toContain("12345678");
  });
});
describe("pengajuan dan hold", () => {
  it("menolak persetujuan jika perubahan aturan membuat batas pembayaran sudah lewat", async () => {
    const f = await setup(),
      request = await createRental(db, f.renter, f.input);
    // Keep exact schedule invariants while moving the fixture closer to its start.
    const start = new Date(Date.now() + 13 * 3600000),
      due = new Date(start.getTime() + 86400000);
    await db
      .update(s.rentals)
      .set({
        startAt: start,
        dueAt: due,
        blockPeriod: sql`tstzrange(${start.toISOString()}::timestamptz,${new Date(due.getTime() + 3 * 3600000).toISOString()}::timestamptz,'[)')`,
      })
      .where(eq(s.rentals.id, request.id));
    await changeSettings(db, f.admin, { payment_before_start_hours: 24 });
    await expect(
      actOnRental(db, f.owner, request.id, "approve", { version: 1 }),
    ).rejects.toMatchObject({ code: "PAYMENT_WINDOW_CLOSED" });
    expect((await getRental(request.id)).status).toBe("DIAJUKAN");
  });
  it("jeda tiga jam memblokir jadwal, titik berbeda kampus dan jadwal terlalu dekat ditolak", async () => {
    const f = await setup();
    await approved(f);
    await expect(
      createRental(db, f.renter, {
        ...f.input,
        startAt: new Date(f.start.getTime() + 25 * 3600000).toISOString(),
      }),
    ).rejects.toMatchObject({ code: "DATES_UNAVAILABLE" });
    await createRental(db, f.renter, {
      ...f.input,
      startAt: new Date(f.start.getTime() + 27 * 3600000).toISOString(),
    });
    await expect(
      createRental(db, f.renter, {
        ...f.input,
        startAt: new Date(Date.now() + 3600000).toISOString(),
      }),
    ).rejects.toMatchObject({ code: "INVALID_SCHEDULE" });
    const [campus] = await db.insert(s.campuses).values({ name: "Kampus lain" }).returning();
    const [point] = await db
      .insert(s.pickupPoints)
      .values({ campusId: campus.id, name: "Lobi lain", hours: f.point.hours })
      .returning();
    await expect(
      createRental(db, f.renter, { ...f.input, pickupPointId: point.id }),
    ).rejects.toMatchObject({ code: "INVALID_PICKUP_POINT" });
  });
  it("exclusion constraint menolak hold bertumpuk meskipun service dilewati", async () => {
    const f = await setup(),
      one = await createRental(db, f.renter, f.input),
      two = await createRental(db, f.renter, f.input);
    await actOnRental(db, f.owner, one.id, "approve", { version: 1 });
    await expect(
      db
        .update(s.rentals)
        .set({
          status: "DISETUJUI",
          uniqueCode: 2,
          amountDue: 150002,
          payBy: new Date(Date.now() + 3600000),
        })
        .where(eq(s.rentals.id, two.id)),
    ).rejects.toThrow();
  });
  it("menyimpan snapshot, percakapan, event, notifikasi dan idempotensi pengajuan", async () => {
    const f = await setup(),
      key = crypto.randomUUID();
    const first = await createRental(db, f.renter, f.input, key),
      again = await createRental(db, f.renter, f.input, key);
    expect(first.id).toBe(again.id);
    expect(await db.select().from(s.rentals)).toHaveLength(1);
    expect(await db.select().from(s.rentalEvents)).toHaveLength(1);
    const rental = await getRental(first.id);
    expect(rental.listingSnapshot.title).toBe(f.item.title);
    expect(rental.respondBy.getTime()).toBeLessThanOrEqual(Date.now() + 24 * 3600000);
    await db.update(s.items).set({ pricePerDay: 90000 }).where(eq(s.items.id, f.item.id));
    await actOnRental(db, f.owner, first.id, "approve", { version: 1 });
    expect((await getRental(first.id)).pricePerDay).toBe(50000);
  });
  it.each([1_000_000, 10_000_000, 100_000_000])(
    "akun tanpa transaksi selesai dapat menyewa barang bernilai Rp%i",
    async (itemValue) => {
      const f = await setup();
      expect(f.renter.completedCount).toBe(0);
      await db
        .update(s.items)
        .set({ itemValue, deposit: Math.min(itemValue / 10, DEFAULT_SETTINGS.deposit_cap) })
        .where(eq(s.items.id, f.item.id));
      const rental = await approved(f);
      expect(rental.status).toBe("DISETUJUI");
      expect(rental.listingSnapshot.itemValue).toBe(itemValue);
    },
  );
  it("menolak menyewa diri sendiri, belum verifikasi, tanpa rekening, dan jam tutup", async () => {
    const f = await setup();
    await expect(createRental(db, f.owner, f.input)).rejects.toMatchObject({ code: "SELF_RENTAL" });
    await expect(
      createRental(db, { ...f.renter, verificationStatus: "belum" }, f.input),
    ).rejects.toMatchObject({ code: "VERIFICATION_REQUIRED" });
    const closed = {
      ...f.input,
      startAt: new Date(f.start.getTime() + 12 * 3600000).toISOString(),
    };
    await expect(createRental(db, f.renter, closed)).rejects.toMatchObject({
      code: "POINT_CLOSED",
    });
    await db.delete(s.payoutAccounts).where(eq(s.payoutAccounts.userId, f.renter.id));
    await expect(createRental(db, f.renter, f.input)).rejects.toMatchObject({
      code: "PAYOUT_REQUIRED",
    });
  });
  it("membolehkan pengajuan bertumpuk lalu menolak persetujuan kedua yang bentrok", async () => {
    const f = await setup(),
      one = await createRental(db, f.renter, f.input),
      two = await createRental(db, f.renter, f.input);
    await actOnRental(db, f.owner, one.id, "approve", { version: 1 });
    await expect(actOnRental(db, f.owner, two.id, "approve", { version: 1 })).rejects.toMatchObject(
      { code: "DATES_UNAVAILABLE" },
    );
    expect((await rentalDetail(db, f.owner, two.id)).canApprove).toBe(false);
    await expect(
      addBlock(db, f.owner, f.item.id, { from: wibDateKey(f.start), to: wibDateKey(f.start) }),
    ).rejects.toMatchObject({ code: "RENTAL_OVERLAP" });
    await expect(changeItemStatus(db, f.owner, f.item.id, "archive")).rejects.toMatchObject({
      code: "ACTIVE_RENTAL",
    });
    expect(
      (await itemAvailability(db, f.item.id, f.input.startAt.slice(0, 7))).unavailable,
    ).toContain(wibDateKey(f.start));
    expect(
      (await searchItems(db, { from: wibDateKey(f.start), to: wibDateKey(f.start) })).items,
    ).toHaveLength(0);
    await actOnRental(db, f.renter, one.id, "cancel", { version: 2 });
    await actOnRental(db, f.owner, two.id, "approve", { version: 1 });
  });
  it("pengguna lain tidak boleh membaca atau memutuskan transaksi", async () => {
    const f = await setup(),
      request = await createRental(db, f.renter, f.input),
      stranger = await user(db);
    await expect(rentalDetail(db, stranger, request.id)).rejects.toMatchObject({ status: 404 });
    await expect(
      actOnRental(db, f.renter, request.id, "approve", { version: 1 }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      actOnRental(db, stranger, request.id, "reject", { version: 1 }),
    ).rejects.toMatchObject({ status: 404 });
  });
  it("snapshot aturan hanya diganti saat persetujuan, bukan mengikuti perubahan settings setelahnya", async () => {
    const f = await setup(),
      rental = await approved(f);
    await changeSettings(db, f.admin, { commission_rate_bp: 2000, payment_extension_hours: 4 });
    const saved = await getRental(rental.id);
    expect(saved.rulesSnapshot.commission_rate_bp).toBe(1000);
    expect(saved.commissionAmount).toBe(5000);
  });
  it.runIf(Boolean(process.env.TEST_DATABASE_URL))(
    "dua persetujuan konkuren hanya menghasilkan satu hold",
    async () => {
      const f = await setup(),
        one = await createRental(db, f.renter, f.input),
        two = await createRental(db, f.renter, f.input);
      const results = await Promise.allSettled([
        actOnRental(db, f.owner, one.id, "approve", { version: 1 }),
        actOnRental(db, f.owner, two.id, "approve", { version: 1 }),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(
        await db.select().from(s.rentals).where(eq(s.rentals.status, "DISETUJUI")),
      ).toHaveLength(1);
    },
  );
});
describe("pembayaran dan ledger", () => {
  it("menunggu semua bukti diputuskan meskipun total sudah lunas", async () => {
    const f = await setup(),
      rental = await approved(f);
    const first = await proof(f, rental.id, 150001),
      second = await proof(f, rental.id, 1000);
    await decide(f, first.id, rental.id, 150001);
    expect((await getRental(rental.id)).status).toBe("MENUNGGU_VERIFIKASI");
    await decidePayment(db, f.admin, second.id, {
      version: (await getRental(rental.id)).version,
      decision: "ditolak",
      reason: "Bukti duplikat mutasi sebelumnya",
    });
    expect((await getRental(rental.id)).status).toBe("DIBAYAR");
    expect(await db.select().from(s.ledgerEntries)).toHaveLength(2);
  });
  it("menolak file asing, isi palsu, tiket dipakai ulang, dan rekening nonaktif", async () => {
    const f = await setup(),
      rental = await approved(f);
    const path = `${f.renter.id}/payment_proof/${crypto.randomUUID()}.png`;
    const input = {
      platformAccountId: f.account.id,
      proofPath: path,
      senderName: "Penyewa Uji",
      transferredAt: new Date().toISOString(),
      claimedAmount: 150001,
    };
    await expect(
      submitPayment(db, f.renter, rental.id, {
        ...input,
        proofPath: `${f.owner.id}/payment_proof/${crypto.randomUUID()}.png`,
      }),
    ).rejects.toMatchObject({ code: "INVALID_UPLOAD" });
    mocks.download.mockResolvedValueOnce({ data: new Blob(["bukan gambar"]), error: null });
    await expect(submitPayment(db, f.renter, rental.id, input)).rejects.toMatchObject({
      code: "INVALID_FILE",
    });
    await db.insert(s.uploadTickets).values({
      userId: f.renter.id,
      path,
      purpose: "payment_proof",
      contentType: "image/png",
      expiresAt: new Date(Date.now() + 3600000),
    });
    await db
      .update(s.platformAccounts)
      .set({ active: false })
      .where(eq(s.platformAccounts.id, f.account.id));
    await expect(submitPayment(db, f.renter, rental.id, input)).rejects.toMatchObject({
      code: "INVALID_ACCOUNT",
    });
    await db
      .update(s.platformAccounts)
      .set({ active: true })
      .where(eq(s.platformAccounts.id, f.account.id));
    await submitPayment(db, f.renter, rental.id, input);
    await expect(submitPayment(db, f.renter, rental.id, input)).rejects.toMatchObject({
      code: "INVALID_UPLOAD",
    });
    expect(await db.select().from(s.payments)).toHaveLength(1);
  });
  it("versi lama dan pengguna biasa tidak bisa memverifikasi atau mengelola rekening platform", async () => {
    const f = await setup(),
      rental = await approved(f),
      p = await proof(f, rental.id, 150001);
    await expect(
      decidePayment(db, f.admin, p.id, {
        version: 1,
        decision: "diterima",
        verifiedAmount: 150001,
      }),
    ).rejects.toMatchObject({ code: "RENTAL_CHANGED" });
    await expect(
      decidePayment(db, f.owner, p.id, {
        version: 3,
        decision: "diterima",
        verifiedAmount: 150001,
      }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      savePlatformAccount(db, { ...f.admin, role: "admin" }, null, {
        type: "ewallet",
        provider: "GoPay",
        accountNo: "081234567890",
        accountName: "Platform",
      }),
    ).rejects.toMatchObject({ status: 403 });
    expect(await db.select().from(s.ledgerEntries)).toHaveLength(0);
  });
  it.runIf(Boolean(process.env.TEST_DATABASE_URL))(
    "dua admin konkuren hanya mencatat satu penerimaan dana",
    async () => {
      const f = await setup(),
        rental = await approved(f),
        p = await proof(f, rental.id, 150001),
        secondAdmin = await user(db, { role: "admin" });
      const input = { version: 3, decision: "diterima", verifiedAmount: 150001 };
      const results = await Promise.allSettled([
        decidePayment(db, f.admin, p.id, input),
        decidePayment(db, secondAdmin, p.id, input),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect((await getRental(rental.id)).amountReceived).toBe(150001);
      expect(await db.select().from(s.ledgerEntries)).toHaveLength(2);
    },
  );
  it("mencatat nominal terverifikasi, membayar bertahap, dan menahan kelebihan sebagai refund deposit", async () => {
    const f = await setup(),
      rental = await approved(f),
      first = await proof(f, rental.id, 60000);
    await expect(
      actOnRental(db, f.renter, rental.id, "cancel", { version: 3 }),
    ).rejects.toMatchObject({ code: "CANCEL_UNAVAILABLE" });
    await decide(f, first.id, rental.id, 50000);
    let saved = await getRental(rental.id);
    expect(saved.status).toBe("DISETUJUI");
    expect(saved.amountReceived).toBe(50000);
    expect(saved.payBy!.getTime()).toBeGreaterThanOrEqual(Date.now() + 119 * 60000);
    const second = await proof(f, rental.id, 110000);
    await decide(f, second.id, rental.id, 110000);
    saved = await getRental(rental.id);
    expect(saved.status).toBe("DIBAYAR");
    expect(saved.amountReceived).toBe(160000);
    expect((await rentalDetail(db, f.renter, rental.id)).totals.overpayment).toBe(9999);
    const journals = await db.execute<{ balance: string }>(
      sql`SELECT sum(debit-credit)::text AS balance FROM ledger_entries GROUP BY journal_id`,
    );
    expect(journals.rows.every((r) => r.balance === "0")).toBe(true);
    await expect(deletePlatformAccount(db, f.admin, f.account.id)).rejects.toMatchObject({
      code: "ACCOUNT_IN_USE",
    });
  });
  it("penolakan wajib alasan, bisa ajukan bukti baru, dan bukti tidak diproses dua kali", async () => {
    const f = await setup(),
      rental = await approved(f),
      p = await proof(f, rental.id, 150001),
      version = (await getRental(rental.id)).version;
    await expect(
      decidePayment(db, f.admin, p.id, { version, decision: "ditolak" }),
    ).rejects.toThrow();
    await decidePayment(db, f.admin, p.id, {
      version,
      decision: "ditolak",
      reason: "Tidak ditemukan di mutasi",
    });
    expect((await getRental(rental.id)).status).toBe("DISETUJUI");
    expect(await db.select().from(s.ledgerEntries)).toHaveLength(0);
    await expect(decide(f, p.id, rental.id, 150001)).rejects.toMatchObject({
      code: "PAYMENT_ALREADY_REVIEWED",
    });
    const next = await proof(f, rental.id, 150001);
    await decide(f, next.id, rental.id, 150001);
    expect((await getRental(rental.id)).status).toBe("DIBAYAR");
  });
  it("verifikasi idempoten dan admin peserta ditolak", async () => {
    const f = await setup(),
      rental = await approved(f),
      p = await proof(f, rental.id, 150001),
      version = (await getRental(rental.id)).version,
      key = crypto.randomUUID();
    await expect(
      decidePayment(db, { ...f.renter, role: "admin" }, p.id, {
        version,
        decision: "diterima",
        verifiedAmount: 150001,
      }),
    ).rejects.toMatchObject({ code: "SELF_REVIEW_FORBIDDEN" });
    const input = { version, decision: "diterima", verifiedAmount: 150001 };
    await decidePayment(db, f.admin, p.id, input, key);
    await decidePayment(db, f.admin, p.id, input, key);
    expect(await db.select().from(s.ledgerEntries)).toHaveLength(2);
  });
  it("kedaluwarsa setelah bayar parsial membuat kewajiban refund sekali dan saldo ditahan nol", async () => {
    const f = await setup(),
      rental = await approved(f),
      p = await proof(f, rental.id, 50000);
    await decide(f, p.id, rental.id, 50000);
    await db
      .update(s.rentals)
      .set({ payBy: new Date(Date.now() - 1000) })
      .where(eq(s.rentals.id, rental.id));
    expect(await expireRentals(db, "payments")).toEqual({ expired: 1 });
    expect(await expireRentals(db, "payments")).toEqual({ expired: 0 });
    expect(await db.select().from(s.payoutTasks)).toMatchObject([
      { amount: 50000, kind: "refund_penyewa" },
    ]);
    const balance = await db.execute<{ balance: string }>(
      sql`SELECT sum(credit-debit)::text AS balance FROM ledger_entries WHERE account='dana_ditahan'`,
    );
    expect(balance.rows[0].balance).toBe("0");
  });
  it("bukti yang baru diverifikasi setelah final menjadi refund, bukan menghidupkan transaksi", async () => {
    const f = await setup(),
      rental = await approved(f),
      p = await proof(f, rental.id, 150001);
    await db.update(s.rentals).set({ status: "KADALUARSA" }).where(eq(s.rentals.id, rental.id));
    await decide(f, p.id, rental.id, 150001);
    expect((await getRental(rental.id)).status).toBe("KADALUARSA");
    expect(await db.select().from(s.payoutTasks)).toMatchObject([{ amount: 150001 }]);
  });
  it("trigger database menolak jurnal tidak seimbang dan perubahan ledger", async () => {
    const f = await setup(),
      rental = await approved(f),
      p = await proof(f, rental.id, 150001);
    await decide(f, p.id, rental.id, 150001);
    await expect(
      db.transaction((tx) =>
        tx.insert(s.ledgerEntries).values({
          journalId: crypto.randomUUID(),
          rentalId: rental.id,
          account: "kas:test",
          debit: 1,
          credit: 0,
          memo: "Invalid",
        }),
      ),
    ).rejects.toThrow();
    await expect(db.update(s.ledgerEntries).set({ debit: 1 })).rejects.toThrow();
  });
});
describe("chat, isolasi, dan notifikasi", () => {
  it("kode transaksi dalam pesan sistem terbaca, pesan pengantar pengguna tetap difilter", async () => {
    const f = await setup(),
      request = await createRental(db, f.renter, {
        ...f.input,
        message: "Hubungi 081234567890 https://example.com",
      });
    const rental = await getRental(request.id),
      room = await conversationMessages(db, f.owner, rental.conversationId);
    expect(room.messages.find((m) => m.type === "system")?.text).toContain(request.publicCode);
    expect(room.messages.find((m) => m.type === "system")?.redacted).toBe(false);
    expect(room.messages.find((m) => m.type === "text")?.redacted).toBe(true);
    expect(room.messages.find((m) => m.type === "text")?.text).not.toContain("081234");
  });
  it("memakai satu percakapan per barang/pasangan, menyamarkan tampilan, menjaga teks asli, dan status dibaca", async () => {
    const f = await setup(),
      chat = await openConversation(db, f.renter, f.item.id);
    expect((await openConversation(db, f.renter, f.item.id)).id).toBe(chat.id);
    const sent = await sendMessage(db, f.renter, chat.id, {
      body: "Hubungi 081234567890 https://example.com",
    });
    expect((await conversationMessages(db, f.owner, chat.id)).messages[0].text).not.toContain(
      "081234",
    );
    expect((await db.select().from(s.messages))[0].body).toContain("081234567890");
    expect((await conversationList(db, f.owner))[0].unread).toBe(1);
    await markConversationRead(db, f.owner, chat.id, sent.id);
    expect((await conversationList(db, f.owner))[0].unread).toBe(0);
    await expect(adminConversation(db, f.admin, chat.id)).rejects.toMatchObject({ status: 403 });
    await reportMessage(db, f.owner, sent.id, "Mengajak transaksi di luar aplikasi");
    expect((await adminConversation(db, f.admin, chat.id)).messages[0].originalBody).toContain(
      "081234",
    );
    const stranger = await user(db);
    await expect(conversationMessages(db, stranger, chat.id)).rejects.toMatchObject({
      status: 404,
    });
  });
  it("blokir mencegah pesan dan pengajuan baru lalu bisa dicabut", async () => {
    const f = await setup(),
      chat = await openConversation(db, f.renter, f.item.id);
    await blockUser(db, f.owner, f.renter.id, true);
    await expect(sendMessage(db, f.renter, chat.id, { body: "Halo" })).rejects.toMatchObject({
      code: "USER_BLOCKED",
    });
    await expect(createRental(db, f.renter, f.input)).rejects.toMatchObject({
      code: "USER_BLOCKED",
    });
    await blockUser(db, f.owner, f.renter.id, false);
    await sendMessage(db, f.renter, chat.id, { body: "Halo lagi" });
  });
  it("batas 30 pesan per menit dan pesan terlalu panjang ditolak", async () => {
    const f = await setup(),
      chat = await openConversation(db, f.renter, f.item.id);
    await db.insert(s.messages).values(
      Array.from({ length: 30 }, () => ({
        conversationId: chat.id,
        senderId: f.renter.id,
        type: "text",
        body: "Halo",
      })),
    );
    await expect(sendMessage(db, f.renter, chat.id, { body: "Pesan 31" })).rejects.toMatchObject({
      code: "RATE_LIMITED",
    });
    await expect(sendMessage(db, f.renter, chat.id, { body: "a".repeat(2001) })).rejects.toThrow();
  });
  it("job melewati permintaan kedaluwarsa dan tidak mengakhiri bukti yang menunggu admin", async () => {
    const f = await setup(),
      request = await createRental(db, f.renter, f.input);
    await db
      .update(s.rentals)
      .set({ respondBy: new Date(Date.now() - 1000) })
      .where(eq(s.rentals.id, request.id));
    expect((await expireRentals(db, "requests")).expired).toBe(1);
    const rental = await approved(f);
    await proof(f, rental.id, 150001);
    await db
      .update(s.rentals)
      .set({ payBy: new Date(Date.now() - 1000) })
      .where(eq(s.rentals.id, rental.id));
    expect((await expireRentals(db, "payments")).expired).toBe(0);
    expect((await getRental(rental.id)).status).toBe("MENUNGGU_VERIFIKASI");
  });
  it.each(["approve", "reject", "cancel"] as const)(
    "pengajuan dan aksi %s terkirim ke peserta yang tepat tanpa duplikat retry",
    async (action) => {
      const f = await setup(),
        key = crypto.randomUUID(),
        request = await createRental(db, f.renter, f.input, key);
      await createRental(db, f.renter, f.input, key);
      const actor = action === "cancel" ? f.renter : f.owner;
      await actOnRental(db, actor, request.id, action, { version: 1, reason: "Pengujian" });
      expect((await deliverNotifications(db)).sent).toBe(2);
      expect(mocks.sendMessage.mock.calls[0][0]).toBe(f.owner.telegramChatId);
      expect(mocks.sendMessage.mock.calls[0][1]).toContain("Ada pengajuan sewa baru");
      expect(mocks.sendMessage.mock.calls[1][0]).toBe(
        action === "cancel" ? f.owner.telegramChatId : f.renter.telegramChatId,
      );
      expect((await deliverNotifications(db)).sent).toBe(0);
      expect(mocks.sendMessage).toHaveBeenCalledTimes(2);
    },
  );
  it("tugas admin membuat satu pesan grup dan in-app untuk tiap admin aktif tanpa DM admin", async () => {
    const f = await setup();
    await user(db, { role: "admin" });
    await user(db, { role: "admin", accountStatus: "ditangguhkan" });
    await db
      .update(s.users)
      .set({ telegramBlockedAt: new Date() })
      .where(eq(s.users.id, f.admin.id));
    process.env.TELEGRAM_ADMIN_CHAT_ID = "-1001234567890";
    await db.transaction((tx) =>
      notifyAdmins(tx, "Bukti baru", "Cocokkan mutasi", "/admin/pembayaran"),
    );
    expect(await db.select().from(s.notifications)).toHaveLength(2);
    expect(await db.select().from(s.notificationDeliveries)).toHaveLength(1);
    expect((await deliverNotifications(db)).sent).toBe(1);
    expect(mocks.sendMessage.mock.calls[0][0]).toBe(-1001234567890);
    expect(mocks.sendMessage).toHaveBeenCalledTimes(1);
    const [limit] = await db
      .select()
      .from(s.deliveryThrottles)
      .where(eq(s.deliveryThrottles.key, "chat:-1001234567890"));
    expect(limit.nextAt.getTime()).toBeGreaterThan(Date.now() + 2000);
  });
  it.each(["", "123456", "bukan-id", "-0", "-9007199254740992"])(
    "tugas admin tetap in-app jika konfigurasi grup tidak valid: %s",
    async (group) => {
      await setup();
      process.env.TELEGRAM_ADMIN_CHAT_ID = group;
      await notifyAdmins(db, "Tugas baru", "Periksa antrean", "/admin");
      expect(await db.select().from(s.notifications)).toHaveLength(1);
      expect(await db.select().from(s.notificationDeliveries)).toHaveLength(0);
      expect((await deliverNotifications(db)).sent).toBe(0);
    },
  );
  it("keputusan identitas dan listing masuk Telegram, pesan chat tetap in-app", async () => {
    const f = await setup();
    for (const type of ["verification_decided", "listing_decided", "chat_message"])
      await notify(db, f.owner.id, type, "Pembaruan", "Hasil pemeriksaan", "/profil");
    expect(await db.select().from(s.notifications)).toHaveLength(3);
    expect(await db.select().from(s.notificationDeliveries)).toHaveLength(2);
    expect((await deliverNotifications(db)).sent).toBe(2);
  });
  it("antrean grup yang menunggu tidak menahan pesan pribadi dan tetap bisa diproses worker berikutnya", async () => {
    const f = await setup();
    process.env.TELEGRAM_ADMIN_CHAT_ID = "-1001234567890";
    await notifyAdmins(db, "Tugas", "Periksa antrean", "/admin");
    await notify(db, f.owner.id, "rental_requested", "Pengajuan", "Pengajuan baru", "/transaksi");
    await db
      .insert(s.deliveryThrottles)
      .values({ key: "chat:-1001234567890", nextAt: new Date(Date.now() + 5000) });
    expect((await deliverNotifications(db)).sent).toBe(1);
    expect(mocks.sendMessage.mock.calls[0][0]).toBe(f.owner.telegramChatId);
    const [pending] = await db
      .select()
      .from(s.notificationDeliveries)
      .where(eq(s.notificationDeliveries.status, "antre"));
    expect(pending.attempts).toBe(0);
    expect(pending.claimedUntil).toBeNull();
    await db.execute(sql`TRUNCATE delivery_throttles`);
    await db
      .update(s.notificationDeliveries)
      .set({ nextAttemptAt: new Date(Date.now() - 1) })
      .where(eq(s.notificationDeliveries.id, pending.id));
    expect((await deliverNotifications(db)).sent).toBe(1);
    expect(mocks.sendMessage.mock.calls[1][0]).toBe(-1001234567890);
  });
  it("batas waktu worker meninggalkan pesan yang masih menunggu throttle untuk pemanggilan berikutnya", async () => {
    const f = await setup();
    await notify(db, f.owner.id, "rental_requested", "Pengajuan", "Pengajuan baru", "/transaksi");
    await db.insert(s.deliveryThrottles).values({
      key: `chat:${f.owner.telegramChatId}`,
      nextAt: new Date(Date.now() + 2000),
    });
    expect((await deliverNotifications(db, { maxDurationMs: 50 })).sent).toBe(0);
    const [pending] = await db.select().from(s.notificationDeliveries);
    expect(pending.status).toBe("antre");
    expect(pending.attempts).toBe(0);
    expect(pending.claimedUntil).toBeNull();
  });
  it("rollback aksi membatalkan notifikasi dan outbox sekaligus", async () => {
    const f = await setup();
    await expect(
      db.transaction(async (tx) => {
        await notify(tx, f.owner.id, "rental_requested", "Pengajuan", "Uji rollback", "/transaksi");
        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");
    expect(await db.select().from(s.notifications)).toHaveLength(0);
    expect(await db.select().from(s.notificationDeliveries)).toHaveLength(0);
    expect((await deliverNotifications(db)).sent).toBe(0);
  });
  it("worker segera dan cron yang bersamaan tidak mengirim delivery yang sama dua kali", async () => {
    const f = await setup();
    await createRental(db, f.renter, f.input);
    const results = await Promise.all([deliverNotifications(db), deliverNotifications(db)]);
    expect(results.reduce((total, result) => total + result.sent, 0)).toBe(1);
    expect(mocks.sendMessage).toHaveBeenCalledTimes(1);
  });
  it("outbox mengirim satu kali, 429 dijadwalkan ulang, 403 menandai bot diblokir", async () => {
    const f = await setup();
    await createRental(db, f.renter, f.input);
    const result = await deliverNotifications(db);
    expect(result.sent).toBe(1);
    expect(mocks.sendMessage).toHaveBeenCalledTimes(1);
    expect((await deliverNotifications(db)).sent).toBe(0);
    await db.execute(sql`TRUNCATE delivery_throttles`);
    const [n] = await db
      .insert(s.notifications)
      .values({
        userId: f.renter.id,
        type: "payment_decided",
        title: "Uji",
        body: "Uji",
        link: "/transaksi",
      })
      .returning();
    mocks.sendMessage.mockRejectedValueOnce({ error_code: 429, parameters: { retry_after: 120 } });
    await deliverNotifications(db);
    const [pending] = await db
      .select()
      .from(s.notificationDeliveries)
      .where(eq(s.notificationDeliveries.notificationId, n.id));
    expect(pending.status).toBe("antre");
    expect(pending.nextAttemptAt.getTime()).toBeGreaterThan(Date.now() + 110000);
    await db
      .update(s.notificationDeliveries)
      .set({ nextAttemptAt: new Date(Date.now() - 1) })
      .where(eq(s.notificationDeliveries.id, pending.id));
    await db.execute(sql`TRUNCATE delivery_throttles`);
    mocks.sendMessage.mockRejectedValueOnce({ error_code: 403 });
    await deliverNotifications(db);
    expect(
      (await db.select().from(s.users).where(eq(s.users.id, f.renter.id)))[0].telegramBlockedAt,
    ).not.toBeNull();
  });
});
