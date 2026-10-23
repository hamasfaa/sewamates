import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { Database, Executor } from "@/src/db";
import {
  adminAuditLogs,
  disputeEvidence,
  disputeResponses,
  disputes,
  handoverPhotos,
  handoverRecords,
  messages,
  rentalEvents,
  rentals,
  users,
  type Rental,
  type User,
} from "@/src/db/schema";
import { mutation } from "@/src/db/mutation";
import { assert } from "@/src/lib/errors";
import { disputeInput, evidenceInput } from "@/src/lib/transaction-validation";
import { claimUploads, evidencePreview, inspectEvidence } from "@/src/lib/storage";
import type { RentalStatus } from "@/src/domain/rental-state-machine";
import { requireAdmin } from "./admin-service";
import {
  assertAvailable,
  lockRental,
  participantRental,
  periodSql,
  transitionRental,
  type RentalPatch,
} from "./rental-service";
import { pickupPoints } from "@/src/db/schema";
import { rentalPeriod, withinPickupHours } from "@/src/domain/availability";
import { disputeDecisionInput, disputeResponseInput } from "@/src/lib/trust-validation";
import { lateFee, splitIsValid } from "@/src/domain/payout";
import { settleRental } from "./settlement-service";
import { giveStrike } from "./strike-service";
import { notify, notifyAdmins } from "./notification-service";
import { presentMessages } from "./chat-service";
import { disputeView } from "./rental-progress";
import { DISPUTE_LABELS, type DisputeCategory } from "@/src/domain/dispute";
// Downloads happen before the database transaction so slow storage does not hold row locks.
export async function inspectDisputeFiles(userId: string, paths: string[]) {
  assert(new Set(paths).size === paths.length, "INVALID_UPLOAD", "Ada file yang sama.", 422);
  for (const path of paths) await inspectEvidence(userId, path, "dispute_evidence");
}
async function attachEvidence(
  tx: Executor,
  rental: Rental,
  disputeId: string,
  userId: string,
  paths: string[],
  note?: string,
) {
  if (!paths.length) return;
  const [{ count }] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(disputeEvidence)
    .where(and(eq(disputeEvidence.disputeId, disputeId), eq(disputeEvidence.uploadedBy, userId)));
  const limit = rental.rulesSnapshot.dispute_files_max;
  assert(
    count + paths.length <= limit,
    "EVIDENCE_LIMIT",
    `Maksimal ${limit} file bukti per pihak.`,
    422,
  );
  await claimUploads(tx, userId, "dispute_evidence", paths);
  await tx
    .insert(disputeEvidence)
    .values(paths.map((path) => ({ disputeId, uploadedBy: userId, path, note })));
}
// Single entry point for every trigger in A-3.10; the caller holds the rental lock.
export async function openDispute(
  tx: Executor,
  rental: Rental,
  input: {
    openedBy: string | null;
    category: DisputeCategory;
    description: string;
    evidencePaths?: string[];
    meta?: Record<string, unknown>;
  },
) {
  const rules = rental.rulesSnapshot,
    now = Date.now();
  const [dispute] = await tx
    .insert(disputes)
    .values({
      rentalId: rental.id,
      openedBy: input.openedBy,
      category: input.category,
      description: input.description,
      openedFromStatus: rental.status,
      respondBy: new Date(now + rules.dispute_response_hours * 3600000),
      decideBy: new Date(now + rules.dispute_decision_hours * 3600000),
    })
    .returning();
  if (input.openedBy)
    await attachEvidence(tx, rental, dispute.id, input.openedBy, input.evidencePaths ?? []);
  const next = await transitionRental(
    tx,
    rental,
    "SENGKETA",
    input.openedBy ? { id: input.openedBy, type: "user" } : { type: "system" },
    { disputeId: dispute.id, category: input.category, ...input.meta },
    { statusBeforeDispute: rental.status },
  );
  for (const party of [rental.ownerId, rental.renterId])
    if (party !== input.openedBy)
      await notify(
        tx,
        party,
        "dispute_opened",
        "Sengketa dibuka",
        `${rental.publicCode}: ${DISPUTE_LABELS[input.category]}. Dana tetap ditahan; tambahkan bukti dalam ${rules.dispute_response_hours} jam.`,
        `/transaksi/${rental.id}`,
      );
  await notifyAdmins(
    tx,
    "Sengketa baru",
    `${rental.publicCode}: ${DISPUTE_LABELS[input.category]}. Putuskan dalam ${rules.dispute_decision_hours} jam.`,
    "/admin/sengketa",
  );
  return { dispute, rental: next };
}
// "Lapor masalah" / "Barang tidak sesuai" / "Ada masalah" from a participant (A-3.10).
export async function reportProblem(
  db: Database,
  actor: User,
  rentalId: string,
  raw: unknown,
  key?: string,
  options: { only?: RentalStatus; scope?: string } = {},
) {
  const input = disputeInput.parse(raw);
  await participantRental(db, actor, rentalId);
  await inspectDisputeFiles(actor.id, input.evidencePaths);
  return mutation(
    db,
    actor.id,
    options.scope ?? `rental:${rentalId}:dispute`,
    key,
    input,
    async (tx) => {
      const rental = await lockRental(tx, rentalId),
        renter = rental.renterId === actor.id;
      assert(
        !options.only || rental.status === options.only,
        "CHECK_CLOSED",
        "Masa cek sudah berakhir atau barang belum dikembalikan.",
        409,
      );
      if (rental.status === "DIBAYAR") {
        const [record] = await tx
          .select()
          .from(handoverRecords)
          .where(and(eq(handoverRecords.rentalId, rental.id), eq(handoverRecords.type, "start")));
        assert(
          renter && input.category === "tidak_sesuai",
          "DISPUTE_UNAVAILABLE",
          "Sebelum serah terima, hanya penyewa yang dapat melaporkan barang tidak sesuai.",
          409,
        );
        assert(
          record?.ownerArrivedAt && record.renterArrivedAt,
          "DISPUTE_UNAVAILABLE",
          "Laporkan barang tidak sesuai saat kalian bertemu di titik serah terima.",
          409,
        );
      } else if (rental.status === "DIKEMBALIKAN")
        assert(
          rental.reviewEndsAt && rental.reviewEndsAt > new Date(),
          "CHECK_CLOSED",
          "Masa cek sudah berakhir; pengembalian sudah final.",
          409,
        );
      else
        assert(
          rental.status === "BERJALAN",
          "DISPUTE_UNAVAILABLE",
          "Sengketa tidak dapat dibuka pada status ini.",
          409,
        );
      const { rental: next, dispute } = await openDispute(tx, rental, {
        openedBy: actor.id,
        ...input,
      });
      return { status: next.status, version: next.version, disputeId: dispute.id };
    },
  );
}
export async function addDisputeEvidence(
  db: Database,
  actor: User,
  disputeId: string,
  raw: unknown,
  key?: string,
) {
  const input = evidenceInput.parse(raw);
  const [reference] = await db
    .select({ rentalId: disputes.rentalId, ownerId: rentals.ownerId, renterId: rentals.renterId })
    .from(disputes)
    .innerJoin(rentals, eq(rentals.id, disputes.rentalId))
    .where(eq(disputes.id, disputeId));
  assert(
    reference && [reference.ownerId, reference.renterId].includes(actor.id),
    "NOT_FOUND",
    "Sengketa tidak ditemukan.",
    404,
  );
  await inspectDisputeFiles(actor.id, input.paths);
  return mutation(db, actor.id, `dispute:${disputeId}:evidence`, key, input, async (tx) => {
    const rental = await lockRental(tx, reference.rentalId);
    const [dispute] = await tx
      .select()
      .from(disputes)
      .where(eq(disputes.id, disputeId))
      .for("update");
    assert(
      dispute.status === "dibuka",
      "DISPUTE_CLOSED",
      "Sengketa sudah diputuskan. Bukti baru tidak dapat ditambahkan.",
      409,
    );
    assert(
      dispute.respondBy > new Date(),
      "RESPONSE_CLOSED",
      "Batas pengiriman bukti sengketa sudah berakhir.",
      409,
    );
    await attachEvidence(tx, rental, dispute.id, actor.id, input.paths, input.note);
    await tx.insert(rentalEvents).values({
      rentalId: rental.id,
      fromStatus: rental.status,
      toStatus: rental.status,
      actorId: actor.id,
      actorType: "user",
      meta: { action: "dispute_evidence_added", disputeId, files: input.paths.length },
    });
    await notify(
      tx,
      actor.id === rental.ownerId ? rental.renterId : rental.ownerId,
      "dispute_evidence",
      "Bukti sengketa bertambah",
      `${rental.publicCode}: pihak lain menambahkan ${input.paths.length} bukti.`,
      `/transaksi/${rental.id}`,
    );
    return { disputeId, added: input.paths.length };
  });
}
export async function disputeQueue(db: Executor, actor: User) {
  requireAdmin(actor);
  return db
    .select({
      id: disputes.id,
      rentalId: disputes.rentalId,
      publicCode: rentals.publicCode,
      title: sql<string>`${rentals.listingSnapshot}->>'title'`,
      category: disputes.category,
      openedFromStatus: disputes.openedFromStatus,
      openedByName: users.name,
      respondBy: disputes.respondBy,
      decideBy: disputes.decideBy,
      createdAt: disputes.createdAt,
      amountReceived: rentals.amountReceived,
    })
    .from(disputes)
    .innerJoin(rentals, eq(rentals.id, disputes.rentalId))
    .leftJoin(users, eq(users.id, disputes.openedBy))
    .where(eq(disputes.status, "dibuka"))
    .orderBy(asc(disputes.decideBy), asc(disputes.id))
    .limit(100);
}
export async function disputeDetail(db: Database, actor: User, id: string) {
  requireAdmin(actor);
  const [row] = await db
    .select({ dispute: disputes, rental: rentals })
    .from(disputes)
    .innerJoin(rentals, eq(rentals.id, disputes.rentalId))
    .where(eq(disputes.id, id));
  assert(row, "NOT_FOUND", "Sengketa tidak ditemukan.", 404);
  const { rental } = row;
  await db.insert(adminAuditLogs).values({
    adminId: actor.id,
    action: "dispute_viewed",
    targetType: "disputes",
    targetId: id,
    meta: { rentalId: rental.id, conversationId: rental.conversationId },
  });
  const people = await db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(inArray(users.id, [rental.ownerId, rental.renterId]));
  const photos = await db
    .select({
      id: handoverPhotos.id,
      type: handoverRecords.type,
      path: handoverPhotos.path,
      source: handoverPhotos.source,
      receivedAt: handoverPhotos.receivedAt,
      rescheduleCount: handoverPhotos.rescheduleCount,
    })
    .from(handoverPhotos)
    .innerJoin(handoverRecords, eq(handoverRecords.id, handoverPhotos.handoverId))
    .where(eq(handoverRecords.rentalId, rental.id))
    .orderBy(asc(handoverPhotos.receivedAt), asc(handoverPhotos.id));
  const history = await db
    .select()
    .from(rentalEvents)
    .where(eq(rentalEvents.rentalId, rental.id))
    .orderBy(asc(rentalEvents.createdAt), asc(rentalEvents.id));
  const chat = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, rental.conversationId))
    .orderBy(desc(messages.createdAt), desc(messages.id))
    .limit(200);
  return {
    dispute: await disputeView(db, id),
    rental: {
      id: rental.id,
      publicCode: rental.publicCode,
      title: String(rental.listingSnapshot.title),
      status: rental.status,
      ownerId: rental.ownerId,
      renterId: rental.renterId,
      startAt: rental.startAt,
      dueAt: rental.dueAt,
      returnedAt: rental.returnedAt,
      rentTotal: rental.rentTotal,
      deposit: rental.deposit,
      uniqueCode: rental.uniqueCode,
      amountReceived: rental.amountReceived,
      commissionAmount: rental.commissionAmount,
      lateFee: rental.returnedAt
        ? rental.lateFee
        : lateFee(rental, rental.lateUntil ?? new Date(), rental.rulesSnapshot),
      version: rental.version,
    },
    people,
    photos: await Promise.all(
      photos.map(async ({ path, rescheduleCount, ...photo }) => ({
        ...photo,
        currentSchedule: rescheduleCount === rental.rescheduleCount,
        url: await evidencePreview(path),
      })),
    ),
    history,
    messages: await presentMessages(chat.reverse(), true),
    self: [rental.ownerId, rental.renterId].includes(actor.id),
  };
}

