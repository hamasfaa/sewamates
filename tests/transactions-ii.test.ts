import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, inArray, sql } from "drizzle-orm";
import { readFile } from "node:fs/promises";
import type { Database } from "@/src/db";
import * as s from "@/src/db/schema";
import { campusId, resetDatabase, testDatabase, user } from "./helpers/database";
import { addDays, wibDateKey, wibDayStart } from "@/src/domain/availability";
import { encrypt } from "@/src/lib/crypto";
import { actOnRental, createRental, periodSql, rentalDetail } from "@/src/services/rental-service";
import { decidePayment, savePlatformAccount, submitPayment } from "@/src/services/payment-service";
import {
  addHandoverPhoto,
  arrive,
  checkReturn,
  confirmHandover,
  contestNoShow,
  issueHandoverCode,
  reportNoShow,
} from "@/src/services/handover-service";
import { proposeReschedule, respondReschedule } from "@/src/services/reschedule-service";
import {
  addDisputeEvidence,
  disputeDetail,
  disputeQueue,
  reportProblem,
} from "@/src/services/dispute-service";
import {
  cashOverview,
  claimPayout,
  completePayout,
  payoutDetail,
  payoutQueue,
  recordCashMovement,
  releasePayout,
} from "@/src/services/payout-service";
import {
  closeReviewWindow,
  noShowTimeouts,
  overdueReturns,
  releaseClaims,
  staleStart,
} from "@/src/jobs/handover-jobs";
import { reminders, slaFlags } from "@/src/jobs/alert-jobs";
import { adminSummary } from "@/src/services/admin-service";
import { deliverNotifications } from "@/src/jobs/deliver-notifications";

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
let db: Database, close: () => Promise<void>, execRaw: (source: string) => Promise<unknown>;
beforeAll(async () => {
  ({ db, close, execRaw } = await testDatabase());
});
afterAll(async () => {
  await close?.();
});
beforeEach(async () => {
  await resetDatabase(db);
  vi.clearAllMocks();
  process.env.SUPABASE_URL = "https://storage.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test";
  process.env.ACCOUNT_ENCRYPTION_KEY = Buffer.alloc(32, 3).toString("base64");
  delete process.env.TELEGRAM_ADMIN_CHAT_ID;
  mocks.download.mockImplementation(async (path: string) => ({
    data: new Blob([
      Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.from(path)]),
    ]),
    error: null,
  }));
});

const H = 3600000,
  MINUTE = 60000;
const getRental = async (id: string) =>
  (await db.select().from(s.rentals).where(eq(s.rentals.id, id)))[0];
