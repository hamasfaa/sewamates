import { and, eq, sql } from "drizzle-orm";
import { randomInt } from "node:crypto";
import type { Database, Executor } from "@/src/db";
import {
  handoverPhotos,
  handoverRecords,
  noShowReports,
  rentalEvents,
  rentals,
  type HandoverRecord,
  type Rental,
  type User,
} from "@/src/db/schema";
import { mutation } from "@/src/db/mutation";
import { AppError, assert } from "@/src/lib/errors";
import { hash, safeEqual } from "@/src/lib/crypto";
import { claimUploads, inspectEvidence } from "@/src/lib/storage";
import { dateWib } from "@/src/lib/utils";
import {
  arriveInput,
  checkInput,
  handoverConfirmInput,
  handoverPhotoInput,
  noShowContestInput,
} from "@/src/lib/transaction-validation";
import {
  checkInOpen,
  codeLocked,
  codeReceiver,
  failedCodeAttempt,
  HANDOVER_RULES,
  noShowOpensAt,
  otherParty,
  phaseOf,
  photographer,
  scheduleOf,
  type Party,
  type Phase,
} from "@/src/domain/handover";
import { lateFee } from "@/src/domain/payout";
import { lockRental, participantRental, transitionRental } from "./rental-service";
import { systemMessage } from "./chat-service";
import { notify } from "./notification-service";
import { settleRental } from "./settlement-service";
import { giveStrike } from "./strike-service";
import { inspectDisputeFiles, openDispute, reportProblem } from "./dispute-service";

const PARTY_LABEL: Record<Party, string> = { owner: "Pemilik", renter: "Penyewa" };
const PHASE_LABEL: Record<Phase, string> = { start: "serah terima", end: "pengembalian" };
export function partyOf(rental: Rental, actor: User): Party {
  const party =
    rental.ownerId === actor.id ? "owner" : rental.renterId === actor.id ? "renter" : null;
  assert(party, "NOT_FOUND", "Transaksi tidak ditemukan.", 404);
  return party;
}
export const partyId = (rental: Rental, party: Party) =>
  party === "owner" ? rental.ownerId : rental.renterId;
function currentPhase(rental: Rental) {
  const phase = phaseOf(rental.status);
  assert(
    phase,
    "HANDOVER_UNAVAILABLE",
    "Serah terima atau pengembalian tidak tersedia pada status ini.",
    409,
  );
  return phase;
}
// The caller holds the rental lock, so the record is created at most once per phase.
export async function handoverRecord(tx: Executor, rentalId: string, phase: Phase) {
  await tx.insert(handoverRecords).values({ rentalId, type: phase }).onConflictDoNothing();
  const [record] = await tx
    .select()
    .from(handoverRecords)
    .where(and(eq(handoverRecords.rentalId, rentalId), eq(handoverRecords.type, phase)))
    .for("update");
  return record;
}
const arrivedAt = (record: HandoverRecord, party: Party) =>
  party === "owner" ? record.ownerArrivedAt : record.renterArrivedAt;
function requireBothArrived(record: HandoverRecord) {
  assert(
    record.ownerArrivedAt && record.renterArrivedAt,
    "WAITING_ARRIVAL",
    'Kedua pihak perlu menekan "Saya sudah sampai" terlebih dahulu.',
    409,
  );
}
async function photoCount(
  tx: Executor,
  handoverId: string,
  uploadedBy: string,
  rescheduleCount: number,
) {
  const [{ count }] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(handoverPhotos)
    .where(
      and(
        eq(handoverPhotos.handoverId, handoverId),
        eq(handoverPhotos.uploadedBy, uploadedBy),
        eq(handoverPhotos.rescheduleCount, rescheduleCount),
      ),
    );
  return count;
}
const codeDigest = (rentalId: string, phase: Phase, code: string) =>
  hash(`handover:${rentalId}:${phase}:${code}`);

