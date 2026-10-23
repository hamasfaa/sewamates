import { asc, desc, eq, inArray } from "drizzle-orm";
import type { Executor } from "@/src/db";
import {
  disputeEvidence,
  disputes,
  handoverPhotos,
  handoverRecords,
  noShowReports,
  payoutTasks,
  rescheduleRequests,
  type HandoverRecord,
  type Rental,
} from "@/src/db/schema";
import { decrypt, maskAccount } from "@/src/lib/crypto";
import { evidencePreview } from "@/src/lib/storage";
import {
  DISPUTE_LABELS,
  USER_DISPUTE_CATEGORIES,
  type DisputeCategory,
} from "@/src/domain/dispute";
import {
  checkInOpen,
  codeLocked,
  codeReceiver,
  HANDOVER_RULES,
  noShowOpensAt,
  otherParty,
  phaseOf,
  photographer,
  RESCHEDULE_STATUSES,
  scheduleOf,
  type Party,
} from "@/src/domain/handover";
import { cancellationSplit, cancellationTerms, fullRefund, normalSplit } from "@/src/domain/payout";

// Participants and staff see the same evidence; links are short-lived signed URLs (04 §6.2).
export async function disputeView(db: Executor, disputeId: string) {
  const [dispute] = await db.select().from(disputes).where(eq(disputes.id, disputeId));
  const evidence = await db
    .select()
    .from(disputeEvidence)
    .where(eq(disputeEvidence.disputeId, disputeId))
    .orderBy(asc(disputeEvidence.createdAt), asc(disputeEvidence.id));
  return {
    id: dispute.id,
    category: dispute.category,
    label: DISPUTE_LABELS[dispute.category],
    description: dispute.description,
    openedBy: dispute.openedBy,
    openedFromStatus: dispute.openedFromStatus,
    status: dispute.status,
    respondBy: dispute.respondBy,
    decideBy: dispute.decideBy,
    outcome: dispute.outcome,
    decisionNote: dispute.decisionNote,
    createdAt: dispute.createdAt,
    evidence: await Promise.all(
      evidence.map(async (item) => ({
        id: item.id,
        uploadedBy: item.uploadedBy,
        note: item.note,
        createdAt: item.createdAt,
        pdf: item.path.endsWith(".pdf"),
        url: await evidencePreview(item.path),
      })),
    ),
  };
}
function maskedAccount(snapshot: Record<string, unknown>) {
  try {
    return maskAccount(decrypt(String(snapshot.accountNoEnc)));
  } catch {
    return null;
  }
}
// Handover, reschedule, no-show, dispute and payout state of one rental, plus the actions the
// viewer may take now. The server re-validates every action; these flags only drive the UI.
export async function rentalProgress(
  db: Executor,
  rental: Rental,
  viewer: { id: string; staff: boolean },
) {
  const now = new Date(),
    rules = rental.rulesSnapshot,
    me: Party | null =
      viewer.id === rental.ownerId ? "owner" : viewer.id === rental.renterId ? "renter" : null;
  const records = await db
    .select()
    .from(handoverRecords)
    .where(eq(handoverRecords.rentalId, rental.id));
  const photos = records.length
    ? await db
        .select()
        .from(handoverPhotos)
        .where(
          inArray(
            handoverPhotos.handoverId,
            records.map((record) => record.id),
          ),
        )
        .orderBy(asc(handoverPhotos.receivedAt), asc(handoverPhotos.id))
    : [];
  const recordView = async (record: HandoverRecord | undefined) =>
    record
      ? {
          id: record.id,
          type: record.type,
          ownerArrivedAt: record.ownerArrivedAt,
          renterArrivedAt: record.renterArrivedAt,
          ownerLocated: Boolean(record.ownerLocation),
          renterLocated: Boolean(record.renterLocation),
          photosConfirmedAt: record.photosConfirmedAt,
          codeIssuedAt: record.codeIssuedAt,
          codeLockedUntil: codeLocked(record, now) ? record.codeLockedUntil : null,
          completedAt: record.completedAt,
          photos: await Promise.all(
            photos
              .filter((photo) => photo.handoverId === record.id)
              .map(async (photo) => ({
                id: photo.id,
                uploadedBy: photo.uploadedBy,
                source: photo.source,
                receivedAt: photo.receivedAt,
                currentSchedule: photo.rescheduleCount === rental.rescheduleCount,
                url: await evidencePreview(photo.path),
              })),
          ),
        }
      : null;
  const reschedules = await db
    .select()
    .from(rescheduleRequests)
    .where(eq(rescheduleRequests.rentalId, rental.id))
    .orderBy(desc(rescheduleRequests.createdAt));
  const noShows = await db
    .select()
    .from(noShowReports)
    .where(eq(noShowReports.rentalId, rental.id))
    .orderBy(desc(noShowReports.createdAt));
  const [latestDispute] = await db
    .select({ id: disputes.id })
    .from(disputes)
    .where(eq(disputes.rentalId, rental.id))
    .orderBy(desc(disputes.createdAt))
    .limit(1);
  const tasks = await db
    .select()
    .from(payoutTasks)
    .where(eq(payoutTasks.rentalId, rental.id))
    .orderBy(asc(payoutTasks.createdAt), asc(payoutTasks.id));
  const dispute = latestDispute ? await disputeView(db, latestDispute.id) : null;
  const payouts = await Promise.all(
    tasks.map(async (task) => {
      const visible = viewer.staff || task.recipientId === viewer.id;
      return {
        id: task.id,
        kind: task.kind,
        amount: task.amount,
        status: task.status,
        recipientId: task.recipientId,
        targetAt: task.targetAt,
        transferredAt: task.transferredAt,
        completedAt: task.completedAt,
        account: visible
          ? {
              provider: String(task.accountSnapshot.provider),
              accountName: String(task.accountSnapshot.accountName),
              accountNo: maskedAccount(task.accountSnapshot),
            }
          : null,
        proofUrl: visible && task.proofPath ? await evidencePreview(task.proofPath) : null,
      };
    }),
  );

  const phase = phaseOf(rental.status),
    record = phase ? records.find((item) => item.type === phase) : undefined,
    scheduled = phase ? scheduleOf(rental, phase) : null,
    arrived = (party: Party) =>
      record ? (party === "owner" ? record.ownerArrivedAt : record.renterArrivedAt) : null,
    bothArrived = Boolean(record?.ownerArrivedAt && record.renterArrivedAt),
    shooter = phase ? photographer(phase) : null,
    shooterId = shooter === "owner" ? rental.ownerId : rental.renterId,
    shooterPhotos = record
      ? photos.filter(
          (photo) =>
            photo.handoverId === record.id &&
            photo.uploadedBy === shooterId &&
            photo.rescheduleCount === rental.rescheduleCount,
        ).length
      : 0,
    noShowAt = phase && scheduled ? noShowOpensAt(scheduled, rules) : null,
    pendingNoShow = noShows.find((report) => report.status === "menunggu"),
    acceptedNoShow = noShows.find(
      (report) => report.phase === phase && report.status === "diterima",
    ),
    pendingReschedule = reschedules.find((request) => request.status === "menunggu"),
    inReview =
      rental.status === "DIKEMBALIKAN" && Boolean(rental.reviewEndsAt && rental.reviewEndsAt > now);
  const cancellable =
    me &&
    ((rental.status === "DIAJUKAN" && me === "renter") ||
      rental.status === "DISETUJUI" ||
      (rental.status === "DIBAYAR" && !pendingNoShow));
  let cancellation = null;
  if (me && cancellable) {
    const terms = cancellationTerms(rental.status, me, rental.startAt, now, rules),
      split = terms.fee
        ? cancellationSplit(rental, rental.amountReceived, rules.cancellation_rate_bp)
        : { ...fullRefund(rental.amountReceived), fee: 0 };
    cancellation = {
      fee: split.fee,
      refund: split.renter,
      owner: split.owner,
      commission: split.commission,
      strike: terms.strike,
      freeUntil: new Date(rental.startAt.getTime() - rules.cancel_free_hours * 3600000),
    };
  }
  return {
    handover: {
      start: await recordView(records.find((item) => item.type === "start")),
      end: await recordView(records.find((item) => item.type === "end")),
    },
    reschedules,
    noShows,
    dispute,
    payouts,
    cancellation,
    // What the check window will release, including the automatic late fee (F10).
    preview:
      rental.status === "DIKEMBALIKAN"
        ? { ...normalSplit(rental, rental.amountReceived, rental.lateFee), lateFee: rental.lateFee }
        : null,
    actions: {
      phase,
      role: me && phase ? (shooter === me ? "shows_code" : "enters_code") : null,
      checkInOpensAt:
        phase === "start"
          ? new Date(rental.startAt.getTime() - HANDOVER_RULES.earlyMinutes * 60000)
          : null,
      noShowAt,
      codeIssued: Boolean(record?.codeIssuedAt),
      shooterPhotos,
      canArrive: Boolean(
        me && phase && scheduled && !arrived(me) && checkInOpen(phase, scheduled, now),
      ),
      canPhoto: Boolean(
        me && shooter === me && bothArrived && shooterPhotos < HANDOVER_RULES.maxPhotos,
      ),
      canShowCode: Boolean(
        me && shooter === me && bothArrived && shooterPhotos >= HANDOVER_RULES.minPhotos,
      ),
      canEnterCode: Boolean(
        me &&
        phase &&
        codeReceiver(phase) === me &&
        bothArrived &&
        shooterPhotos >= HANDOVER_RULES.minPhotos,
      ),
      canReportNoShow: Boolean(
        me &&
        phase &&
        noShowAt &&
        arrived(me) &&
        !arrived(otherParty(me)) &&
        now >= noShowAt &&
        !pendingNoShow &&
        !acceptedNoShow,
      ),
      canContestNoShow: Boolean(
        pendingNoShow && pendingNoShow.reportedParty === viewer.id && pendingNoShow.respondBy > now,
      ),
      canReschedule: Boolean(
        me &&
        RESCHEDULE_STATUSES.includes(rental.status) &&
        rental.rescheduleCount < rules.reschedule_max &&
        !pendingReschedule,
      ),
      canRespondReschedule: Boolean(
        me && pendingReschedule && pendingReschedule.proposedBy !== viewer.id,
      ),
      canCancel: Boolean(cancellation),
      canCheck: Boolean(me && inReview && !(me === "owner" ? rental.ownerOkAt : rental.renterOkAt)),
      canDispute: Boolean(
        me &&
        (rental.status === "BERJALAN" ||
          inReview ||
          (rental.status === "DIBAYAR" && me === "renter" && bothArrived)),
      ),
      disputeCategories:
        rental.status === "DIBAYAR"
          ? (["tidak_sesuai"] as DisputeCategory[])
          : USER_DISPUTE_CATEGORIES,
      canAddEvidence: Boolean(me && dispute?.status === "dibuka"),
    },
  };
}
