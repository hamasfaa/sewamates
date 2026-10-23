import { and, eq } from "drizzle-orm";
import type { Database, Executor } from "@/src/db";
import {
  handoverRecords,
  noShowReports,
  pickupPoints,
  rentalEvents,
  rentals,
  rescheduleRequests,
  type Rental,
  type User,
} from "@/src/db/schema";
import { mutation } from "@/src/db/mutation";
import { assert } from "@/src/lib/errors";
import { dateWib } from "@/src/lib/utils";
import { rescheduleInput, rescheduleResponseInput } from "@/src/lib/transaction-validation";
import { rentalPeriod, withinPickupHours } from "@/src/domain/availability";
import { HANDOVER_RULES, RESCHEDULE_STATUSES } from "@/src/domain/handover";
import { assertAvailable, lockRental, periodSql, type RentalPatch } from "./rental-service";
import { systemMessage } from "./chat-service";
import { notify } from "./notification-service";
import { partyId, partyOf } from "./handover-service";

// Checked when proposed and again when accepted, since time and other holds move on (A-3.5).
async function validSchedule(tx: Executor, rental: Rental, start: Date) {
  const rules = rental.rulesSnapshot,
    now = Date.now(),
    lead = HANDOVER_RULES.rescheduleLeadMinutes;
  assert(
    RESCHEDULE_STATUSES.includes(rental.status),
    "RESCHEDULE_UNAVAILABLE",
    "Jadwal ulang hanya tersedia sebelum serah terima.",
    409,
  );
  assert(
    rental.rescheduleCount < rules.reschedule_max,
    "RESCHEDULE_LIMIT",
    `Jadwal ulang maksimal ${rules.reschedule_max} kali per transaksi.`,
    409,
  );
  assert(
    start.getTime() !== rental.startAt.getTime(),
    "SAME_SCHEDULE",
    "Pilih jadwal yang berbeda dari jadwal sekarang.",
    422,
  );
  assert(
    start.getTime() >= now + lead * 60000 &&
      start.getTime() <= now + rules.booking_max_days * 86400000,
    "INVALID_SCHEDULE",
    `Pilih waktu minimal ${lead} menit dari sekarang dan maksimal ${rules.booking_max_days} hari ke depan.`,
    422,
  );
  const [point] = await tx
    .select()
    .from(pickupPoints)
    .where(eq(pickupPoints.id, rental.pickupPointId));
  assert(
    point && withinPickupHours(start, point.hours),
    "POINT_CLOSED",
    "Jadwal baru harus dalam jam operasional titik (WIB).",
    422,
  );
  const { due, period } = rentalPeriod(start, rental.days, rules.availability_buffer_hours);
  await assertAvailable(tx, rental.itemId, start, period.end, rental.id);
  const payBy =
    rental.payBy &&
    new Date(
      Math.min(
        rental.payBy.getTime(),
        start.getTime() - rules.payment_before_start_hours * 3600000,
      ),
    );
  assert(
    rental.status !== "DISETUJUI" || (payBy && payBy.getTime() > now),
    "PAYMENT_WINDOW_CLOSED",
    "Jadwal baru terlalu dekat dengan batas pembayaran.",
    409,
  );
  return { due, end: period.end, payBy };
}
export async function proposeReschedule(
  db: Database,
  actor: User,
  rentalId: string,
  raw: unknown,
  key?: string,
) {
  const input = rescheduleInput.parse(raw);
  return mutation(db, actor.id, `rental:${rentalId}:reschedule`, key, input, async (tx) => {
    const rental = await lockRental(tx, rentalId),
      party = partyOf(rental, actor),
      start = new Date(input.startAt);
    assert(
      rental.version === input.version,
      "RENTAL_CHANGED",
      "Transaksi berubah. Muat ulang sebelum melanjutkan.",
      409,
    );
    const [pending] = await tx
      .select({ id: rescheduleRequests.id })
      .from(rescheduleRequests)
      .where(
        and(eq(rescheduleRequests.rentalId, rental.id), eq(rescheduleRequests.status, "menunggu")),
      );
    assert(!pending, "RESCHEDULE_PENDING", "Masih ada usulan jadwal yang menunggu jawaban.", 409);
    await validSchedule(tx, rental, start);
    const [request] = await tx
      .insert(rescheduleRequests)
      .values({ rentalId: rental.id, proposedBy: actor.id, newStartAt: start })
      .returning();
    await tx
      .update(rentals)
      .set({ version: rental.version + 1 })
      .where(eq(rentals.id, rental.id));
    await tx.insert(rentalEvents).values({
      rentalId: rental.id,
      fromStatus: rental.status,
      toStatus: rental.status,
      actorId: actor.id,
      actorType: "user",
      meta: { action: "reschedule_requested", requestId: request.id, startAt: input.startAt },
    });
    await systemMessage(
      tx,
      rental.conversationId,
      rental.id,
      `${rental.publicCode}: usulan jadwal baru ${dateWib(start)}.`,
    );
    await notify(
      tx,
      partyId(rental, party === "owner" ? "renter" : "owner"),
      "reschedule_requested",
      "Usulan jadwal ulang",
      `${rental.publicCode}: jadwal baru ${dateWib(start)}. Setujui atau tolak di halaman transaksi.`,
      `/transaksi/${rental.id}`,
    );
    return { id: request.id, status: request.status, version: rental.version + 1 };
  });
}
export async function respondReschedule(
  db: Database,
  actor: User,
  rentalId: string,
  requestId: string,
  raw: unknown,
  key?: string,
) {
  const input = rescheduleResponseInput.parse(raw);
  return mutation(db, actor.id, `reschedule:${requestId}:respond`, key, input, async (tx) => {
    const rental = await lockRental(tx, rentalId),
      now = new Date();
    partyOf(rental, actor);
    const [request] = await tx
      .select()
      .from(rescheduleRequests)
      .where(and(eq(rescheduleRequests.id, requestId), eq(rescheduleRequests.rentalId, rentalId)))
      .for("update");
    assert(request, "NOT_FOUND", "Usulan jadwal tidak ditemukan.", 404);
    assert(
      request.proposedBy !== actor.id,
      "FORBIDDEN",
      "Usulan jadwal dijawab oleh pihak lain.",
      403,
    );
    assert(
      request.status === "menunggu",
      "RESCHEDULE_CLOSED",
      "Usulan ini sudah dijawab atau kedaluwarsa.",
      409,
    );
    assert(
      rental.version === input.version,
      "RENTAL_CHANGED",
      "Transaksi berubah. Muat ulang sebelum melanjutkan.",
      409,
    );
    const approved = input.decision === "disetujui";
    let patch: RentalPatch = {};
    let meta: Record<string, unknown> = { action: "reschedule_rejected", requestId };
    if (approved) {
      const schedule = await validSchedule(tx, rental, request.newStartAt);
      meta = {
        action: "rescheduled",
        requestId,
        from: rental.startAt.toISOString(),
        to: request.newStartAt.toISOString(),
      };
      // A new meeting needs fresh check-ins; the old ones stay in the event log as evidence.
      const [record] = await tx
        .select()
        .from(handoverRecords)
        .where(and(eq(handoverRecords.rentalId, rental.id), eq(handoverRecords.type, "start")))
        .for("update");
      if (record && !record.completedAt) {
        meta.previousArrivals = {
          owner: record.ownerArrivedAt?.toISOString() ?? null,
          renter: record.renterArrivedAt?.toISOString() ?? null,
        };
        await tx
          .update(handoverRecords)
          .set({
            ownerArrivedAt: null,
            renterArrivedAt: null,
            ownerLocation: null,
            renterLocation: null,
            codeHash: null,
            codeIssuedAt: null,
          })
          .where(eq(handoverRecords.id, record.id));
      }
      await tx
        .update(noShowReports)
        .set({ status: "gugur", resolvedAt: now })
        .where(and(eq(noShowReports.rentalId, rental.id), eq(noShowReports.status, "menunggu")));
      patch = {
        startAt: request.newStartAt,
        dueAt: schedule.due,
        blockPeriod: periodSql(request.newStartAt, schedule.end),
        rescheduleCount: rental.rescheduleCount + 1,
        ...(rental.status !== "DIBAYAR" && schedule.payBy ? { payBy: schedule.payBy } : {}),
      };
    }
    await tx
      .update(rescheduleRequests)
      .set({ status: input.decision, respondedAt: now })
      .where(eq(rescheduleRequests.id, request.id));
    const [next] = await tx
      .update(rentals)
      .set({ ...patch, version: rental.version + 1 })
      .where(eq(rentals.id, rental.id))
      .returning();
    await tx.insert(rentalEvents).values({
      rentalId: rental.id,
      fromStatus: rental.status,
      toStatus: rental.status,
      actorId: actor.id,
      actorType: "user",
      meta,
    });
    await systemMessage(
      tx,
      rental.conversationId,
      rental.id,
      approved
        ? `${rental.publicCode}: jadwal pindah ke ${dateWib(request.newStartAt)}, jatuh tempo ${dateWib(next.dueAt)}.`
        : `${rental.publicCode}: usulan jadwal ulang ditolak.`,
    );
    await notify(
      tx,
      request.proposedBy,
      "reschedule_decided",
      approved ? "Jadwal ulang disetujui" : "Jadwal ulang ditolak",
      approved
        ? `${rental.publicCode}: jadwal baru ${dateWib(request.newStartAt)}.`
        : `${rental.publicCode}: jadwal tetap ${dateWib(rental.startAt)}.`,
      `/transaksi/${rental.id}`,
    );
    return { id: request.id, status: input.decision, version: next.version };
  });
}