export async function arrive(
  db: Database,
  actor: User,
  rentalId: string,
  raw: unknown,
  key?: string,
) {
  const input = arriveInput.parse(raw);
  return mutation(db, actor.id, `rental:${rentalId}:arrive`, key, input, async (tx) => {
    const rental = await lockRental(tx, rentalId),
      party = partyOf(rental, actor),
      phase = currentPhase(rental),
      now = new Date();
    assert(
      checkInOpen(phase, scheduleOf(rental, phase), now),
      "TOO_EARLY",
      `"Saya sudah sampai" aktif mulai ${HANDOVER_RULES.earlyMinutes} menit sebelum jadwal.`,
      409,
    );
    const record = await handoverRecord(tx, rental.id, phase),
      previous = arrivedAt(record, party);
    if (!previous) {
      await tx
        .update(handoverRecords)
        .set(
          party === "owner"
            ? { ownerArrivedAt: now, ownerLocation: input.location ?? null }
            : { renterArrivedAt: now, renterLocation: input.location ?? null },
        )
        .where(eq(handoverRecords.id, record.id));
      await systemMessage(
        tx,
        rental.conversationId,
        rental.id,
        `${rental.publicCode}: ${PARTY_LABEL[party]} sudah sampai di titik ${PHASE_LABEL[phase]}.`,
      );
      await notify(
        tx,
        partyId(rental, otherParty(party)),
        "handover_arrived",
        `${PARTY_LABEL[party]} sudah sampai`,
        `${rental.publicCode}: ${PARTY_LABEL[party].toLowerCase()} menunggu di titik ${PHASE_LABEL[phase]}.`,
        `/transaksi/${rental.id}`,
      );
    }
    return { phase, arrivedAt: previous ?? now };
  });
}
// Photo time is the server receive time; the client only says whether the camera was used (F10).
export async function addHandoverPhoto(
  db: Database,
  actor: User,
  rentalId: string,
  raw: unknown,
  key?: string,
) {
  const input = handoverPhotoInput.parse(raw);
  await participantRental(db, actor, rentalId);
  await inspectEvidence(actor.id, input.path, "handover_photo");
  return mutation(db, actor.id, `rental:${rentalId}:handover-photo`, key, input, async (tx) => {
    const rental = await lockRental(tx, rentalId),
      party = partyOf(rental, actor),
      phase = currentPhase(rental);
    assert(
      party === photographer(phase),
      "FORBIDDEN",
      phase === "start"
        ? "Foto kondisi awal diambil oleh penyewa."
        : "Foto kondisi akhir diambil oleh pemilik.",
      403,
    );
    const record = await handoverRecord(tx, rental.id, phase);
    requireBothArrived(record);
    assert(
      (await photoCount(tx, record.id, actor.id, rental.rescheduleCount)) <
        HANDOVER_RULES.maxPhotos,
      "PHOTO_LIMIT",
      `Maksimal ${HANDOVER_RULES.maxPhotos} foto kondisi.`,
      422,
    );
    await claimUploads(tx, actor.id, "handover_photo", [input.path]);
    const [photo] = await tx
      .insert(handoverPhotos)
      .values({
        handoverId: record.id,
        uploadedBy: actor.id,
        path: input.path,
        source: input.source,
        rescheduleCount: rental.rescheduleCount,
      })
      .returning();
    return { id: photo.id, source: photo.source, receivedAt: photo.receivedAt };
  });
}
// Not idempotent on purpose: the plain code must never be stored, even as a cached response.
export async function issueHandoverCode(db: Database, actor: User, rentalId: string) {
  return db.transaction(async (tx) => {
    const rental = await lockRental(tx, rentalId),
      party = partyOf(rental, actor),
      phase = currentPhase(rental);
    assert(
      party === photographer(phase),
      "FORBIDDEN",
      phase === "start"
        ? "Kode serah terima ditampilkan oleh penyewa."
        : "Kode pengembalian ditampilkan oleh pemilik.",
      403,
    );
    const record = await handoverRecord(tx, rental.id, phase);
    requireBothArrived(record);
    assert(
      (await photoCount(tx, record.id, actor.id, rental.rescheduleCount)) >=
        HANDOVER_RULES.minPhotos,
      "PHOTOS_REQUIRED",
      `Ambil minimal ${HANDOVER_RULES.minPhotos} foto kondisi barang terlebih dahulu.`,
      409,
    );
    const code = String(randomInt(0, 10 ** HANDOVER_RULES.codeLength)).padStart(
      HANDOVER_RULES.codeLength,
      "0",
    );
    await tx
      .update(handoverRecords)
      .set({ codeHash: codeDigest(rental.id, phase, code), codeIssuedAt: new Date() })
      .where(eq(handoverRecords.id, record.id));
    return { phase, code };
  });
}
export async function confirmHandover(
  db: Database,
  actor: User,
  rentalId: string,
  raw: unknown,
  key?: string,
) {
  const input = handoverConfirmInput.parse(raw);
  // A wrong code is committed (attempt counter) before the error reaches the user.
  const result = await mutation(
    db,
    actor.id,
    `rental:${rentalId}:handover-confirm`,
    key,
    input,
    async (tx) => {
      const rental = await lockRental(tx, rentalId),
        party = partyOf(rental, actor),
        phase = currentPhase(rental),
        now = new Date();
      assert(
        party === codeReceiver(phase),
        "FORBIDDEN",
        phase === "start"
          ? "Pemilik memasukkan kode dari penyewa."
          : "Penyewa memasukkan kode dari pemilik.",
        403,
      );
      const record = await handoverRecord(tx, rental.id, phase);
      requireBothArrived(record);
      assert(
        (await photoCount(
          tx,
          record.id,
          partyId(rental, photographer(phase)),
          rental.rescheduleCount,
        )) >= HANDOVER_RULES.minPhotos,
        "PHOTOS_REQUIRED",
        phase === "start"
          ? `Penyewa perlu mengambil minimal ${HANDOVER_RULES.minPhotos} foto kondisi barang.`
          : `Pemilik perlu mengambil minimal ${HANDOVER_RULES.minPhotos} foto kondisi akhir.`,
        409,
      );
      assert(
        phase === "end" || input.photosConfirmed,
        "PHOTOS_UNCONFIRMED",
        "Periksa foto kondisi dari penyewa, lalu centang konfirmasi foto.",
        422,
      );
      assert(
        record.codeHash,
        "CODE_NOT_ISSUED",
        phase === "start"
          ? "Minta penyewa menampilkan kode serah terima."
          : "Minta pemilik menampilkan kode pengembalian.",
        409,
      );
      if (codeLocked(record, now))
        return { ok: false as const, lockedUntil: record.codeLockedUntil!.toISOString(), left: 0 };
      if (!safeEqual(codeDigest(rental.id, phase, input.code), record.codeHash)) {
        const patch = failedCodeAttempt(record.codeFailedAttempts, now);
        await tx.update(handoverRecords).set(patch).where(eq(handoverRecords.id, record.id));
        return patch.codeLockedUntil
          ? { ok: false as const, lockedUntil: patch.codeLockedUntil.toISOString(), left: 0 }
          : {
              ok: false as const,
              lockedUntil: null,
              left: HANDOVER_RULES.maxAttempts - patch.codeFailedAttempts,
            };
      }
      await tx
        .update(handoverRecords)
        .set({
          completedAt: now,
          codeHash: null,
          codeFailedAttempts: 0,
          codeLockedUntil: null,
          ...(phase === "start" ? { photosConfirmedAt: now } : {}),
        })
        .where(eq(handoverRecords.id, record.id));
      if (phase === "start") {
        const next = await transitionRental(
          tx,
          rental,
          "BERJALAN",
          { id: actor.id, type: "user" },
          { handoverId: record.id },
        );
        await notify(
          tx,
          rental.renterId,
          "handover_completed",
          "Serah terima selesai",
          `${rental.publicCode}: kembalikan barang paling lambat ${dateWib(rental.dueAt)}.`,
          `/transaksi/${rental.id}`,
        );
        return { ok: true as const, status: next.status, version: next.version };
      }
      // Late fees stop at the renter's arrival when the owner was reported absent (A-3.7).
      const rules = rental.rulesSnapshot,
        returned = rental.lateUntil && rental.lateUntil < now ? rental.lateUntil : now,
        fee = lateFee(rental, returned, rules),
        late = returned.getTime() > rental.dueAt.getTime() + rules.late_grace_hours * 3600000,
        reviewEndsAt = new Date(now.getTime() + rules.review_window_hours * 3600000);
      const next = await transitionRental(
        tx,
        rental,
        "DIKEMBALIKAN",
        { id: actor.id, type: "user" },
        { handoverId: record.id, lateFee: fee },
        { returnedAt: now, reviewEndsAt, lateFee: fee },
      );
      if (late) await giveStrike(tx, rental.renterId, "terlambat", rental);
      for (const userId of [rental.ownerId, rental.renterId])
        await notify(
          tx,
          userId,
          "return_completed",
          "Barang sudah kembali",
          `${rental.publicCode}: cek kondisi sebelum ${dateWib(reviewEndsAt)}. Tanpa laporan masalah, pengembalian dianggap sesuai.`,
          `/transaksi/${rental.id}`,
        );
      return { ok: true as const, status: next.status, version: next.version };
    },
  );
  if (!result.ok)
    throw result.lockedUntil
      ? new AppError(
          "CODE_LOCKED",
          `Kode salah ${HANDOVER_RULES.maxAttempts} kali. Coba lagi setelah ${dateWib(result.lockedUntil)}.`,
          429,
        )
      : new AppError("WRONG_CODE", `Kode tidak cocok. Sisa ${result.left} percobaan.`, 422);
  return { status: result.status, version: result.version };
}
// "Sesuai" from both parties, or silence until the window ends, releases the funds (A-3.5).
export async function checkReturn(
  db: Database,
  actor: User,
  rentalId: string,
  raw: unknown,
  key?: string,
) {
  const input = checkInput.parse(raw);
  if (input.decision === "masalah")
    return reportProblem(
      db,
      actor,
      rentalId,
      {
        category: input.category,
        description: input.description,
        evidencePaths: input.evidencePaths,
      },
      key,
      { only: "DIKEMBALIKAN", scope: `rental:${rentalId}:check` },
    );
  return mutation(db, actor.id, `rental:${rentalId}:check`, key, input, async (tx) => {
    const rental = await lockRental(tx, rentalId),
      party = partyOf(rental, actor),
      now = new Date();
    assert(
      rental.status === "DIKEMBALIKAN" && rental.reviewEndsAt && rental.reviewEndsAt > now,
      "CHECK_CLOSED",
      "Masa cek sudah berakhir atau barang belum dikembalikan.",
      409,
    );
    // Same shape as the "Ada masalah" result; no dispute is opened here.
    const disputeId = null as string | null;
    if (party === "owner" ? rental.ownerOkAt : rental.renterOkAt)
      return { status: rental.status, version: rental.version, disputeId };
    const patch = party === "owner" ? { ownerOkAt: now } : { renterOkAt: now },
      meta = { action: "check_ok", party };
    if (!(party === "owner" ? rental.renterOkAt : rental.ownerOkAt)) {
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
      return { status: next.status, version: next.version, disputeId };
    }
    const next = await transitionRental(
      tx,
      rental,
      "PENCAIRAN_DIPROSES",
      { id: actor.id, type: "user" },
      meta,
      patch,
    );
    await settleRental(tx, next, "normal");
    return { status: next.status, version: next.version, disputeId };
  });
}
export async function reportNoShow(db: Database, actor: User, rentalId: string, key?: string) {
  return mutation(db, actor.id, `rental:${rentalId}:no-show`, key, {}, async (tx) => {
    const rental = await lockRental(tx, rentalId),
      party = partyOf(rental, actor),
      phase = currentPhase(rental),
      now = new Date();
    const record = await handoverRecord(tx, rental.id, phase),
      other = otherParty(party);
    assert(
      arrivedAt(record, party),
      "ARRIVAL_REQUIRED",
      'Tekan "Saya sudah sampai" terlebih dahulu.',
      409,
    );
    assert(
      !arrivedAt(record, other),
      "OTHER_ARRIVED",
      "Pihak lain sudah menandai kehadirannya. Lanjutkan langkah berikutnya.",
      409,
    );
    const opensAt = noShowOpensAt(scheduleOf(rental, phase), rental.rulesSnapshot);
    assert(
      now >= opensAt,
      "NO_SHOW_TOO_EARLY",
      `Laporan tidak hadir tersedia mulai ${dateWib(opensAt)}.`,
      409,
    );
    const [open] = await tx
      .select({ id: noShowReports.id })
      .from(noShowReports)
      .where(
        and(
          eq(noShowReports.rentalId, rental.id),
          eq(noShowReports.phase, phase),
          eq(noShowReports.status, "menunggu"),
        ),
      );
    assert(!open, "NO_SHOW_EXISTS", "Laporan tidak hadir sudah dibuat.", 409);
    const hours = rental.rulesSnapshot.no_show_response_hours;
    const [report] = await tx
      .insert(noShowReports)
      .values({
        rentalId: rental.id,
        phase,
        reportedBy: actor.id,
        reportedParty: partyId(rental, other),
        respondBy: new Date(now.getTime() + hours * 3600000),
      })
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
      meta: { action: "no_show_reported", reportId: report.id, phase },
    });
    await systemMessage(
      tx,
      rental.conversationId,
      rental.id,
      `${rental.publicCode}: ${PARTY_LABEL[party]} melaporkan ${PARTY_LABEL[other].toLowerCase()} tidak hadir saat ${PHASE_LABEL[phase]}.`,
    );
    await notify(
      tx,
      report.reportedParty,
      "no_show_reported",
      "Kamu dilaporkan tidak hadir",
      `${rental.publicCode}: ${PARTY_LABEL[party].toLowerCase()} melaporkan kamu tidak datang saat ${PHASE_LABEL[phase]}. Bantah dalam ${hours} jam bila tidak benar.`,
      `/transaksi/${rental.id}`,
    );
    return { id: report.id, respondBy: report.respondBy };
  });
}
export async function contestNoShow(
  db: Database,
  actor: User,
  rentalId: string,
  reportId: string,
  raw: unknown,
  key?: string,
) {
  const input = noShowContestInput.parse(raw);
  await participantRental(db, actor, rentalId);
  await inspectDisputeFiles(actor.id, input.evidencePaths);
  return mutation(db, actor.id, `no-show:${reportId}:dispute`, key, input, async (tx) => {
    const rental = await lockRental(tx, rentalId);
    partyOf(rental, actor);
    const [report] = await tx
      .select()
      .from(noShowReports)
      .where(and(eq(noShowReports.id, reportId), eq(noShowReports.rentalId, rentalId)))
      .for("update");
    assert(report, "NOT_FOUND", "Laporan tidak ditemukan.", 404);
    assert(
      report.reportedParty === actor.id,
      "FORBIDDEN",
      "Hanya pihak yang dilaporkan dapat membantah.",
      403,
    );
    assert(
      report.status === "menunggu" && report.respondBy > new Date(),
      "NO_SHOW_CLOSED",
      "Batas bantahan sudah lewat atau laporan sudah diproses.",
      409,
    );
    await tx
      .update(noShowReports)
      .set({ status: "dibantah", resolvedAt: new Date() })
      .where(eq(noShowReports.id, report.id));
    const { rental: next, dispute } = await openDispute(tx, rental, {
      openedBy: actor.id,
      category: "tidak_hadir",
      description: input.description,
      evidencePaths: input.evidencePaths,
      meta: { noShowReportId: report.id },
    });
    return { status: next.status, version: next.version, disputeId: dispute.id };
  });
}
