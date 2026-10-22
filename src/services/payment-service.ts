import { and, asc, eq, gt, ilike, lte, or } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { Database, Executor } from "@/src/db";
import {
  adminAuditLogs,
  ledgerEntries,
  payments,
  payoutAccounts,
  payoutTasks,
  platformAccounts,
  rentalEvents,
  rentals,
  type Rental,
  type User,
} from "@/src/db/schema";
import { mutation } from "@/src/db/mutation";
import { AppError, assert, isUniqueViolation } from "@/src/lib/errors";
import {
  paymentDecisionInput,
  paymentInput,
  paymentQueueInput,
  platformAccountInput,
} from "@/src/lib/transaction-validation";
import { claimUploads, evidencePreview, inspectEvidence } from "@/src/lib/storage";
import { FINAL_STATUSES, RENTAL_LABELS } from "@/src/domain/rental-state-machine";
import { addDays, paymentReviewTarget, wibDateKey, wibDayStart } from "@/src/domain/availability";
import { requireAdmin, requireSuperAdmin } from "./admin-service";
import { lockRental, transitionRental } from "./rental-service";
import { notify, notifyAdmins } from "./notification-service";

async function accountAudit(tx: Executor, actor: User, action: string, id: string) {
  await tx
    .insert(adminAuditLogs)
    .values({ adminId: actor.id, action, targetType: "platform_accounts", targetId: id });
}
export async function listPlatformAccounts(db: Executor, actor: User) {
  requireSuperAdmin(actor);
  return db
    .select()
    .from(platformAccounts)
    .orderBy(asc(platformAccounts.provider), asc(platformAccounts.id));
}
export async function savePlatformAccount(
  db: Database,
  actor: User,
  id: string | null,
  raw: unknown,
  key?: string,
) {
  requireSuperAdmin(actor);
  const input = platformAccountInput.parse(raw);
  try {
    return await mutation(
      db,
      actor.id,
      `platform-account:${id || "create"}`,
      key,
      input,
      async (tx) => {
        const rows = id
          ? await tx
              .update(platformAccounts)
              .set(input)
              .where(eq(platformAccounts.id, id))
              .returning()
          : await tx.insert(platformAccounts).values(input).returning();
        assert(rows[0], "NOT_FOUND", "Rekening platform tidak ditemukan.", 404);
        await accountAudit(
          tx,
          actor,
          id ? "platform_account_updated" : "platform_account_created",
          rows[0].id,
        );
        return rows[0];
      },
    );
  } catch (error) {
    if (isUniqueViolation(error))
      throw new AppError("DUPLICATE_ACCOUNT", "Rekening ini sudah terdaftar.", 409);
    throw error;
  }
}
export async function deletePlatformAccount(db: Database, actor: User, id: string) {
  requireSuperAdmin(actor);
  return db.transaction(async (tx) => {
    const [account] = await tx
      .select()
      .from(platformAccounts)
      .where(eq(platformAccounts.id, id))
      .for("update");
    assert(account, "NOT_FOUND", "Rekening platform tidak ditemukan.", 404);
    const [used] = await tx
      .select({ id: payments.id })
      .from(payments)
      .where(eq(payments.platformAccountId, id))
      .limit(1);
    assert(
      !used,
      "ACCOUNT_IN_USE",
      "Rekening sudah dipakai. Nonaktifkan agar bukti lama tetap tersimpan.",
      409,
    );
    await tx.delete(platformAccounts).where(eq(platformAccounts.id, id));
    await accountAudit(tx, actor, "platform_account_deleted", id);
    return { id };
  });
}
export interface PaymentProvider {
  receive(
    tx: Executor,
    rentalId: string,
    paymentId: string,
    accountId: string,
    amount: number,
  ): Promise<void>;
}
export async function postJournal(
  tx: Executor,
  rentalId: string,
  paymentId: string,
  debitAccount: string,
  creditAccount: string,
  amount: number,
  memo: string,
) {
  assert(
    Number.isSafeInteger(amount) && amount > 0 && debitAccount !== creditAccount,
    "INVALID_JOURNAL",
    "Nominal jurnal tidak valid.",
    422,
  );
  const journalId = randomUUID();
  await tx.insert(ledgerEntries).values([
    { journalId, rentalId, paymentId, account: debitAccount, debit: amount, credit: 0, memo },
    { journalId, rentalId, paymentId, account: creditAccount, debit: 0, credit: amount, memo },
  ]);
}
export const manualPaymentProvider: PaymentProvider = {
  receive: (tx, rentalId, paymentId, accountId, amount) =>
    postJournal(
      tx,
      rentalId,
      paymentId,
      `kas:${accountId}`,
      "dana_ditahan",
      amount,
      "Bukti transfer diterima admin",
    ),
};
export async function submitPayment(
  db: Database,
  actor: User,
  rentalId: string,
  raw: unknown,
  key?: string,
) {
  const input = paymentInput.parse(raw);
  const [reference] = await db
    .select()
    .from(rentals)
    .where(and(eq(rentals.id, rentalId), eq(rentals.renterId, actor.id)));
  assert(reference, "NOT_FOUND", "Transaksi tidak ditemukan.", 404);
  const digest = await inspectEvidence(actor.id, input.proofPath, "payment_proof");
  try {
    return await mutation(db, actor.id, `payment:submit:${rentalId}`, key, input, async (tx) => {
      const rental = await lockRental(tx, rentalId),
        now = new Date();
      assert(rental.renterId === actor.id, "NOT_FOUND", "Transaksi tidak ditemukan.", 404);
      assert(
        ["DISETUJUI", "MENUNGGU_VERIFIKASI"].includes(rental.status) &&
          rental.payBy &&
          rental.payBy > now,
        "PAYMENT_CLOSED",
        "Batas unggah bukti sudah berakhir atau pembayaran sudah selesai.",
        409,
      );
      assert(
        new Date(input.transferredAt).getTime() <= now.getTime() + 60000,
        "INVALID_TRANSFER_TIME",
        "Waktu transfer tidak boleh di masa depan.",
        422,
      );
      const [account] = await tx
        .select()
        .from(platformAccounts)
        .where(eq(platformAccounts.id, input.platformAccountId))
        .for("share");
      assert(account?.active, "INVALID_ACCOUNT", "Pilih rekening platform yang masih aktif.", 422);
      await claimUploads(tx, actor.id, "payment_proof", [input.proofPath]);
      const [proof] = await tx
        .insert(payments)
        .values({
          rentalId,
          platformAccountId: account.id,
          platformSnapshot: {
            type: account.type,
            provider: account.provider,
            accountNo: account.accountNo,
            accountName: account.accountName,
          },
          proofPath: input.proofPath,
          proofSha256: digest,
          senderName: input.senderName,
          transferredAt: new Date(input.transferredAt),
          claimedAmount: input.claimedAmount,
          targetAt: paymentReviewTarget(now, rental.rulesSnapshot),
        })
        .returning();
      if (rental.status === "DISETUJUI")
        await transitionRental(
          tx,
          rental,
          "MENUNGGU_VERIFIKASI",
          { id: actor.id, type: "user" },
          { paymentId: proof.id },
        );
      else {
        await tx
          .update(rentals)
          .set({ version: rental.version + 1 })
          .where(eq(rentals.id, rental.id));
        await tx.insert(rentalEvents).values({
          rentalId,
          fromStatus: rental.status,
          toStatus: rental.status,
          actorId: actor.id,
          actorType: "user",
          meta: { paymentId: proof.id, action: "payment_submitted" },
        });
      }
      await notifyAdmins(
        tx,
        "Bukti transfer menunggu verifikasi",
        `${rental.publicCode}: cocokkan bukti dengan mutasi rekening.`,
        "/admin/pembayaran",
      );
      return { id: proof.id, status: "menunggu", targetAt: proof.targetAt };
    });
  } catch (error) {
    if (isUniqueViolation(error))
      throw new AppError(
        "DUPLICATE_PROOF",
        "Bukti transfer yang sama sudah dikirim. Gunakan bukti transfer berikutnya.",
        409,
      );
    throw error;
  }
}
export async function refundAcceptedPayments(tx: Executor, rental: Rental) {
  if (!FINAL_STATUSES.includes(rental.status) || rental.amountReceived === 0) return;
  const [payout] = await tx
    .select()
    .from(payoutAccounts)
    .where(eq(payoutAccounts.userId, rental.renterId));
  assert(
    payout,
    "REFUND_ACCOUNT_MISSING",
    "Rekening refund belum tersedia. Hubungi pengelola.",
    409,
  );
  const accepted = await tx
    .select()
    .from(payments)
    .where(and(eq(payments.rentalId, rental.id), eq(payments.status, "diterima")));
  const rules = rental.rulesSnapshot,
    now = new Date(),
    hour = new Date(now.getTime() + 7 * 3600000).getUTCHours();
  const target = new Date(
    wibDayStart(
      hour < rules.payout_cutoff_hour ? wibDateKey(now) : addDays(wibDateKey(now), 1),
    ).getTime() +
      (hour < rules.payout_cutoff_hour ? rules.payout_same_day_hour : rules.payout_next_day_hour) *
        3600000,
  );
  for (const payment of accepted) {
    const [task] = await tx
      .insert(payoutTasks)
      .values({
        rentalId: rental.id,
        recipientId: rental.renterId,
        sourcePaymentId: payment.id,
        kind: "refund_penyewa",
        amount: payment.verifiedAmount!,
        accountSnapshot: {
          type: payout.type,
          provider: payout.provider,
          accountNoEnc: payout.accountNoEnc,
          accountName: payout.accountName,
        },
        targetAt: target,
      })
      .onConflictDoNothing({ target: payoutTasks.sourcePaymentId })
      .returning();
    if (task)
      await postJournal(
        tx,
        rental.id,
        payment.id,
        "dana_ditahan",
        "hutang_penyewa",
        payment.verifiedAmount!,
        "Dana transaksi final menjadi kewajiban refund",
      );
  }
}
export async function decidePayment(
  db: Database,
  actor: User,
  proofId: string,
  raw: unknown,
  key?: string,
) {
  requireAdmin(actor);
  const input = paymentDecisionInput.parse(raw);
  return mutation(db, actor.id, `payment:decision:${proofId}`, key, input, async (tx) => {
    const [reference] = await tx
      .select({ rentalId: payments.rentalId })
      .from(payments)
      .where(eq(payments.id, proofId));
    assert(reference, "NOT_FOUND", "Bukti transfer tidak ditemukan.", 404);
    const rental = await lockRental(tx, reference.rentalId);
    const [proof] = await tx.select().from(payments).where(eq(payments.id, proofId)).for("update");
    assert(
      proof.status === "menunggu",
      "PAYMENT_ALREADY_REVIEWED",
      "Bukti ini sudah diproses. Muat ulang antrean.",
      409,
    );
    assert(
      rental.version === input.version,
      "RENTAL_CHANGED",
      "Ada perubahan pada transaksi. Muat ulang sebelum memutuskan.",
      409,
    );
    assert(
      ![rental.ownerId, rental.renterId].includes(actor.id),
      "SELF_REVIEW_FORBIDDEN",
      "Minta admin lain memverifikasi pembayaran transaksi milikmu.",
      403,
    );
    assert(
      rental.status === "MENUNGGU_VERIFIKASI" || FINAL_STATUSES.includes(rental.status),
      "INVALID_TRANSITION",
      "Transaksi belum bisa diverifikasi.",
      409,
    );
    const accepted = input.decision === "diterima",
      amount = accepted ? input.verifiedAmount! : 0;
    await tx
      .update(payments)
      .set({
        status: input.decision,
        verifiedAmount: accepted ? amount : null,
        rejectReason: accepted ? null : input.reason,
        verifiedBy: actor.id,
        verifiedAt: new Date(),
      })
      .where(eq(payments.id, proofId));
    if (accepted)
      await manualPaymentProvider.receive(tx, rental.id, proof.id, proof.platformAccountId, amount);
    const received = rental.amountReceived + amount;
    const [pending] = await tx
      .select({ id: payments.id })
      .from(payments)
      .where(and(eq(payments.rentalId, rental.id), eq(payments.status, "menunggu")))
      .limit(1);
    let updated: Rental;
    if (rental.status === "MENUNGGU_VERIFIKASI" && !pending) {
      const paid = received >= rental.amountDue;
      updated = await transitionRental(
        tx,
        rental,
        paid ? "DIBAYAR" : "DISETUJUI",
        { id: actor.id, type: "admin" },
        { paymentId: proof.id, decision: input.decision, verifiedAmount: amount },
        {
          amountReceived: received,
          ...(!paid
            ? {
                payBy: new Date(
                  Math.max(
                    rental.payBy!.getTime(),
                    Date.now() + rental.rulesSnapshot.payment_extension_hours * 3600000,
                  ),
                ),
              }
            : {}),
        },
      );
      if (paid)
        await notify(
          tx,
          rental.ownerId,
          "payment_decided",
          "Pembayaran diterima platform",
          `${rental.publicCode} siap serah terima.`,
          `/transaksi/${rental.id}`,
        );
    } else {
      [updated] = await tx
        .update(rentals)
        .set({ amountReceived: received, version: rental.version + 1 })
        .where(eq(rentals.id, rental.id))
        .returning();
      await tx.insert(rentalEvents).values({
        rentalId: rental.id,
        fromStatus: rental.status,
        toStatus: rental.status,
        actorId: actor.id,
        actorType: "admin",
        meta: {
          paymentId: proof.id,
          action: "payment_verified",
          decision: input.decision,
          verifiedAmount: amount,
        },
      });
    }
    await refundAcceptedPayments(tx, updated);
    await tx.insert(adminAuditLogs).values({
      adminId: actor.id,
      action: accepted ? "payment_accepted" : "payment_rejected",
      targetType: "payments",
      targetId: proof.id,
      meta: { rentalId: rental.id, verifiedAmount: amount, reason: input.reason || null },
    });
    await notify(
      tx,
      rental.renterId,
      "payment_decided",
      accepted ? "Bukti transfer diterima" : "Bukti transfer perlu diperbaiki",
      `${rental.publicCode}: ${accepted ? `Rp${amount.toLocaleString("id-ID")} diterima.` : input.reason} ${updated.status === "DISETUJUI" ? `Sisa pembayaran Rp${Math.max(0, updated.amountDue - received).toLocaleString("id-ID")}.` : RENTAL_LABELS[updated.status]}`,
      `/transaksi/${rental.id}`,
    );
    return {
      id: proof.id,
      status: input.decision,
      rentalStatus: updated.status,
      version: updated.version,
    };
  });
}
export async function paymentQueue(db: Executor, actor: User, filter: unknown = {}) {
  requireAdmin(actor);
  const { q, sla } = paymentQueueInput.parse(filter);
  const search = `%${q.replace(/[\\%_]/g, "\\$&")}%`;
  return db
    .select({
      payment: payments,
      publicCode: rentals.publicCode,
      version: rentals.version,
      amountDue: rentals.amountDue,
      amountReceived: rentals.amountReceived,
    })
    .from(payments)
    .innerJoin(rentals, eq(rentals.id, payments.rentalId))
    .where(
      and(
        eq(payments.status, "menunggu"),
        q ? or(ilike(rentals.publicCode, search), ilike(payments.senderName, search)) : undefined,
        sla === "overdue"
          ? lte(payments.targetAt, new Date())
          : sla === "on_time"
            ? gt(payments.targetAt, new Date())
            : undefined,
      ),
    )
    .orderBy(asc(payments.createdAt), asc(payments.id))
    .limit(100);
}
export async function paymentDetail(db: Database, actor: User, id: string) {
  requireAdmin(actor);
  const [row] = await db
    .select({ payment: payments, rental: rentals })
    .from(payments)
    .innerJoin(rentals, eq(rentals.id, payments.rentalId))
    .where(eq(payments.id, id));
  assert(row, "NOT_FOUND", "Bukti tidak ditemukan.", 404);
  await db.insert(adminAuditLogs).values({
    adminId: actor.id,
    action: "payment_proof_viewed",
    targetType: "payments",
    targetId: id,
  });
  return { ...row, proofUrl: await evidencePreview(row.payment.proofPath) };
}
