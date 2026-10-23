import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { Database, Executor } from "@/src/db";
import {
  adminAuditLogs,
  disputeEvidence,
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
import { lockRental, participantRental, transitionRental } from "./rental-service";
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
// Read-only for Sprint 4; the decision form (F24) follows in Sprint 5.
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
      lateFee: rental.lateFee,
    },
    people,
    photos: await Promise.all(
      photos.map(async ({ path, ...photo }) => ({ ...photo, url: await evidencePreview(path) })),
    ),
    history,
    messages: await presentMessages(chat.reverse(), true),
  };
}
