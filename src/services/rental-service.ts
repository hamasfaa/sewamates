import { and, asc, desc, eq, gte, inArray, ne, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { Database, Executor } from "@/src/db";
import {
  adminAuditLogs,
  availabilityBlocks,
  items,
  messages,
  noShowReports,
  payments,
  payoutAccounts,
  platformAccounts,
  rentalEvents,
  rentals,
  rescheduleRequests,
  users,
  type Rental,
  type User,
} from "@/src/db/schema";
import { mutation } from "@/src/db/mutation";
import {
  canTransition,
  HOLD_STATUSES,
  RENTAL_LABELS,
  type RentalStatus,
} from "@/src/domain/rental-state-machine";
import { rentalPeriod, withinPickupHours, wibDateKey } from "@/src/domain/availability";
import { commission, firstFreeCode, paymentTotals } from "@/src/domain/pricing";
import { phaseOf, RESCHEDULE_STATUSES } from "@/src/domain/handover";
import { cancellationFee, cancellationTerms } from "@/src/domain/payout";
import { rentalActionInput, rentalInput } from "@/src/lib/transaction-validation";
import { assert } from "@/src/lib/errors";
import { evidencePreview } from "@/src/lib/storage";
import { requireActive, requireOnboarded, requireVerified } from "./profile-service";
import { itemDetail } from "./item-service";
import { getSettings } from "./settings-service";
import { assertNotBlocked, ensureConversation, systemMessage } from "./chat-service";
import { notify } from "./notification-service";
import { settleRental } from "./settlement-service";
import { giveStrike } from "./strike-service";
import { rentalProgress } from "./rental-progress";
import { lockAccountActivity } from "./account-activity";

export const periodSql = (start: Date, end: Date) =>
  sql`tstzrange(${start.toISOString()}::timestamptz,${end.toISOString()}::timestamptz,'[)')`;
export async function rentalOptions(db: Executor, actor: User, itemId: string) {
  const detail = await itemDetail(db, itemId, actor);
  assert(detail?.publiclyVisible, "NOT_FOUND", "Barang tidak tersedia.", 404);
  const [payout] = await db
    .select({ id: payoutAccounts.id })
    .from(payoutAccounts)
    .where(eq(payoutAccounts.userId, actor.id));
  return {
    item: detail,
    rules: await getSettings(db),
    eligible: {
      verified: actor.verificationStatus === "terverifikasi",
      active: actor.accountStatus === "aktif",
      payout: Boolean(payout),
      isOwner: detail.owner.id === actor.id,
    },
  };
}
export async function assertAvailable(
  tx: Executor,
  itemId: string,
  start: Date,
  end: Date,
  excludeId?: string,
) {
  const period = periodSql(start, end);
  const [hold] = await tx
    .select({ id: rentals.id })
    .from(rentals)
    .where(
      and(
        eq(rentals.itemId, itemId),
        inArray(rentals.status, HOLD_STATUSES),
        excludeId ? ne(rentals.id, excludeId) : undefined,
        sql`${rentals.blockPeriod} && ${period}`,
      ),
    )
    .limit(1);
  const [block] = await tx
    .select({ id: availabilityBlocks.id })
    .from(availabilityBlocks)
    .where(
      and(eq(availabilityBlocks.itemId, itemId), sql`${availabilityBlocks.period} && ${period}`),
    )
    .limit(1);
  assert(
    !hold && !block,
    "DATES_UNAVAILABLE",
    "Jadwal bertabrakan dengan sewa atau blokir pemilik. Pilih waktu lain.",
    409,
  );
}
// Cheap participant check before slow work such as downloading evidence.
export async function participantRental(db: Executor, actor: User, id: string) {
  const [rental] = await db.select().from(rentals).where(eq(rentals.id, id));
  assert(
    rental && [rental.ownerId, rental.renterId].includes(actor.id),
    "NOT_FOUND",
    "Transaksi tidak ditemukan.",
    404,
  );
  return rental;
}
export async function lockRental(tx: Executor, id: string) {
  const [reference] = await tx
    .select({ itemId: rentals.itemId })
    .from(rentals)
    .where(eq(rentals.id, id));
  assert(reference, "NOT_FOUND", "Transaksi tidak ditemukan.", 404);
  await tx.select({ id: items.id }).from(items).where(eq(items.id, reference.itemId)).for("update");
  const [rental] = await tx.select().from(rentals).where(eq(rentals.id, id)).for("update");
  return rental;
}
export type RentalPatch = Omit<Partial<typeof rentals.$inferInsert>, "blockPeriod"> & {
  blockPeriod?: string | SQL;
};
export async function transitionRental(
  tx: Executor,
  rental: Rental,
  to: RentalStatus,
  actor: { id?: string; type: "user" | "admin" | "system" },
  meta: Record<string, unknown> = {},
  patch: RentalPatch = {},
) {
  assert(
    canTransition(rental.status, to),
    "INVALID_TRANSITION",
    "Status transaksi sudah berubah. Muat ulang halaman.",
    409,
  );
  const [next] = await tx
    .update(rentals)
    .set({ ...patch, status: to, version: rental.version + 1 })
    .where(eq(rentals.id, rental.id))
    .returning();
  // Proposals and no-show reports only make sense in the status they were made for.
  if (!RESCHEDULE_STATUSES.includes(to))
    await tx
      .update(rescheduleRequests)
      .set({ status: "kedaluwarsa", respondedAt: new Date() })
      .where(
        and(eq(rescheduleRequests.rentalId, rental.id), eq(rescheduleRequests.status, "menunggu")),
      );
  const phase = phaseOf(to);
  await tx
    .update(noShowReports)
    .set({ status: "gugur", resolvedAt: new Date() })
    .where(
      and(
        eq(noShowReports.rentalId, rental.id),
        eq(noShowReports.status, "menunggu"),
        phase ? ne(noShowReports.phase, phase) : undefined,
      ),
    );
  await tx.insert(rentalEvents).values({
    rentalId: rental.id,
    fromStatus: rental.status,
    toStatus: to,
    actorId: actor.id,
    actorType: actor.type,
    meta,
  });
  await systemMessage(
    tx,
    rental.conversationId,
    rental.id,
    `${rental.publicCode}: ${RENTAL_LABELS[to]}.`,
  );
  return next;
}
export async function createRental(db: Database, actor: User, raw: unknown, key?: string) {
  const input = rentalInput.parse(raw);
  requireActive(actor);
  requireVerified(actor);
  return mutation(db, actor.id, "rental:create", key, input, async (tx) => {
    const [listing] = await tx
      .select({ ownerId: items.ownerId })
      .from(items)
      .where(eq(items.id, input.itemId));
    assert(listing, "NOT_FOUND", "Barang tidak tersedia.", 404);
    await lockAccountActivity(tx, [actor.id, listing.ownerId]);
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`rental-create:${actor.id}`}))`);
    const [renter] = await tx.select().from(users).where(eq(users.id, actor.id)).for("key share");
    requireActive(renter);
    requireVerified(renter);
    requireOnboarded(renter);
    const [payout] = await tx
      .select()
      .from(payoutAccounts)
      .where(eq(payoutAccounts.userId, actor.id));
    assert(
      payout,
      "PAYOUT_REQUIRED",
      "Isi dan konfirmasi rekening/e-wallet untuk pengembalian deposit terlebih dahulu.",
      422,
    );
    await tx.select({ id: items.id }).from(items).where(eq(items.id, input.itemId)).for("update");
    const detail = await itemDetail(tx, input.itemId, actor);
    assert(detail?.publiclyVisible, "NOT_FOUND", "Barang tidak tersedia untuk disewa.", 404);
    assert(
      detail.owner.id !== actor.id,
      "SELF_RENTAL",
      "Kamu tidak bisa menyewa barang milikmu sendiri.",
      422,
    );
    await assertNotBlocked(tx, actor.id, detail.owner.id);
    const rules = await getSettings(tx),
      now = new Date(),
      start = new Date(input.startAt);
    assert(
      start.getTime() >= now.getTime() + rules.booking_lead_hours * 3600000 &&
        start.getTime() <= now.getTime() + rules.booking_max_days * 86400000,
      "INVALID_SCHEDULE",
      `Pilih waktu mulai minimal ${rules.booking_lead_hours} jam dan maksimal ${rules.booking_max_days} hari dari sekarang.`,
      422,
    );
    assert(
      input.days >= detail.minDays && input.days <= detail.maxDays,
      "INVALID_DURATION",
      `Durasi harus ${detail.minDays}–${detail.maxDays} hari.`,
      422,
    );
    const { pickupPoints } = await import("@/src/db/schema");
    const [point] = await tx
      .select()
      .from(pickupPoints)
      .where(eq(pickupPoints.id, input.pickupPointId))
      .for("share");
    assert(
      point?.active &&
        point.campusId === detail.campus.id &&
        detail.pickupPoints.some((p) => p.id === point.id),
      "INVALID_PICKUP_POINT",
      "Pilih titik aktif yang tersedia untuk barang ini.",
      422,
    );
    assert(
      withinPickupHours(start, point.hours),
      "POINT_CLOSED",
      "Jam mulai harus dalam jam operasional titik (WIB).",
      422,
    );
    const { due, period } = rentalPeriod(start, input.days, rules.availability_buffer_hours);
    await assertAvailable(tx, input.itemId, start, period.end);
    const [{ count }] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(rentals)
      .where(
        and(
          eq(rentals.renterId, actor.id),
          gte(rentals.createdAt, new Date(now.getTime() - 3600000)),
        ),
      );
    assert(count < 10, "RATE_LIMITED", "Maksimal 10 pengajuan per jam. Coba lagi nanti.", 429);
    const conversation = await ensureConversation(tx, input.itemId, detail.owner.id, actor.id);
    const sequence = await tx.execute<{ value: string }>(
      sql`SELECT nextval('rental_public_sequence')::text AS value`,
    );
    const publicCode = `SM-${wibDateKey(now).slice(2, 7).replace("-", "")}-${sequence.rows[0].value.padStart(5, "0")}`;
    const rent = detail.pricePerDay * input.days;
    const [rental] = await tx
      .insert(rentals)
      .values({
        publicCode,
        itemId: input.itemId,
        ownerId: detail.owner.id,
        renterId: actor.id,
        conversationId: conversation.id,
        pickupPointId: point.id,
        startAt: start,
        dueAt: due,
        days: input.days,
        blockPeriod: periodSql(start, period.end),
        pricePerDay: detail.pricePerDay,
        rentTotal: rent,
        deposit: detail.deposit,
        commissionRateBp: rules.commission_rate_bp,
        commissionAmount: commission(rent, rules.commission_rate_bp),
        amountDue: rent + detail.deposit,
        rulesSnapshot: rules,
        listingSnapshot: {
          title: detail.title,
          description: detail.description,
          itemValue: detail.itemValue,
          photos: detail.photos,
          point: { name: point.name, hours: point.hours },
        },
        respondBy: new Date(
          Math.min(
            now.getTime() + rules.owner_response_hours * 3600000,
            start.getTime() - rules.response_before_start_hours * 3600000,
          ),
        ),
      })
      .returning();
    await tx
      .insert(rentalEvents)
      .values({ rentalId: rental.id, toStatus: "DIAJUKAN", actorId: actor.id, actorType: "user" });
    await systemMessage(tx, conversation.id, rental.id, `${publicCode}: pengajuan sewa baru.`);
    if (input.message)
      await tx.insert(messages).values({
        conversationId: conversation.id,
        rentalId: rental.id,
        senderId: actor.id,
        type: "text",
        body: input.message,
        createdAt: new Date(),
      });
    await notify(
      tx,
      detail.owner.id,
      "rental_requested",
      "Ada pengajuan sewa baru",
      `${actor.name} ingin menyewa ${detail.title}.`,
      `/transaksi/${rental.id}`,
    );
    return { id: rental.id, status: rental.status, publicCode };
  });
}
export async function actOnRental(
  db: Database,
  actor: User,
  id: string,
  action: "approve" | "reject" | "cancel",
  raw: unknown,
  key?: string,
) {
  const input = rentalActionInput.parse(raw);
  return mutation(db, actor.id, `rental:${id}:${action}`, key, input, async (tx) => {
    if (action === "approve" || action === "reject") {
      const [reference] = await tx.select().from(rentals).where(eq(rentals.id, id));
      assert(reference, "NOT_FOUND", "Transaksi tidak ditemukan.", 404);
      await lockAccountActivity(tx, [reference.ownerId, reference.renterId]);
    }
    const rental = await lockRental(tx, id),
      now = new Date();
    const owner = actor.id === rental.ownerId,
      renter = actor.id === rental.renterId;
    assert(owner || renter, "NOT_FOUND", "Transaksi tidak ditemukan.", 404);
    assert(
      rental.version === input.version,
      "RENTAL_CHANGED",
      "Transaksi berubah. Muat ulang sebelum melanjutkan.",
      409,
    );
    let next: Rental;
    if (action === "approve" || action === "reject") {
      assert(owner, "FORBIDDEN", "Hanya pemilik dapat memutuskan pengajuan.", 403);
      requireActive(actor);
      assert(
        rental.status === "DIAJUKAN" && rental.respondBy > now,
        "REQUEST_EXPIRED",
        "Pengajuan sudah diproses atau batas tanggapan berakhir.",
        409,
      );
      if (action === "reject")
        next = await transitionRental(
          tx,
          rental,
          "DITOLAK",
          { id: actor.id, type: "user" },
          { reason: input.reason || null },
        );
      else {
        const parties = await tx
          .select()
          .from(users)
          .where(inArray(users.id, [rental.ownerId, rental.renterId]));
        for (const party of parties) {
          requireActive(party);
          requireVerified(party);
        }
        await assertNotBlocked(tx, rental.ownerId, rental.renterId);
        const rules = await getSettings(tx),
          { period } = rentalPeriod(rental.startAt, rental.days, rules.availability_buffer_hours);
        const payBy = new Date(
          Math.min(
            now.getTime() + rules.payment_window_hours * 3600000,
            rental.startAt.getTime() - rules.payment_before_start_hours * 3600000,
          ),
        );
        assert(
          payBy > now,
          "PAYMENT_WINDOW_CLOSED",
          "Waktu pembayaran tidak lagi mencukupi. Minta penyewa mengajukan jadwal baru.",
          409,
        );
        await assertAvailable(tx, rental.itemId, rental.startAt, period.end, rental.id);
        const [account] = await tx
          .select({ id: platformAccounts.id })
          .from(platformAccounts)
          .where(eq(platformAccounts.active, true))
          .limit(1);
        assert(
          account,
          "PLATFORM_ACCOUNT_REQUIRED",
          "Admin perlu menyiapkan rekening platform sebelum pengajuan bisa disetujui.",
          422,
        );
        await tx.execute(sql`SELECT pg_advisory_xact_lock(7391803)`);
        const codes = await tx
          .select({ code: rentals.uniqueCode })
          .from(rentals)
          .where(inArray(rentals.status, ["DISETUJUI", "MENUNGGU_VERIFIKASI"]));
        const code = firstFreeCode(codes.flatMap((r) => (r.code === null ? [] : [r.code])));
        assert(
          code !== null,
          "UNIQUE_CODES_EXHAUSTED",
          "Semua kode pembayaran sedang dipakai. Coba setujui beberapa saat lagi.",
          409,
        );
        next = await transitionRental(
          tx,
          rental,
          "DISETUJUI",
          { id: actor.id, type: "user" },
          {},
          {
            uniqueCode: code,
            amountDue: paymentTotals(rental.rentTotal, rental.deposit, code).amountDue,
            rulesSnapshot: rules,
            commissionRateBp: rules.commission_rate_bp,
            commissionAmount: commission(rental.rentTotal, rules.commission_rate_bp),
            blockPeriod: periodSql(rental.startAt, period.end),
            payBy,
          },
        );
      }
    } else {
      assert(
        rental.status === "DIAJUKAN" ? renter : ["DISETUJUI", "DIBAYAR"].includes(rental.status),
        "CANCEL_UNAVAILABLE",
        rental.status === "MENUNGGU_VERIFIKASI"
          ? "Pembatalan belum tersedia selama verifikasi pembayaran. Tunggu keputusan admin."
          : "Pembatalan tidak tersedia untuk status ini.",
        409,
      );
      const terms = cancellationTerms(
          rental.status,
          owner ? "owner" : "renter",
          rental.startAt,
          now,
          rental.rulesSnapshot,
        ),
        fee = terms.fee
          ? cancellationFee(rental.rentTotal, rental.rulesSnapshot.cancellation_rate_bp)
          : 0;
      if (rental.status === "DIBAYAR") {
        const [report] = await tx
          .select({ id: noShowReports.id })
          .from(noShowReports)
          .where(and(eq(noShowReports.rentalId, rental.id), eq(noShowReports.status, "menunggu")))
          .limit(1);
        assert(
          !report,
          "NO_SHOW_PENDING",
          "Laporan tidak hadir sedang berjalan. Tunggu hasilnya atau ajukan bantahan.",
          409,
        );
        assert(
          input.fee === fee,
          "CANCEL_TERMS_CHANGED",
          "Konsekuensi pembatalan berubah. Periksa rinciannya lagi sebelum membatalkan.",
          409,
        );
      }
      next = await transitionRental(
        tx,
        rental,
        "DIBATALKAN",
        { id: actor.id, type: "user" },
        { reason: input.reason || null, cancellationFee: fee, strike: terms.strike },
        { cancelledBy: actor.id, cancelReason: input.reason },
      );
      await settleRental(tx, next, terms.fee ? "biaya_batal" : "refund_penuh");
      if (terms.strike) await giveStrike(tx, rental.ownerId, "batal_setelah_dibayar", rental);
    }
    await notify(
      tx,
      owner ? rental.renterId : rental.ownerId,
      action === "approve"
        ? "rental_approved"
        : action === "reject"
          ? "rental_rejected"
          : "rental_cancelled",
      RENTAL_LABELS[next.status],
      `${rental.publicCode}${input.reason ? `: ${input.reason}` : ""}`,
      `/transaksi/${id}`,
    );
    return { id, status: next.status, version: next.version };
  });
}
export async function rentalList(db: Executor, actor: User, role: string, state?: string) {
  z.enum(["renter", "owner"]).parse(role);
  if (state) z.enum(["aktif", "selesai", "dibatalkan"]).parse(state);
  const rows = await db
    .select()
    .from(rentals)
    .where(
      and(
        role === "owner" ? eq(rentals.ownerId, actor.id) : eq(rentals.renterId, actor.id),
        state === "aktif"
          ? sql`${rentals.status} NOT IN ('SELESAI','DITOLAK','KADALUARSA','DIBATALKAN')`
          : state === "selesai"
            ? eq(rentals.status, "SELESAI")
            : state === "dibatalkan"
              ? inArray(rentals.status, ["DITOLAK", "KADALUARSA", "DIBATALKAN"])
              : undefined,
      ),
    )
    .orderBy(desc(rentals.createdAt), desc(rentals.id))
    .limit(100);
  return rows.map((r) => ({
    ...r,
    title: r.listingSnapshot.title,
    remaining: Math.max(0, r.amountDue - r.amountReceived),
  }));
}
export async function rentalDetail(db: Database, actor: User, id: string) {
  const [rental] = await db.select().from(rentals).where(eq(rentals.id, id));
  const participant = rental && [rental.ownerId, rental.renterId].includes(actor.id);
  const staff = actor.accountStatus === "aktif" && actor.role !== "user";
  assert(rental && (participant || staff), "NOT_FOUND", "Transaksi tidak ditemukan.", 404);
  if (!participant)
    await db
      .insert(adminAuditLogs)
      .values({ adminId: actor.id, action: "rental_viewed", targetType: "rentals", targetId: id });
  const history = await db
    .select()
    .from(rentalEvents)
    .where(eq(rentalEvents.rentalId, id))
    .orderBy(asc(rentalEvents.createdAt), asc(rentalEvents.id));
  const proofs = await db
    .select()
    .from(payments)
    .where(eq(payments.rentalId, id))
    .orderBy(asc(payments.createdAt));
  const accounts =
    rental.renterId === actor.id
      ? await db.select().from(platformAccounts).where(eq(platformAccounts.active, true))
      : [];
  const people = await db
    .select({
      id: users.id,
      name: users.name,
      verificationStatus: users.verificationStatus,
      ratingAvg: users.ratingAvg,
      ratingCount: users.ratingCount,
      completedCount: users.completedCount,
    })
    .from(users)
    .where(inArray(users.id, [rental.ownerId, rental.renterId]));
  let canApprove = rental.status === "DIAJUKAN" && rental.respondBy > new Date();
  if (canApprove) {
    const rules = await getSettings(db),
      { period } = rentalPeriod(rental.startAt, rental.days, rules.availability_buffer_hours);
    try {
      await assertAvailable(db, rental.itemId, rental.startAt, period.end, rental.id);
    } catch {
      canApprove = false;
    }
  }
  return {
    ...(await rentalProgress(db, rental, { id: actor.id, staff })),
    rental,
    history,
    people,
    accounts,
    canApprove,
    viewer: {
      isOwner: actor.id === rental.ownerId,
      isRenter: actor.id === rental.renterId,
      isAdmin: staff,
    },
    totals: paymentTotals(
      rental.rentTotal,
      rental.deposit,
      rental.uniqueCode || 0,
      rental.amountReceived,
    ),
    payments: await Promise.all(
      proofs.map(async (p) => ({
        id: p.id,
        rentalId: p.rentalId,
        platformAccountId: p.platformAccountId,
        platformSnapshot: p.platformSnapshot,
        senderName: p.senderName,
        transferredAt: p.transferredAt,
        claimedAmount: p.claimedAmount,
        status: p.status,
        verifiedAmount: p.verifiedAmount,
        rejectReason: p.rejectReason,
        targetAt: p.targetAt,
        createdAt: p.createdAt,
        proofUrl: await evidencePreview(p.proofPath),
      })),
    ),
  };
}
