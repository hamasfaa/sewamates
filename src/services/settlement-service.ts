import { and, eq, inArray, isNull } from "drizzle-orm";
import type { Executor } from "@/src/db";
import { payments, payoutAccounts, payoutTasks, rentals, type Rental } from "@/src/db/schema";
import { assert } from "@/src/lib/errors";
import { dateWib, rupiah } from "@/src/lib/utils";
import {
  cancellationSplit,
  fullRefund,
  normalSplit,
  payoutTarget,
  splitIsValid,
  type Settlement,
  type SettlementReason,
} from "@/src/domain/payout";
import { postEntries } from "./ledger-service";
import { notify, notifyAdmins } from "./notification-service";

// Later account changes do not affect created tasks (F3).
async function accountSnapshot(tx: Executor, userId: string) {
  const [account] = await tx.select().from(payoutAccounts).where(eq(payoutAccounts.userId, userId));
  assert(
    account,
    "PAYOUT_ACCOUNT_MISSING",
    "Rekening pencairan penerima belum tersedia. Hubungi pengelola.",
    409,
  );
  return {
    type: account.type,
    provider: account.provider,
    accountNoEnc: account.accountNoEnc,
    accountName: account.accountName,
  };
}
const MEMOS: Record<Exclude<SettlementReason, "putusan">, string> = {
  normal: "Penyelesaian transaksi tanpa sengketa",
  refund_penuh: "Dana transaksi final dikembalikan ke penyewa",
  biaya_batal: "Pembatalan dengan biaya batal",
};
// Moves every accepted, unsettled proof out of dana_ditahan exactly once (A-3.6, A-3.8, A-3.9).
// The first settlement splits the funds; proofs verified afterwards are refunded one by one.
export async function settleRental(
  tx: Executor,
  rental: Rental,
  reason: Exclude<SettlementReason, "putusan"> = "refund_penuh",
) {
  const open = await tx
    .select()
    .from(payments)
    .where(
      and(
        eq(payments.rentalId, rental.id),
        eq(payments.status, "diterima"),
        isNull(payments.settledAt),
      ),
    )
    .for("update");
  if (!open.length) return [];
  const now = new Date(),
    targetAt = payoutTarget(now, rental.rulesSnapshot),
    received = open.reduce((sum, payment) => sum + payment.verifiedAmount!, 0);
  const tasks: (typeof payoutTasks.$inferSelect)[] = [];
  if (rental.settledAt) {
    const account = await accountSnapshot(tx, rental.renterId);
    for (const payment of open) {
      const [task] = await tx
        .insert(payoutTasks)
        .values({
          rentalId: rental.id,
          recipientId: rental.renterId,
          sourcePaymentId: payment.id,
          kind: "refund_penyewa",
          amount: payment.verifiedAmount!,
          accountSnapshot: account,
          targetAt,
        })
        .onConflictDoNothing({ target: payoutTasks.sourcePaymentId })
        .returning();
      if (!task) continue;
      await postEntries(
        tx,
        { rentalId: rental.id, paymentId: payment.id, payoutTaskId: task.id },
        [
          { account: "dana_ditahan", debit: task.amount },
          { account: "hutang_penyewa", credit: task.amount },
        ],
        "Bukti terverifikasi setelah transaksi final menjadi refund",
      );
      tasks.push(task);
    }
  } else {
    const cancellation =
      reason === "biaya_batal"
        ? cancellationSplit(rental, received, rental.rulesSnapshot.cancellation_rate_bp)
        : null;
    const split =
      cancellation ??
      (reason === "normal" ? normalSplit(rental, received, rental.lateFee) : fullRefund(received));
    assert(
      splitIsValid(split, received),
      "INVALID_SPLIT",
      "Pembagian dana tidak seimbang. Hubungi pengelola.",
      409,
    );
    await postEntries(
      tx,
      { rentalId: rental.id },
      [
        { account: "dana_ditahan", debit: received },
        { account: "hutang_pemilik", credit: split.owner },
        { account: "hutang_penyewa", credit: split.renter },
        { account: "pendapatan_komisi", credit: split.commission },
      ],
      MEMOS[reason],
    );
    for (const [recipientId, kind, amount] of [
      [rental.ownerId, "pencairan_pemilik", split.owner],
      [rental.renterId, "refund_penyewa", split.renter],
    ] as const) {
      // Zero-value tasks are never created (A-3.8).
      if (amount <= 0) continue;
      const [task] = await tx
        .insert(payoutTasks)
        .values({
          rentalId: rental.id,
          recipientId,
          kind,
          amount,
          accountSnapshot: await accountSnapshot(tx, recipientId),
          targetAt,
        })
        .returning();
      tasks.push(task);
    }
    const settlement: Settlement = {
      reason,
      received,
      owner: split.owner,
      renter: split.renter,
      commission: split.commission,
      lateFee: reason === "normal" ? rental.lateFee : 0,
      cancellationFee: cancellation?.fee ?? 0,
    };
    await tx.update(rentals).set({ settledAt: now, settlement }).where(eq(rentals.id, rental.id));
  }
  await tx
    .update(payments)
    .set({ settledAt: now })
    .where(
      inArray(
        payments.id,
        open.map((payment) => payment.id),
      ),
    );
  for (const task of tasks)
    await notify(
      tx,
      task.recipientId,
      "payout_scheduled",
      task.kind === "pencairan_pemilik" ? "Pencairan dijadwalkan" : "Refund dijadwalkan",
      `${rental.publicCode}: ${rupiah(task.amount)} ditransfer admin paling lambat ${dateWib(task.targetAt)}.`,
      `/transaksi/${rental.id}`,
    );
  if (tasks.length)
    await notifyAdmins(
      tx,
      "Tugas pencairan baru",
      `${rental.publicCode}: ${tasks.length} transfer menunggu diproses.`,
      "/admin/pencairan",
    );
  return tasks;
}