async function setup() {
  const owner = await user(db, { verificationStatus: "terverifikasi", name: "Pemilik Uji" }),
    renter = await user(db, { verificationStatus: "terverifikasi", name: "Penyewa Uji" }),
    admin = await user(db, { role: "super_admin", verificationStatus: "terverifikasi" }),
    admin2 = await user(db, { role: "admin", verificationStatus: "terverifikasi" }),
    stranger = await user(db, { verificationStatus: "terverifikasi" });
  for (const [person, number] of [
    [owner, "081200001111"],
    [renter, "081200006789"],
  ] as const)
    await db.insert(s.payoutAccounts).values({
      userId: person.id,
      type: "ewallet",
      provider: "GoPay",
      accountNoEnc: encrypt(number),
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
  const start = new Date(wibDayStart(addDays(wibDateKey(new Date()), 2)).getTime() + 10 * H);
  const input = { itemId: item.id, pickupPointId: point.id, startAt: start.toISOString(), days: 1 };
  return { owner, renter, admin, admin2, stranger, item, point, account, input, start };
}
type Fixture = Awaited<ReturnType<typeof setup>>;
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
async function proof(f: Fixture, rentalId: string, amount: number) {
  return submitPayment(db, f.renter, rentalId, {
    platformAccountId: f.account.id,
    proofPath: await ticket(f.renter.id, "payment_proof"),
    senderName: "Penyewa Uji",
    transferredAt: new Date().toISOString(),
    claimedAmount: amount,
  });
}
async function accept(f: Fixture, paymentId: string, rentalId: string, amount: number) {
  return decidePayment(db, f.admin, paymentId, {
    decision: "diterima",
    verifiedAmount: amount,
    version: (await getRental(rentalId)).version,
  });
}
async function approved(f: Fixture) {
  const request = await createRental(db, f.renter, f.input);
  await actOnRental(db, f.owner, request.id, "approve", { version: 1 });
  return getRental(request.id);
}
async function paid(f: Fixture) {
  const rental = await approved(f),
    payment = await proof(f, rental.id, rental.amountDue);
  await accept(f, payment.id, rental.id, rental.amountDue);
  return getRental(rental.id);
}
// Moves the schedule while keeping the due_at and block_period constraints intact.
async function moveSchedule(id: string, start: Date) {
  const rental = await getRental(id),
    due = new Date(start.getTime() + rental.days * 86400000);
  await db
    .update(s.rentals)
    .set({
      startAt: start,
      dueAt: due,
      blockPeriod: periodSql(start, new Date(due.getTime() + 3 * H)) as unknown as string,
    })
    .where(eq(s.rentals.id, id));
}
async function photo(actor: s.User, rentalId: string, source: "camera" | "gallery" = "camera") {
  return addHandoverPhoto(db, actor, rentalId, {
    path: await ticket(actor.id, "handover_photo"),
    source,
  });
}
async function handOver(f: Fixture, rentalId: string) {
  await arrive(db, f.owner, rentalId, {});
  await arrive(db, f.renter, rentalId, {});
  await photo(f.renter, rentalId);
  await photo(f.renter, rentalId, "gallery");
  const { code } = await issueHandoverCode(db, f.renter, rentalId);
  return confirmHandover(db, f.owner, rentalId, { code, photosConfirmed: true });
}
async function giveBack(f: Fixture, rentalId: string, arrived = false) {
  if (!arrived) {
    await arrive(db, f.owner, rentalId, {});
    await arrive(db, f.renter, rentalId, {});
  }
  await photo(f.owner, rentalId);
  await photo(f.owner, rentalId);
  const { code } = await issueHandoverCode(db, f.owner, rentalId);
  return confirmHandover(db, f.renter, rentalId, { code });
}
async function balance(account: string, rentalId?: string) {
  const result = await db.execute<{ value: string }>(
    sql`SELECT coalesce(sum(debit - credit), 0)::text AS value FROM ledger_entries WHERE account = ${account} ${rentalId ? sql`AND rental_id = ${rentalId}` : sql``}`,
  );
  return Number(result.rows[0].value);
}
const tasksOf = (rentalId: string) =>
  db.select().from(s.payoutTasks).where(eq(s.payoutTasks.rentalId, rentalId));
const strikesOf = (userId: string) =>
  db.select().from(s.strikes).where(eq(s.strikes.userId, userId));
async function finishPayout(f: Fixture, admin: s.User, taskId: string, fee = 2500) {
  await claimPayout(db, admin, taskId);
  const [task] = await db.select().from(s.payoutTasks).where(eq(s.payoutTasks.id, taskId));
  return completePayout(db, admin, taskId, {
    sourceAccountId: f.account.id,
    transferredAmount: task.amount,
    transferFee: fee,
    transferredAt: new Date().toISOString(),
    proofPath: await ticket(admin.id, "payout_proof"),
  });
}

describe("serah terima, pengembalian, dan pencairan", () => {
  it("alur lengkap berakhir SELESAI dengan bukti pencairan dan ledger seimbang", async () => {
    const f = await setup(),
      rental = await paid(f);
    await moveSchedule(rental.id, new Date(Date.now() + 10 * MINUTE));
    expect((await handOver(f, rental.id)).status).toBe("BERJALAN");
    await expect(
      actOnRental(db, f.renter, rental.id, "cancel", {
        version: (await getRental(rental.id)).version,
      }),
    ).rejects.toMatchObject({ code: "CANCEL_UNAVAILABLE" });
    expect((await giveBack(f, rental.id)).status).toBe("DIKEMBALIKAN");
    let r = await getRental(rental.id);
    expect(r.lateFee).toBe(0);
    expect(r.reviewEndsAt!.getTime()).toBeGreaterThan(Date.now() + 23 * H);
    const detail = await rentalDetail(db, f.renter, rental.id);
    expect(detail.preview).toMatchObject({
      owner: 45000,
      renter: r.amountReceived - 50000,
      commission: 5000,
      lateFee: 0,
    });
    expect(detail.handover.start?.photos.map((p) => p.source)).toEqual(["camera", "gallery"]);
    expect(detail.handover.end?.photos).toHaveLength(2);
    expect(detail.actions).toMatchObject({ canCheck: true, canDispute: true, canCancel: false });
    await checkReturn(db, f.owner, rental.id, { decision: "sesuai" });
    await checkReturn(db, f.owner, rental.id, { decision: "sesuai" });
    const checks = await db
      .select()
      .from(s.notifications)
      .where(eq(s.notifications.type, "return_check_confirmed"));
    expect(checks).toHaveLength(1);
    expect(checks[0].userId).toBe(f.renter.id);
    expect((await getRental(rental.id)).status).toBe("DIKEMBALIKAN");
    await checkReturn(db, f.renter, rental.id, { decision: "sesuai" });
    r = await getRental(rental.id);
    expect(r.status).toBe("PENCAIRAN_DIPROSES");
    expect(r.settlement).toMatchObject({ reason: "normal", owner: 45000, commission: 5000 });
    const tasks = await tasksOf(rental.id);
    expect(tasks.map((t) => [t.kind, t.recipientId, t.amount]).sort()).toEqual(
      [
        ["pencairan_pemilik", f.owner.id, 45000],
        ["refund_penyewa", f.renter.id, r.amountReceived - 50000],
      ].sort(),
    );
    expect(await balance("dana_ditahan", rental.id)).toBe(0);
    for (const task of tasks) await finishPayout(f, f.admin2, task.id);
    r = await getRental(rental.id);
    expect(r.status).toBe("SELESAI");
    expect(await balance("hutang_pemilik")).toBe(0);
    expect(await balance("hutang_penyewa")).toBe(0);
    expect(await balance("pendapatan_komisi")).toBe(-5000);
    expect(await balance("biaya_transfer")).toBe(5000);
    expect(await balance(`kas:${f.account.id}`)).toBe(0);
    const people = await db
      .select({ completedCount: s.users.completedCount })
      .from(s.users)
      .where(inArray(s.users.id, [f.owner.id, f.renter.id]));
    expect(people.map((p) => p.completedCount)).toEqual([1, 1]);
    const view = await rentalDetail(db, f.renter, rental.id);
    const refund = view.payouts.find((p) => p.kind === "refund_penyewa")!;
    expect(refund).toMatchObject({
      status: "selesai",
      proofUrl: "https://storage.test/private",
      account: { provider: "GoPay", accountNo: "•••• 6789" },
    });
    expect(view.payouts.find((p) => p.kind === "pencairan_pemilik")).toMatchObject({
      proofUrl: null,
      account: null,
    });
    const types = (await db.select({ type: s.notifications.type }).from(s.notifications)).map(
      (n) => n.type,
    );
    expect(types).toEqual(expect.arrayContaining(["payout_completed", "return_completed"]));
    for (const type of ["handover_completed", "return_completed", "payout_scheduled"]) {
      const notifications = await db
        .select()
        .from(s.notifications)
        .where(eq(s.notifications.type, type));
      expect(notifications.map((n) => n.userId).sort()).toEqual([f.owner.id, f.renter.id].sort());
      expect(
        await db
          .select()
          .from(s.notificationDeliveries)
          .where(
            inArray(
              s.notificationDeliveries.notificationId,
              notifications.map((n) => n.id),
            ),
          ),
      ).toHaveLength(2);
    }
  });
  it("kedatangan kedua pihak pada dua tahap mengirim Telegram ke pihak lawan sekali", async () => {
    const f = await setup(),
      rental = await paid(f);
    process.env.TELEGRAM_BOT_TOKEN = "test-only";
    mocks.sendMessage.mockResolvedValue({ message_id: 987 });
    await moveSchedule(rental.id, new Date(Date.now() + 10 * MINUTE));
    const arriveRepeatedly = async () => {
      for (const actor of [f.renter, f.owner]) {
        const key = crypto.randomUUID();
        await arrive(db, actor, rental.id, {}, key);
        await arrive(db, actor, rental.id, {}, key);
        await arrive(db, actor, rental.id, {}, crypto.randomUUID());
      }
    };
    await arriveRepeatedly();
    await handOver(f, rental.id);
    await arriveRepeatedly();
    await giveBack(f, rental.id, true);
    const arrivals = await db
      .select()
      .from(s.notifications)
      .where(eq(s.notifications.type, "handover_arrived"));
    expect(arrivals).toHaveLength(4);
    for (const notification of arrivals) {
      const actor = notification.body.includes(": penyewa ") ? f.renter : f.owner;
      expect(notification.userId).toBe(actor.id === f.renter.id ? f.owner.id : f.renter.id);
    }
    expect(arrivals.filter((n) => n.body.includes("pengembalian"))).toHaveLength(2);
    const deliveries = await db
      .select()
      .from(s.notificationDeliveries)
      .where(
        inArray(
          s.notificationDeliveries.notificationId,
          arrivals.map((n) => n.id),
        ),
      );
    expect(deliveries).toHaveLength(4);
    expect(deliveries.every((d) => d.chatId === null)).toBe(true);
    const deliveryIds = deliveries.map((d) => d.id);
    expect((await deliverNotifications(db, { deliveryIds })).sent).toBe(4);
    expect((await deliverNotifications(db, { deliveryIds })).sent).toBe(0);
    expect(mocks.sendMessage.mock.calls.map((call) => call[0]).sort()).toEqual(
      [
        f.owner.telegramChatId,
        f.owner.telegramChatId,
        f.renter.telegramChatId,
        f.renter.telegramChatId,
      ].sort(),
    );
    await checkReturn(db, f.renter, rental.id, { decision: "sesuai" });
    await checkReturn(db, f.renter, rental.id, { decision: "sesuai" });
    const checks = await db
      .select()
      .from(s.notifications)
      .where(eq(s.notifications.type, "return_check_confirmed"));
    expect(checks).toHaveLength(1);
    expect(checks[0].userId).toBe(f.owner.id);
  });
  it("kode wajib setelah dua foto, salah tercatat, dan terkunci setelah lima kali", async () => {
    const f = await setup(),
      rental = await paid(f);
    await moveSchedule(rental.id, new Date(Date.now() + 10 * MINUTE));
    await expect(photo(f.renter, rental.id)).rejects.toMatchObject({ code: "WAITING_ARRIVAL" });
    await arrive(db, f.owner, rental.id, {
      location: { latitude: -7.28, longitude: 112.79, accuracy: 20 },
    });
    await arrive(db, f.renter, rental.id, {});
    await expect(photo(f.owner, rental.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(issueHandoverCode(db, f.renter, rental.id)).rejects.toMatchObject({
      code: "PHOTOS_REQUIRED",
    });
    await photo(f.renter, rental.id);
    await photo(f.renter, rental.id);
    await expect(issueHandoverCode(db, f.owner, rental.id)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    const { code } = await issueHandoverCode(db, f.renter, rental.id);
    expect(code).toMatch(/^\d{6}$/);
    const [record] = await db.select().from(s.handoverRecords);
    expect(record.codeHash).toMatch(/^[0-9a-f]{64}$/);
    expect(record.ownerLocation).toMatchObject({ latitude: -7.28 });
    const wrong = code === "000000" ? "111111" : "000000";
    await expect(confirmHandover(db, f.owner, rental.id, { code })).rejects.toMatchObject({
      code: "PHOTOS_UNCONFIRMED",
    });
    for (const left of [4, 3, 2, 1])
      await expect(
        confirmHandover(db, f.owner, rental.id, { code: wrong, photosConfirmed: true }),
      ).rejects.toMatchObject({
        code: "WRONG_CODE",
        message: expect.stringContaining(`Sisa ${left}`),
      });
    await expect(
      confirmHandover(db, f.owner, rental.id, { code: wrong, photosConfirmed: true }),
    ).rejects.toMatchObject({ code: "CODE_LOCKED", status: 429 });
    await expect(
      confirmHandover(db, f.owner, rental.id, { code, photosConfirmed: true }),
    ).rejects.toMatchObject({ code: "CODE_LOCKED" });
    expect(
      (await rentalDetail(db, f.owner, rental.id)).handover.start?.codeLockedUntil,
    ).toBeTruthy();
    await db.update(s.handoverRecords).set({ codeLockedUntil: new Date(Date.now() - 1000) });
    expect(
      (await confirmHandover(db, f.owner, rental.id, { code, photosConfirmed: true })).status,
    ).toBe("BERJALAN");
    const [done] = await db.select().from(s.handoverRecords);
    expect(done).toMatchObject({ codeHash: null });
    expect(done.photosConfirmedAt).toBeTruthy();
    await expect(
      db
        .update(s.handoverPhotos)
        .set({ source: "camera" })
        .where(sql`true`),
    ).rejects.toThrow();
  });
  it("jadwal baru wajib foto baru; arsip, batas foto per jadwal, dan pengembalian tetap berlaku", async () => {
    const f = await setup(),
      rental = await paid(f);
    const meet = async () => {
      await moveSchedule(rental.id, new Date(Date.now() + 10 * MINUTE));
      await arrive(db, f.owner, rental.id, {});
      await arrive(db, f.renter, rental.id, {});
    };
    await meet();
    for (let i = 0; i < 8; i++) await photo(f.renter, rental.id);
    let { code } = await issueHandoverCode(db, f.renter, rental.id);
    const oldPhotos = (await rentalDetail(db, f.renter, rental.id)).handover.start!.photos;
    const rejected = await proposeReschedule(db, f.renter, rental.id, {
      version: (await getRental(rental.id)).version,
      startAt: f.start.toISOString(),
    });
    await respondReschedule(db, f.owner, rental.id, rejected.id, {
      version: rejected.version,
      decision: "ditolak",
    });
    expect((await rentalDetail(db, f.renter, rental.id)).actions.shooterPhotos).toBe(8);

    for (const revision of [1, 2]) {
      const request = await proposeReschedule(db, f.renter, rental.id, {
        version: (await getRental(rental.id)).version,
        startAt: new Date(f.start.getTime() + (revision - 1) * 86400000).toISOString(),
      });
      await respondReschedule(db, f.owner, rental.id, request.id, {
        version: request.version,
        decision: "disetujui",
      });
      let detail = await rentalDetail(db, f.renter, rental.id);
      expect(detail.handover.start).toMatchObject({ ownerArrivedAt: null, renterArrivedAt: null });
      expect(detail.actions).toMatchObject({ shooterPhotos: 0, canShowCode: false });
      expect(detail.handover.start!.photos.every((photo) => !photo.currentSchedule)).toBe(true);
      await meet();
      await expect(issueHandoverCode(db, f.renter, rental.id)).rejects.toMatchObject({
        code: "PHOTOS_REQUIRED",
      });
      await expect(
        confirmHandover(db, f.owner, rental.id, { code, photosConfirmed: true }),
      ).rejects.toMatchObject({ code: "PHOTOS_REQUIRED" });
      await photo(f.renter, rental.id);
      await expect(issueHandoverCode(db, f.renter, rental.id)).rejects.toMatchObject({
        code: "PHOTOS_REQUIRED",
      });
      await photo(f.renter, rental.id, "gallery");
      detail = await rentalDetail(db, f.renter, rental.id);
      expect(detail.actions).toMatchObject({ shooterPhotos: 2, canShowCode: true });
      expect(detail.handover.start!.photos.filter((photo) => photo.currentSchedule)).toHaveLength(
        2,
      );
      expect(detail.handover.start!.photos.slice(0, 8)).toEqual(
        oldPhotos.map((photo) => ({ ...photo, currentSchedule: false })),
      );
      ({ code } = await issueHandoverCode(db, f.renter, rental.id));
    }
    await confirmHandover(db, f.owner, rental.id, { code, photosConfirmed: true });
    await giveBack(f, rental.id);
    const detail = await rentalDetail(db, f.renter, rental.id);
    expect(detail.rental.status).toBe("DIKEMBALIKAN");
    expect(detail.handover.end!.photos).toHaveLength(2);
    expect(detail.handover.end!.photos.every((photo) => photo.currentSchedule)).toBe(true);
    await expect(
      db
        .update(s.handoverPhotos)
        .set({ rescheduleCount: 2 })
        .where(sql`true`),
    ).rejects.toThrow();
  });
  it("migrasi foto lama mengenali jadwal disetujui tanpa mengubah atau membuka bukti", async () => {
    const f = await setup(),
      rental = await paid(f);
    await moveSchedule(rental.id, new Date(Date.now() + 10 * MINUTE));
    await arrive(db, f.renter, rental.id, {});
    const request = await proposeReschedule(db, f.renter, rental.id, {
      version: (await getRental(rental.id)).version,
      startAt: f.start.toISOString(),
    });
    await respondReschedule(db, f.owner, rental.id, request.id, {
      version: request.version,
      decision: "disetujui",
    });
    const [accepted] = await db
      .select()
      .from(s.rescheduleRequests)
      .where(eq(s.rescheduleRequests.id, request.id));
    const [record] = await db
      .select()
      .from(s.handoverRecords)
      .where(eq(s.handoverRecords.rentalId, rental.id));
    const received = accepted.respondedAt!;
    await db.insert(s.rescheduleRequests).values({
      rentalId: rental.id,
      proposedBy: f.owner.id,
      newStartAt: f.start,
      status: "ditolak",
      respondedAt: new Date(received.getTime() - 2 * H),
    });
    const photos = await db
      .insert(s.handoverPhotos)
      .values(
        [-H, 0, H].map((offset) => ({
          handoverId: record.id,
          uploadedBy: f.renter.id,
          path: `${f.renter.id}/handover_photo/${crypto.randomUUID()}.png`,
          source: "gallery" as const,
          receivedAt: new Date(received.getTime() + offset),
        })),
      )
      .returning();
    // Recreate the pre-0009 shape with existing evidence, then run the actual migration.
    await db.execute(sql`ALTER TABLE handover_photos DROP COLUMN reschedule_count`);
    const migration = await readFile(
      "supabase/migrations/0009_handover_photo_schedule.sql",
      "utf8",
    );
    await execRaw(`BEGIN;\n${migration}\nCOMMIT;`);
    for (const [index, photo] of photos.entries()) {
      const [stored] = await db
        .select()
        .from(s.handoverPhotos)
        .where(eq(s.handoverPhotos.id, photo.id));
      expect(stored).toEqual({ ...photo, rescheduleCount: index === 2 ? 1 : 0 });
    }
    await expect(db.update(s.handoverPhotos).set({ source: "camera" })).rejects.toThrow();
    await expect(db.delete(s.handoverPhotos)).rejects.toThrow();
  });
  it("telat 30 jam memotong deposit, memberi strike, dan masa cek habis mencairkan dana", async () => {
    const f = await setup(),
      rental = await paid(f);
    await moveSchedule(rental.id, new Date(Date.now() + 10 * MINUTE));
    await handOver(f, rental.id);
    await moveSchedule(rental.id, new Date(Date.now() - 54 * H));
    await giveBack(f, rental.id);
    let r = await getRental(rental.id);
    expect(r.lateFee).toBe(50000);
    expect(await strikesOf(f.renter.id)).toMatchObject([{ reason: "terlambat" }]);
    expect(await closeReviewWindow(db)).toEqual({ closed: 0 });
    await db
      .update(s.rentals)
      .set({ reviewEndsAt: new Date(Date.now() - 1000) })
      .where(eq(s.rentals.id, rental.id));
    expect(await closeReviewWindow(db)).toEqual({ closed: 1 });
    expect(await closeReviewWindow(db)).toEqual({ closed: 0 });
    r = await getRental(rental.id);
    expect(r.status).toBe("PENCAIRAN_DIPROSES");
    expect(r.settlement).toMatchObject({
      owner: 95000,
      renter: r.amountReceived - 100000,
      commission: 5000,
      lateFee: 50000,
    });
    expect(await balance("dana_ditahan", rental.id)).toBe(0);
  });
  it("masalah saat masa cek membuka satu sengketa dengan bukti kedua pihak dan menahan dana", async () => {
    const f = await setup(),
      rental = await paid(f);
    await moveSchedule(rental.id, new Date(Date.now() + 10 * MINUTE));
    await handOver(f, rental.id);
    await giveBack(f, rental.id);
    const evidence = await ticket(f.owner.id, "dispute_evidence");
    await expect(
      checkReturn(db, f.owner, rental.id, {
        decision: "masalah",
        category: "rusak",
        description: "pendek",
        evidencePaths: [],
      }),
    ).rejects.toThrow();
    const opened = await checkReturn(db, f.owner, rental.id, {
      decision: "masalah",
      category: "rusak",
      description: "Lensa tergores saat barang dikembalikan.",
      evidencePaths: [evidence],
    });
    expect(opened.status).toBe("SENGKETA");
    expect((await getRental(rental.id)).statusBeforeDispute).toBe("DIKEMBALIKAN");
    await expect(
      reportProblem(db, f.renter, rental.id, {
        category: "lainnya",
        description: "Saya juga ingin melaporkan masalah lain.",
      }),
    ).rejects.toMatchObject({ code: "DISPUTE_UNAVAILABLE" });
    const more = await ticket(f.renter.id, "dispute_evidence");
    await addDisputeEvidence(db, f.renter, opened.disputeId!, {
      paths: [more],
      note: "Foto saat serah terima.",
    });
    await expect(
      addDisputeEvidence(db, f.stranger, opened.disputeId!, { paths: [more] }),
    ).rejects.toMatchObject({ status: 404 });
    const many = await Promise.all(
      Array.from({ length: 10 }, () => ticket(f.owner.id, "dispute_evidence")),
    );
    await expect(
      addDisputeEvidence(db, f.owner, opened.disputeId!, { paths: many }),
    ).rejects.toMatchObject({ code: "EVIDENCE_LIMIT" });
    expect(await disputeQueue(db, f.admin)).toHaveLength(1);
    const detail = await disputeDetail(db, f.admin, opened.disputeId!);
    expect(detail.dispute.evidence).toHaveLength(2);
    expect(detail.photos).toHaveLength(4);
    expect(detail.messages.length).toBeGreaterThan(0);
    const [audit] = await db
      .select()
      .from(s.adminAuditLogs)
      .where(eq(s.adminAuditLogs.action, "dispute_viewed"));
    expect(audit.targetId).toBe(opened.disputeId);
    await db.update(s.rentals).set({ reviewEndsAt: new Date(Date.now() - 1000) });
    expect(await closeReviewWindow(db)).toEqual({ closed: 0 });
    expect(await tasksOf(rental.id)).toHaveLength(0);
    await expect(
      db.insert(s.disputes).values({
        rentalId: rental.id,
        category: "lainnya",
        description: "Sistem",
        openedFromStatus: "DIKEMBALIKAN",
        respondBy: new Date(),
        decideBy: new Date(),
      }),
    ).rejects.toThrow();
    expect((await adminSummary(db, f.admin)).disputesOpen).toBe(1);
  });
});

describe("pembatalan, tidak hadir, dan jadwal ulang", () => {
  it("pembatalan setelah dibayar mengikuti tabel A-3.6", async () => {
    const f = await setup();
    let rental = await paid(f);
    await expect(
      actOnRental(db, f.renter, rental.id, "cancel", { version: rental.version, fee: 10000 }),
    ).rejects.toMatchObject({ code: "CANCEL_TERMS_CHANGED" });
    await actOnRental(db, f.renter, rental.id, "cancel", { version: rental.version, fee: 0 });
    expect(await tasksOf(rental.id)).toMatchObject([
      { kind: "refund_penyewa", amount: rental.amountReceived },
    ]);
    rental = await paid(f);
    await moveSchedule(rental.id, new Date(Date.now() + 5 * H));
    expect((await rentalDetail(db, f.renter, rental.id)).cancellation).toMatchObject({
      fee: 10000,
      owner: 9000,
      commission: 1000,
      refund: rental.amountReceived - 10000,
      strike: false,
    });
    await actOnRental(db, f.renter, rental.id, "cancel", { version: rental.version, fee: 10000 });
    const split = await tasksOf(rental.id);
    expect(split.map((t) => [t.kind, t.amount]).sort()).toEqual(
      [
        ["pencairan_pemilik", 9000],
        ["refund_penyewa", rental.amountReceived - 10000],
      ].sort(),
    );
    expect((await getRental(rental.id)).settlement).toMatchObject({
      reason: "biaya_batal",
      cancellationFee: 10000,
    });
    expect(await strikesOf(f.renter.id)).toHaveLength(0);
    rental = await paid(f);
    expect((await rentalDetail(db, f.owner, rental.id)).cancellation).toMatchObject({
      fee: 0,
      strike: true,
    });
    await actOnRental(db, f.owner, rental.id, "cancel", { version: rental.version, fee: 0 });
    expect(await strikesOf(f.owner.id)).toMatchObject([{ reason: "batal_setelah_dibayar" }]);
    expect(await balance("dana_ditahan")).toBe(0);
    expect(await balance("pendapatan_komisi")).toBe(-1000);
    const strikeNotices = await db
      .select()
      .from(s.notifications)
      .where(eq(s.notifications.type, "strike_given"));
    expect(strikeNotices).toHaveLength(1);
    const [delivery] = await db
      .select()
      .from(s.notificationDeliveries)
      .where(eq(s.notificationDeliveries.notificationId, strikeNotices[0].id));
    expect(delivery).toBeTruthy();
  });
  it("transaksi yang menunggu verifikasi pembayaran tidak bisa dibatalkan", async () => {
    const f = await setup(),
      rental = await approved(f);
    await proof(f, rental.id, rental.amountDue);
    await expect(
      actOnRental(db, f.renter, rental.id, "cancel", {
        version: (await getRental(rental.id)).version,
      }),
    ).rejects.toMatchObject({ code: "CANCEL_UNAVAILABLE" });
  });
  it("pemilik tidak hadir: laporan setelah 30 menit, tanpa bantahan dibatalkan dengan strike", async () => {
    const f = await setup(),
      rental = await paid(f);
    await moveSchedule(rental.id, new Date(Date.now() - 20 * MINUTE));
    await arrive(db, f.renter, rental.id, {});
    await expect(reportNoShow(db, f.renter, rental.id)).rejects.toMatchObject({
      code: "NO_SHOW_TOO_EARLY",
    });
    await moveSchedule(rental.id, new Date(Date.now() - 31 * MINUTE));
    await expect(reportNoShow(db, f.owner, rental.id)).rejects.toMatchObject({
      code: "ARRIVAL_REQUIRED",
    });
    expect((await rentalDetail(db, f.renter, rental.id)).actions.canReportNoShow).toBe(true);
    await reportNoShow(db, f.renter, rental.id);
    await expect(reportNoShow(db, f.renter, rental.id)).rejects.toMatchObject({
      code: "NO_SHOW_EXISTS",
    });
    expect((await rentalDetail(db, f.owner, rental.id)).actions.canContestNoShow).toBe(true);
    await expect(
      actOnRental(db, f.owner, rental.id, "cancel", {
        version: (await getRental(rental.id)).version,
        fee: 0,
      }),
    ).rejects.toMatchObject({ code: "NO_SHOW_PENDING" });
    await moveSchedule(rental.id, new Date(Date.now() - 25 * H));
    expect(await staleStart(db)).toEqual({ cancelled: 0 });
    expect(await noShowTimeouts(db)).toEqual({ applied: 0 });
    await db.update(s.noShowReports).set({ respondBy: new Date(Date.now() - 1000) });
    expect(await noShowTimeouts(db)).toEqual({ applied: 1 });
    const r = await getRental(rental.id);
    expect(r.status).toBe("DIBATALKAN");
    expect(await tasksOf(rental.id)).toMatchObject([
      { kind: "refund_penyewa", amount: r.amountReceived },
    ]);
    expect(await strikesOf(f.owner.id)).toMatchObject([{ reason: "tidak_hadir" }]);
    const [report] = await db.select().from(s.noShowReports);
    expect(report.status).toBe("diterima");
    const [reported] = await db
      .select()
      .from(s.notifications)
      .where(eq(s.notifications.type, "no_show_reported"));
    expect(reported.userId).toBe(f.owner.id);
    expect(
      await db
        .select()
        .from(s.notificationDeliveries)
        .where(eq(s.notificationDeliveries.notificationId, reported.id)),
    ).toHaveLength(1);
    const arrived = await db
      .select({ id: s.notifications.id })
      .from(s.notifications)
      .where(eq(s.notifications.type, "handover_arrived"));
    expect(
      await db
        .select()
        .from(s.notificationDeliveries)
        .where(
          inArray(
            s.notificationDeliveries.notificationId,
            arrived.map((n) => n.id),
          ),
        ),
    ).toHaveLength(arrived.length);
  });
  it("penyewa tidak hadir kena biaya batal; bantahan membuka sengketa tidak hadir", async () => {
    const f = await setup();
    let rental = await paid(f);
    await moveSchedule(rental.id, new Date(Date.now() - 31 * MINUTE));
    await arrive(db, f.owner, rental.id, {});
    await reportNoShow(db, f.owner, rental.id);
    await db.update(s.noShowReports).set({ respondBy: new Date(Date.now() - 1000) });
    await noShowTimeouts(db);
    let r = await getRental(rental.id);
    expect(r).toMatchObject({ status: "DIBATALKAN", cancelledBy: f.renter.id });
    expect(r.settlement).toMatchObject({ reason: "biaya_batal", owner: 9000, commission: 1000 });
    expect(await strikesOf(f.renter.id)).toMatchObject([{ reason: "tidak_hadir" }]);
    rental = await paid(f);
    await moveSchedule(rental.id, new Date(Date.now() - 31 * MINUTE));
    await arrive(db, f.owner, rental.id, {});
    const report = await reportNoShow(db, f.owner, rental.id);
    await expect(
      contestNoShow(db, f.owner, rental.id, report.id, {
        description: "Saya sudah datang tepat waktu ke titik.",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const contested = await contestNoShow(db, f.renter, rental.id, report.id, {
      description: "Saya sudah di titik, pemilik menunggu di gedung lain.",
      evidencePaths: [await ticket(f.renter.id, "dispute_evidence")],
    });
    expect(contested.status).toBe("SENGKETA");
    const [dispute] = await db.select().from(s.disputes).where(eq(s.disputes.rentalId, rental.id));
    expect(dispute).toMatchObject({ category: "tidak_hadir", openedFromStatus: "DIBAYAR" });
    r = await getRental(rental.id);
    expect(r.statusBeforeDispute).toBe("DIBAYAR");
    await db.update(s.noShowReports).set({ respondBy: new Date(Date.now() - 1000) });
    expect(await noShowTimeouts(db)).toEqual({ applied: 0 });
    expect(await tasksOf(rental.id)).toHaveLength(0);
  });
  it("pemilik tidak hadir saat pengembalian menghentikan denda pada waktu kedatangan penyewa", async () => {
    const f = await setup(),
      rental = await paid(f);
    await moveSchedule(rental.id, new Date(Date.now() + 10 * MINUTE));
    await handOver(f, rental.id);
    await moveSchedule(rental.id, new Date(Date.now() - 35 * H));
    const due = (await getRental(rental.id)).dueAt;
    await arrive(db, f.renter, rental.id, {});
    await reportNoShow(db, f.renter, rental.id);
    await db
      .update(s.handoverRecords)
      .set({ renterArrivedAt: new Date(due.getTime() + H) })
      .where(eq(s.handoverRecords.type, "end"));
    await db.update(s.noShowReports).set({ respondBy: new Date(Date.now() - 1000) });
    expect(await noShowTimeouts(db)).toEqual({ applied: 1 });
    expect((await getRental(rental.id)).lateUntil).toEqual(new Date(due.getTime() + H));
    expect(await strikesOf(f.owner.id)).toMatchObject([{ reason: "tidak_hadir" }]);
    await arrive(db, f.owner, rental.id, {});
    await giveBack(f, rental.id, true);
    const r = await getRental(rental.id);
    expect(r).toMatchObject({ status: "DIKEMBALIKAN", lateFee: 0 });
    expect(await strikesOf(f.renter.id)).toHaveLength(0);
  });
  it("lewat 72 jam otomatis sengketa hilang; laporan pemilik tidak hadir memakai batas sendiri", async () => {
    const f = await setup();
    let rental = await paid(f);
    await moveSchedule(rental.id, new Date(Date.now() + 10 * MINUTE));
    await handOver(f, rental.id);
    await moveSchedule(rental.id, new Date(Date.now() - (24 + 73) * H));
    expect(await overdueReturns(db)).toEqual({ notified: 1, escalated: 1 });
    expect(await overdueReturns(db)).toEqual({ notified: 0, escalated: 0 });
    let [dispute] = await db.select().from(s.disputes).where(eq(s.disputes.rentalId, rental.id));
    expect(dispute).toMatchObject({ category: "hilang", openedBy: null });
    expect((await getRental(rental.id)).status).toBe("SENGKETA");
    const late = await db
      .select()
      .from(s.notifications)
      .where(eq(s.notifications.type, "rental_late"));
    expect(late.map((n) => n.userId).sort()).toEqual([f.owner.id, f.renter.id].sort());
    rental = await paid(f);
    await moveSchedule(rental.id, new Date(Date.now() + 10 * MINUTE));
    await handOver(f, rental.id);
    await moveSchedule(rental.id, new Date(Date.now() - 25 * H));
    await arrive(db, f.renter, rental.id, {});
    await reportNoShow(db, f.renter, rental.id);
    await db.update(s.noShowReports).set({ respondBy: new Date(Date.now() - 1000) });
    await noShowTimeouts(db);
    await moveSchedule(rental.id, new Date(Date.now() - (24 + 80) * H));
    expect((await overdueReturns(db)).escalated).toBe(0);
    await db
      .update(s.noShowReports)
      .set({ createdAt: new Date(Date.now() - 73 * H) })
      .where(eq(s.noShowReports.rentalId, rental.id));
    expect((await overdueReturns(db)).escalated).toBe(1);
    [dispute] = await db.select().from(s.disputes).where(eq(s.disputes.rentalId, rental.id));
    expect(dispute.category).toBe("tidak_hadir");
  });
  it("jadwal ulang disetujui pihak lain, menggeser jatuh tempo, dan dibatasi dua kali", async () => {
    const f = await setup(),
      rental = await paid(f);
    const version = (await getRental(rental.id)).version,
      next = new Date(rental.startAt.getTime() + 86400000);
    await expect(
      proposeReschedule(db, f.owner, rental.id, {
        version,
        startAt: rental.startAt.toISOString(),
      }),
    ).rejects.toMatchObject({ code: "SAME_SCHEDULE" });
    await expect(
      proposeReschedule(db, f.owner, rental.id, {
        version,
        startAt: new Date(rental.startAt.getTime() + 12 * H).toISOString(),
      }),
    ).rejects.toMatchObject({ code: "POINT_CLOSED" });
    const blocked = new Date(rental.startAt.getTime() + 6 * 86400000);
    await db.execute(
      sql`INSERT INTO availability_blocks(item_id, period) VALUES (${f.item.id}, tstzrange(${blocked.toISOString()}::timestamptz, ${new Date(blocked.getTime() + H).toISOString()}::timestamptz, '[)'))`,
    );
    await expect(
      proposeReschedule(db, f.owner, rental.id, { version, startAt: blocked.toISOString() }),
    ).rejects.toMatchObject({ code: "DATES_UNAVAILABLE" });
    const request = await proposeReschedule(db, f.owner, rental.id, {
      version,
      startAt: next.toISOString(),
    });
    await expect(
      proposeReschedule(db, f.renter, rental.id, {
        version: request.version,
        startAt: new Date(next.getTime() + 86400000).toISOString(),
      }),
    ).rejects.toMatchObject({ code: "RESCHEDULE_PENDING" });
    await expect(
      respondReschedule(db, f.owner, rental.id, request.id, {
        version: request.version,
        decision: "disetujui",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await respondReschedule(db, f.renter, rental.id, request.id, {
      version: request.version,
      decision: "disetujui",
    });
    let r = await getRental(rental.id);
    expect(r).toMatchObject({ startAt: next, rescheduleCount: 1 });
    expect(r.dueAt).toEqual(new Date(next.getTime() + 86400000));
    const range = await db.execute<{ moved: boolean }>(
      sql`SELECT lower(block_period) = ${next.toISOString()}::timestamptz AS moved FROM rentals WHERE id = ${rental.id}`,
    );
    expect(range.rows[0].moved).toBe(true);
    const second = await proposeReschedule(db, f.renter, rental.id, {
      version: r.version,
      startAt: new Date(next.getTime() + 86400000).toISOString(),
    });
    await respondReschedule(db, f.owner, rental.id, second.id, {
      version: second.version,
      decision: "ditolak",
    });
    r = await getRental(rental.id);
    expect(r.rescheduleCount).toBe(1);
    const third = await proposeReschedule(db, f.renter, rental.id, {
      version: r.version,
      startAt: new Date(next.getTime() + 86400000).toISOString(),
    });
    await respondReschedule(db, f.owner, rental.id, third.id, {
      version: third.version,
      decision: "disetujui",
    });
    r = await getRental(rental.id);
    expect(r.rescheduleCount).toBe(2);
    await expect(
      proposeReschedule(db, f.owner, rental.id, {
        version: r.version,
        startAt: new Date(next.getTime() + 2 * 86400000).toISOString(),
      }),
    ).rejects.toMatchObject({ code: "RESCHEDULE_LIMIT" });
    const decided = await db
      .select()
      .from(s.notifications)
      .where(eq(s.notifications.type, "reschedule_decided"));
    expect(decided).toHaveLength(3);
  });
  it("stale-start membatalkan tanpa serah terima; bukti terlambat menjadi refund terpisah", async () => {
    const f = await setup(),
      rental = await approved(f);
    const first = await proof(f, rental.id, 50000);
    await accept(f, first.id, rental.id, 50000);
    const second = await proof(f, rental.id, rental.amountDue - 50000);
    await moveSchedule(rental.id, new Date(Date.now() - 25 * H));
    expect(await staleStart(db)).toEqual({ cancelled: 1 });
    expect(await staleStart(db)).toEqual({ cancelled: 0 });
    expect((await getRental(rental.id)).status).toBe("DIBATALKAN");
    expect(await tasksOf(rental.id)).toMatchObject([{ amount: 50000, sourcePaymentId: null }]);
    await accept(f, second.id, rental.id, rental.amountDue - 50000);
    expect((await getRental(rental.id)).status).toBe("DIBATALKAN");
    const tasks = await tasksOf(rental.id);
    expect(tasks).toHaveLength(2);
    expect(tasks.find((t) => t.sourcePaymentId === second.id)?.amount).toBe(
      rental.amountDue - 50000,
    );
    expect(await balance("dana_ditahan", rental.id)).toBe(0);
    const paidRental = await paid(f);
    await moveSchedule(paidRental.id, new Date(Date.now() - 25 * H));
    expect(await staleStart(db)).toEqual({ cancelled: 1 });
    expect(await tasksOf(paidRental.id)).toMatchObject([
      { kind: "refund_penyewa", amount: paidRental.amountReceived },
    ]);
    expect(await db.select().from(s.strikes)).toHaveLength(0);
  });
  it("pihak lain tidak bisa memakai aksi serah terima dan tombol hadir dibuka 60 menit sebelum jadwal", async () => {
    const f = await setup(),
      rental = await paid(f);
    await moveSchedule(rental.id, new Date(Date.now() + 3 * H));
    await expect(arrive(db, f.renter, rental.id, {})).rejects.toMatchObject({ code: "TOO_EARLY" });
    for (const call of [
      () => arrive(db, f.stranger, rental.id, {}),
      () => issueHandoverCode(db, f.stranger, rental.id),
      () => reportNoShow(db, f.stranger, rental.id),
      () => checkReturn(db, f.stranger, rental.id, { decision: "sesuai" }),
      () =>
        proposeReschedule(db, f.stranger, rental.id, {
          version: rental.version,
          startAt: new Date(Date.now() + 26 * H).toISOString(),
        }),
    ])
      await expect(call()).rejects.toMatchObject({ status: 404 });
    const staff = await rentalDetail(db, f.admin, rental.id);
    expect(staff.actions).toMatchObject({
      canArrive: false,
      canCancel: false,
      canReschedule: false,
    });
  });
});

describe("pencairan manual dan kas", () => {
  it("klaim bersamaan hanya satu, non-pengklaim ditolak, klaim kedaluwarsa dilepas", async () => {
    const f = await setup(),
      rental = await paid(f);
    await actOnRental(db, f.renter, rental.id, "cancel", { version: rental.version, fee: 0 });
    const [task] = await tasksOf(rental.id);
    await expect(claimPayout(db, { ...f.renter, role: "admin" }, task.id)).rejects.toMatchObject({
      code: "SELF_PAYOUT_FORBIDDEN",
    });
    await expect(claimPayout(db, f.renter, task.id)).rejects.toMatchObject({ status: 403 });
    const results = await Promise.allSettled([
      claimPayout(db, f.admin, task.id),
      claimPayout(db, f.admin2, task.id),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
    const [winner, loser] =
      results[0].status === "fulfilled" ? [f.admin, f.admin2] : [f.admin2, f.admin];
    const queued = await payoutQueue(db, loser, {});
    expect(queued[0]).toMatchObject({ id: task.id, status: "diklaim", claimedBy: winner.id });
    const input = async (amount = task.amount) => ({
      sourceAccountId: f.account.id,
      transferredAmount: amount,
      transferFee: 0,
      transferredAt: new Date().toISOString(),
      proofPath: await ticket(winner.id, "payout_proof"),
    });
    await expect(
      completePayout(db, loser, task.id, {
        ...(await input()),
        proofPath: await ticket(loser.id, "payout_proof"),
      }),
    ).rejects.toMatchObject({ code: "CLAIM_REQUIRED" });
    await expect(
      completePayout(db, winner, task.id, await input(task.amount - 1)),
    ).rejects.toMatchObject({
      code: "AMOUNT_MISMATCH",
    });
    await db
      .update(s.payoutTasks)
      .set({ claimedUntil: new Date(Date.now() - 1000) })
      .where(eq(s.payoutTasks.id, task.id));
    await expect(completePayout(db, winner, task.id, await input())).rejects.toMatchObject({
      code: "CLAIM_REQUIRED",
    });
    expect(await releaseClaims(db)).toEqual({ released: 1 });
    await claimPayout(db, loser, task.id);
    await releasePayout(db, loser, task.id);
    await expect(releasePayout(db, loser, task.id)).rejects.toMatchObject({
      code: "CLAIM_REQUIRED",
    });
    const done = await finishPayout(f, loser, task.id, 0);
    expect(done).toMatchObject({ status: "selesai", rentalStatus: "DIBATALKAN" });
    await expect(
      db.update(s.payoutTasks).set({ amount: 1 }).where(eq(s.payoutTasks.id, task.id)),
    ).rejects.toThrow();
    await expect(claimPayout(db, f.admin, task.id)).rejects.toMatchObject({
      code: "PAYOUT_CLAIMED",
    });
    expect((await payoutQueue(db, f.admin, { state: "done" }))[0].id).toBe(task.id);
    const detail = await payoutDetail(db, f.admin, task.id);
    expect(detail.account).toMatchObject({ accountNo: "081200006789", provider: "GoPay" });
    expect(detail.proofUrl).toBe("https://storage.test/private");
    const audits = (
      await db.select({ action: s.adminAuditLogs.action }).from(s.adminAuditLogs)
    ).map((a) => a.action);
    expect(audits).toEqual(
      expect.arrayContaining(["payout_claimed", "payout_completed", "payout_account_viewed"]),
    );
    expect(await balance("hutang_penyewa")).toBe(0);
    const [notice] = await db
      .select()
      .from(s.notifications)
      .where(
        and(eq(s.notifications.type, "payout_completed"), eq(s.notifications.userId, f.renter.id)),
      );
    expect(notice.body).toContain("GoPay");
  });
  it("pemindahan antar rekening dicatat dengan bukti, biaya, dan saldo kas", async () => {
    const f = await setup();
    const ovo = await savePlatformAccount(db, f.admin, null, {
      type: "ewallet",
      provider: "OVO",
      accountNo: "081200002222",
      accountName: "Platform OVO",
    });
    const proofPath = await ticket(f.admin.id, "cash_proof");
    const movement = {
      fromAccountId: ovo.id,
      toAccountId: f.account.id,
      amount: 100000,
      fee: 1000,
      proofPath,
    };
    await expect(recordCashMovement(db, f.renter, movement)).rejects.toMatchObject({ status: 403 });
    await expect(
      recordCashMovement(db, f.admin, { ...movement, toAccountId: ovo.id }),
    ).rejects.toThrow();
    await recordCashMovement(db, f.admin2, {
      ...movement,
      proofPath: await ticket(f.admin2.id, "cash_proof"),
    });
    await expect(recordCashMovement(db, f.admin, movement)).resolves.toBeTruthy();
    await expect(recordCashMovement(db, f.admin, movement)).rejects.toMatchObject({
      code: "INVALID_UPLOAD",
    });
    const overview = await cashOverview(db, f.admin);
    expect(overview.accounts.find((a) => a.id === ovo.id)?.balance).toBe(-202000);
    expect(overview.accounts.find((a) => a.id === f.account.id)?.balance).toBe(200000);
    expect(overview.totals.transferFees).toBe(2000);
    expect(overview.movements[0]).toMatchObject({
      amount: 100000,
      fee: 1000,
      proofUrl: "https://storage.test/private",
    });
    await expect(db.update(s.cashMovements).set({ amount: 1 })).rejects.toThrow();
  });
  it("pengingat dan penanda lewat target dikirim sekali", async () => {
    const f = await setup(),
      rental = await paid(f);
    await moveSchedule(rental.id, new Date(Date.now() + 30 * MINUTE));
    expect((await reminders(db)).sent).toBe(1);
    expect((await reminders(db)).sent).toBe(0);
    const reminder = await db
      .select()
      .from(s.notifications)
      .where(eq(s.notifications.type, "rental_reminder"));
    expect(reminder.map((n) => n.title)).toEqual([
      "Serah terima 1 jam lagi",
      "Serah terima 1 jam lagi",
    ]);
    await actOnRental(db, f.renter, rental.id, "cancel", {
      version: (await getRental(rental.id)).version,
      fee: 10000,
    });
    await db.update(s.payoutTasks).set({ targetAt: new Date(Date.now() - 1000) });
    expect(await slaFlags(db)).toEqual({ flagged: 2 });
    expect(await slaFlags(db)).toEqual({ flagged: 0 });
    const alerts = await db
      .select()
      .from(s.notifications)
      .where(eq(s.notifications.title, "Antrean lewat target"));
    expect(alerts).toHaveLength(2);
    expect(await adminSummary(db, f.admin)).toMatchObject({ payoutsPending: 2, payoutsOverdue: 2 });
  });
});
