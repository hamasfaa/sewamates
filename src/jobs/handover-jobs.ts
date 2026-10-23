import { and, asc, desc, eq, inArray, lt, sql } from "drizzle-orm";
import type { Database, Executor } from "@/src/db";
import {
  handoverRecords,
  noShowReports,
  payoutTasks,
  rentalEvents,
  rentals,
  sentAlerts,
  type Rental,
} from "@/src/db/schema";
import { phaseOf } from "@/src/domain/handover";
import { dateWib } from "@/src/lib/utils";
import { lockRental, transitionRental } from "@/src/services/rental-service";
import { settleRental } from "@/src/services/settlement-service";
import { giveStrike } from "@/src/services/strike-service";
import { openDispute } from "@/src/services/dispute-service";
import { notify } from "@/src/services/notification-service";

// Jobs run every minute and re-check each row under its lock, so repeated runs are harmless.
const BATCH = 100;
const hours = (key: string) => sql`(${rentals.rulesSnapshot}->>${key})::int * interval '1 hour'`;
async function notifyBoth(tx: Executor, rental: Rental, type: string, title: string, body: string) {
  for (const userId of [rental.ownerId, rental.renterId])
    await notify(
      tx,
      userId,
      type,
      title,
      `${rental.publicCode}: ${body}`,
      `/transaksi/${rental.id}`,
    );
}
// Not paid, or paid without any handover, 24 h after the schedule: full refund, no strike (A-3.5).
export async function staleStart(db: Database) {
  const candidates = await db
    .select({ id: rentals.id })
    .from(rentals)
    .where(
      and(
        inArray(rentals.status, ["MENUNGGU_VERIFIKASI", "DIBAYAR"]),
        sql`${rentals.startAt} + ${hours("stale_start_hours")} < now()`,
      ),
    )
    .orderBy(asc(rentals.startAt))
    .limit(BATCH);
  let cancelled = 0;
  for (const { id } of candidates)
    await db.transaction(async (tx) => {
      const rental = await lockRental(tx, id),
        limit = rental.rulesSnapshot.stale_start_hours;
      if (
        !["MENUNGGU_VERIFIKASI", "DIBAYAR"].includes(rental.status) ||
        rental.startAt.getTime() + limit * 3600000 > Date.now()
      )
        return;
      // A pending no-show report is resolved by its own timeout first.
      const [report] = await tx
        .select({ id: noShowReports.id })
        .from(noShowReports)
        .where(and(eq(noShowReports.rentalId, id), eq(noShowReports.status, "menunggu")))
        .limit(1);
      if (report) return;
      const next = await transitionRental(
        tx,
        rental,
        "DIBATALKAN",
        { type: "system" },
        { job: "stale-start" },
      );
      await settleRental(tx, next);
      await notifyBoth(
        tx,
        rental,
        "rental_cancelled",
        "Transaksi dibatalkan otomatis",
        rental.status === "DIBAYAR"
          ? `serah terima tidak terjadi dalam ${limit} jam setelah jadwal. Dana dikembalikan penuh ke penyewa.`
          : `pembayaran belum lunas ${limit} jam setelah jadwal. Dana yang masuk dikembalikan penuh.`,
      );
      cancelled++;
    });
  return { cancelled };
}
// Silence until the check window ends counts as "Sesuai" (A-3.5).
export async function closeReviewWindow(db: Database) {
  const candidates = await db
    .select({ id: rentals.id })
    .from(rentals)
    .where(and(eq(rentals.status, "DIKEMBALIKAN"), lt(rentals.reviewEndsAt, new Date())))
    .orderBy(asc(rentals.reviewEndsAt))
    .limit(BATCH);
  let closed = 0;
  for (const { id } of candidates)
    await db.transaction(async (tx) => {
      const rental = await lockRental(tx, id);
      if (
        rental.status !== "DIKEMBALIKAN" ||
        !rental.reviewEndsAt ||
        rental.reviewEndsAt > new Date()
      )
        return;
      const next = await transitionRental(
        tx,
        rental,
        "PENCAIRAN_DIPROSES",
        { type: "system" },
        { job: "close-review-window" },
      );
      await settleRental(tx, next, "normal");
      closed++;
    });
  return { closed };
}
// Late notices once; after 72 h the item is treated as lost, unless the owner missed the
// return, in which case 72 h run from that report and the category is tidak_hadir (A-3.5, A-3.7).
export async function overdueReturns(db: Database) {
  const now = new Date();
  const late = await db
    .select({ id: rentals.id })
    .from(rentals)
    .where(
      and(
        eq(rentals.status, "BERJALAN"),
        lt(rentals.dueAt, now),
        sql`NOT EXISTS (SELECT 1 FROM sent_alerts a WHERE a.kind = 'late' AND a.target_id = "rentals"."id")`,
      ),
    )
    .limit(BATCH);
  let notified = 0,
    escalated = 0;
  for (const { id } of late)
    await db.transaction(async (tx) => {
      const rental = await lockRental(tx, id);
      if (rental.status !== "BERJALAN" || rental.dueAt > new Date()) return;
      const [alert] = await tx
        .insert(sentAlerts)
        .values({ kind: "late", targetId: rental.id })
        .onConflictDoNothing()
        .returning();
      if (!alert) return;
      await notifyBoth(
        tx,
        rental,
        "rental_late",
        "Barang terlambat dikembalikan",
        `jatuh tempo ${dateWib(rental.dueAt)} sudah lewat. Denda dihitung setelah toleransi ${rental.rulesSnapshot.late_grace_hours} jam.`,
      );
      notified++;
    });
  const lost = await db
    .select({ id: rentals.id })
    .from(rentals)
    .where(
      and(
        eq(rentals.status, "BERJALAN"),
        sql`(${rentals.dueAt} + ${hours("lost_after_hours")} < now() OR EXISTS (SELECT 1 FROM no_show_reports n WHERE n.rental_id = "rentals"."id" AND n.phase = 'end' AND n.status = 'diterima' AND n.reported_party = "rentals"."owner_id" AND n.created_at + ("rentals"."rules_snapshot"->>'no_show_return_hours')::int * interval '1 hour' < now()))`,
      ),
    )
    .limit(BATCH);
  for (const { id } of lost)
    await db.transaction(async (tx) => {
      const rental = await lockRental(tx, id),
        rules = rental.rulesSnapshot;
      if (rental.status !== "BERJALAN") return;
      const [ownerAbsent] = await tx
        .select()
        .from(noShowReports)
        .where(
          and(
            eq(noShowReports.rentalId, id),
            eq(noShowReports.phase, "end"),
            eq(noShowReports.status, "diterima"),
            eq(noShowReports.reportedParty, rental.ownerId),
          ),
        )
        .orderBy(desc(noShowReports.createdAt))
        .limit(1);
      const deadline = ownerAbsent
        ? ownerAbsent.createdAt.getTime() + rules.no_show_return_hours * 3600000
        : rental.dueAt.getTime() + rules.lost_after_hours * 3600000;
      if (deadline > Date.now()) return;
      await openDispute(tx, rental, {
        openedBy: null,
        category: ownerAbsent ? "tidak_hadir" : "hilang",
        description: ownerAbsent
          ? `Barang belum kembali ${rules.no_show_return_hours} jam setelah laporan pemilik tidak hadir saat pengembalian.`
          : `Barang belum dikembalikan ${rules.lost_after_hours} jam setelah jatuh tempo.`,
        meta: { job: "overdue-returns" },
      });
      escalated++;
    });
  return { notified, escalated };
}
// Unanswered no-show reports apply the consequences in A-3.5 after 12 h.
export async function noShowTimeouts(db: Database) {
  const due = await db
    .select({ id: noShowReports.id, rentalId: noShowReports.rentalId })
    .from(noShowReports)
    .where(and(eq(noShowReports.status, "menunggu"), lt(noShowReports.respondBy, new Date())))
    .orderBy(asc(noShowReports.respondBy))
    .limit(BATCH);
  let applied = 0;
  for (const { id, rentalId } of due)
    await db.transaction(async (tx) => {
      const rental = await lockRental(tx, rentalId),
        now = new Date();
      const [report] = await tx
        .select()
        .from(noShowReports)
        .where(eq(noShowReports.id, id))
        .for("update");
      if (report.status !== "menunggu" || report.respondBy > now) return;
      if (phaseOf(rental.status) !== report.phase) {
        await tx
          .update(noShowReports)
          .set({ status: "gugur", resolvedAt: now })
          .where(eq(noShowReports.id, id));
        return;
      }
      await tx
        .update(noShowReports)
        .set({ status: "diterima", resolvedAt: now })
        .where(eq(noShowReports.id, id));
      const ownerAbsent = report.reportedParty === rental.ownerId,
        meta = {
          job: "no-show-timeouts",
          noShowReportId: id,
          absent: ownerAbsent ? "owner" : "renter",
        };
      if (report.phase === "start") {
        // Owner absent: full refund. Renter absent: treated as a late cancellation (A-3.6).
        const next = await transitionRental(
          tx,
          rental,
          "DIBATALKAN",
          { type: "system" },
          meta,
          ownerAbsent
            ? {}
            : {
                cancelledBy: rental.renterId,
                cancelReason: "Penyewa tidak hadir saat serah terima.",
              },
        );
        await settleRental(tx, next, ownerAbsent ? "refund_penuh" : "biaya_batal");
        await giveStrike(tx, report.reportedParty, "tidak_hadir", rental);
        await notifyBoth(
          tx,
          rental,
          "no_show_resolved",
          "Laporan tidak hadir diterapkan",
          ownerAbsent
            ? "pemilik tidak hadir dan tidak membantah. Transaksi dibatalkan, dana dikembalikan penuh."
            : "penyewa tidak hadir dan tidak membantah. Transaksi dibatalkan dengan biaya batal.",
        );
      } else {
        // The return stays open; an absent owner stops late fees at the renter's arrival.
        const [record] = ownerAbsent
          ? await tx
              .select()
              .from(handoverRecords)
              .where(and(eq(handoverRecords.rentalId, rental.id), eq(handoverRecords.type, "end")))
          : [];
        await tx
          .update(rentals)
          .set({
            version: rental.version + 1,
            ...(ownerAbsent ? { lateUntil: record?.renterArrivedAt ?? report.createdAt } : {}),
          })
          .where(eq(rentals.id, rental.id));
        await tx.insert(rentalEvents).values({
          rentalId: rental.id,
          fromStatus: rental.status,
          toStatus: rental.status,
          actorType: "system",
          meta: { ...meta, action: "no_show_accepted" },
        });
        if (ownerAbsent) await giveStrike(tx, rental.ownerId, "tidak_hadir", rental);
        await notifyBoth(
          tx,
          rental,
          "no_show_resolved",
          "Laporan tidak hadir diterapkan",
          ownerAbsent
            ? "pemilik tidak hadir saat pengembalian. Denda telat berhenti dihitung; atur ulang waktu pengembalian lewat chat."
            : "penyewa tidak hadir saat pengembalian dan dihitung sebagai keterlambatan.",
        );
      }
      applied++;
    });
  return { applied };
}
// Expired claims return to the queue so another admin can take them (04 §6.3).
export async function releaseClaims(db: Database) {
  const released = await db
    .update(payoutTasks)
    .set({ status: "menunggu", claimedBy: null, claimedUntil: null })
    .where(and(eq(payoutTasks.status, "diklaim"), lt(payoutTasks.claimedUntil, new Date())))
    .returning({ id: payoutTasks.id });
  return { released: released.length };
}