export async function respondDispute(
  db: Database,
  actor: User,
  id: string,
  raw: unknown,
  key?: string,
) {
  const input = disputeResponseInput.parse(raw);
  const [ref] = await db.select().from(disputes).where(eq(disputes.id, id));
  assert(ref, "NOT_FOUND", "Sengketa tidak ditemukan.", 404);
  await participantRental(db, actor, ref.rentalId);
  await inspectDisputeFiles(actor.id, input.paths);
  return mutation(db, actor.id, `dispute:${id}:respond`, key, input, async (tx) => {
    const rental = await lockRental(tx, ref.rentalId);
    const [d] = await tx.select().from(disputes).where(eq(disputes.id, id)).for("update");
    assert(
      d.status === "dibuka" && d.respondBy > new Date(),
      "RESPONSE_CLOSED",
      "Batas tanggapan sengketa sudah berakhir.",
      409,
    );
    assert(d.openedBy !== actor.id, "FORBIDDEN", "Tanggapan diberikan oleh pihak lawan.", 403);
    const [existing] = await tx
      .select()
      .from(disputeResponses)
      .where(and(eq(disputeResponses.disputeId, id), eq(disputeResponses.userId, actor.id)));
    assert(
      !existing,
      "RESPONSE_EXISTS",
      "Tanggapan sudah dikirim. Tambahkan bukti jika diperlukan.",
      409,
    );
    await tx.insert(disputeResponses).values({ disputeId: id, userId: actor.id, body: input.body });
    await attachEvidence(tx, rental, id, actor.id, input.paths);
    await tx.insert(rentalEvents).values({
      rentalId: rental.id,
      fromStatus: rental.status,
      toStatus: rental.status,
      actorId: actor.id,
      actorType: "user",
      meta: { action: "dispute_responded", disputeId: id },
    });
    const other = actor.id === rental.ownerId ? rental.renterId : rental.ownerId;
    await notify(
      tx,
      other,
      "dispute_responded",
      "Sengketa ditanggapi",
      `${rental.publicCode}: tanggapan pihak lain tersedia.`,
      `/transaksi/${rental.id}`,
    );
    await notifyAdmins(
      tx,
      "Tanggapan sengketa",
      `${rental.publicCode}: tanggapan dan bukti siap diperiksa.`,
      "/admin/sengketa",
    );
    return { id, status: "ditanggapi" };
  });
}
export async function decideDispute(
  db: Database,
  actor: User,
  id: string,
  raw: unknown,
  key?: string,
) {
  requireAdmin(actor);
  const input = disputeDecisionInput.parse(raw);
  return mutation(db, actor.id, `dispute:${id}:decision`, key, input, async (tx) => {
    const [ref] = await tx.select().from(disputes).where(eq(disputes.id, id));
    assert(ref, "NOT_FOUND", "Sengketa tidak ditemukan.", 404);
    const rental = await lockRental(tx, ref.rentalId);
    const [d] = await tx.select().from(disputes).where(eq(disputes.id, id)).for("update");
    assert(
      ![rental.ownerId, rental.renterId].includes(actor.id),
      "SELF_REVIEW_FORBIDDEN",
      "Minta admin lain memutuskan sengketa transaksimu.",
      403,
    );
    assert(
      d.status === "dibuka" && rental.status === "SENGKETA" && rental.version === input.version,
      "DISPUTE_CHANGED",
      "Sengketa berubah atau sudah diputuskan. Muat ulang.",
      409,
    );
    assert(
      !input.strikeUserId || [rental.ownerId, rental.renterId].includes(input.strikeUserId),
      "INVALID_PARTY",
      "Strike hanya untuk pihak transaksi.",
      422,
    );
    let to: RentalStatus,
      patch: RentalPatch = { statusBeforeDispute: null };
    const commission = input.outcome === "bagi_dana" ? rental.commissionAmount : 0;
    if (input.outcome === "lanjutkan") {
      assert(
        d.openedFromStatus === "DIBAYAR" || d.openedFromStatus === "BERJALAN",
        "INVALID_OUTCOME",
        "Transaksi yang sudah dikembalikan tidak dapat dilanjutkan.",
        422,
      );
      assert(
        input.ownerAmount === 0 && input.renterAmount === 0,
        "INVALID_SPLIT",
        "Melanjutkan transaksi tidak membagi dana.",
        422,
      );
      to = d.openedFromStatus;
      assert(
        to === "DIBAYAR" || !input.newStartAt,
        "INVALID_SCHEDULE",
        "Jadwal sewa berjalan tidak dapat diperpanjang melalui putusan sengketa.",
        422,
      );
      let start = rental.startAt,
        end = new Date(
          rental.dueAt.getTime() + rental.rulesSnapshot.availability_buffer_hours * 3600000,
        );
      if (to === "DIBAYAR") {
        assert(
          rental.rescheduleCount < rental.rulesSnapshot.reschedule_max,
          "RESCHEDULE_LIMIT",
          "Batas jadwal ulang transaksi sudah tercapai. Pilih putusan batal dengan pembagian dana.",
          409,
        );
        assert(input.newStartAt, "SCHEDULE_REQUIRED", "Jadwal serah terima baru wajib diisi.", 422);
        start = new Date(input.newStartAt);
        assert(
          start.getTime() !== rental.startAt.getTime(),
          "SAME_SCHEDULE",
          "Pilih jadwal yang berbeda dari jadwal sebelumnya.",
          422,
        );
        assert(
          start.getTime() > Date.now() + 15 * 60000 &&
            start.getTime() <= Date.now() + rental.rulesSnapshot.booking_max_days * 86400000,
          "INVALID_SCHEDULE",
          "Jadwal baru minimal 15 menit dari sekarang dan dalam batas pemesanan.",
          422,
        );
        const [point] = await tx
          .select()
          .from(pickupPoints)
          .where(eq(pickupPoints.id, rental.pickupPointId));
        assert(
          point && withinPickupHours(start, point.hours),
          "POINT_CLOSED",
          "Pilih jadwal dalam jam operasional titik.",
          422,
        );
        const schedule = rentalPeriod(
          start,
          rental.days,
          rental.rulesSnapshot.availability_buffer_hours,
        );
        end = schedule.period.end;
        patch = {
          ...patch,
          startAt: start,
          dueAt: schedule.due,
          blockPeriod: periodSql(start, end),
          rescheduleCount: rental.rescheduleCount + 1,
        };
        await tx
          .update(handoverRecords)
          .set({
            ownerArrivedAt: null,
            renterArrivedAt: null,
            ownerLocation: null,
            renterLocation: null,
            photosConfirmedAt: null,
            codeHash: null,
            codeIssuedAt: null,
            codeFailedAttempts: 0,
            codeLockedUntil: null,
          })
          .where(and(eq(handoverRecords.rentalId, rental.id), eq(handoverRecords.type, "start")));
      }
      await assertAvailable(tx, rental.itemId, start, end, rental.id);
    } else {
      assert(
        input.outcome === "batal"
          ? d.openedFromStatus === "DIBAYAR"
          : ["BERJALAN", "DIKEMBALIKAN"].includes(d.openedFromStatus),
        "INVALID_OUTCOME",
        "Jenis putusan tidak sesuai tahap sengketa.",
        422,
      );
      assert(
        !input.newStartAt,
        "INVALID_SCHEDULE",
        "Jadwal baru hanya untuk putusan lanjutkan.",
        422,
      );
      const split = { owner: input.ownerAmount, renter: input.renterAmount, commission };
      assert(
        splitIsValid(split, rental.amountReceived),
        "INVALID_SPLIT",
        "Bagian pemilik + penyewa + komisi harus sama dengan dana diterima.",
        422,
      );
      to = input.outcome === "batal" ? "DIBATALKAN" : "PENCAIRAN_DIPROSES";
      await settleRental(tx, rental, "putusan", split);
    }
    await tx
      .update(disputes)
      .set({
        status: "diputuskan",
        outcome: input.outcome,
        ownerAmount: input.ownerAmount,
        renterAmount: input.renterAmount,
        commissionAmount: commission,
        newStartAt: input.newStartAt ? new Date(input.newStartAt) : null,
        decisionNote: input.reason,
        decidedBy: actor.id,
        decidedAt: new Date(),
      })
      .where(eq(disputes.id, id));
    const next = await transitionRental(
      tx,
      rental,
      to,
      { id: actor.id, type: "admin" },
      { action: "dispute_decided", disputeId: id, outcome: input.outcome },
      patch,
    );
    if (input.strikeUserId) await giveStrike(tx, input.strikeUserId, "sengketa", rental, actor.id);
    await tx.insert(adminAuditLogs).values({
      adminId: actor.id,
      action: "dispute_decided",
      targetType: "disputes",
      targetId: id,
      meta: input,
    });
    for (const userId of [rental.ownerId, rental.renterId])
      await notify(
        tx,
        userId,
        "dispute_decided",
        "Sengketa sudah diputuskan",
        `${rental.publicCode}: ${input.outcome.replaceAll("_", " ")}. ${input.reason}`,
        `/transaksi/${rental.id}`,
      );
    return { id, status: next.status, version: next.version };
  });
}
