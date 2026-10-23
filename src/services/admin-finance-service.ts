import { and, asc, desc, eq, lt, ne, sql } from "drizzle-orm";
import type { Database, Executor } from "@/src/db";
import {
  adminAuditLogs,
  cashMovements,
  ledgerEntries,
  payoutTasks,
  platformAccounts,
  reconciliations,
  rentals,
  type User,
} from "@/src/db/schema";
import { mutation } from "@/src/db/mutation";
import { assert } from "@/src/lib/errors";
import { claimUploads, inspectEvidence } from "@/src/lib/storage";
import { adjustmentInput, reconciliationInput, withdrawalInput } from "@/src/lib/trust-validation";
import { payoutTarget } from "@/src/domain/payout";
import { wibDateKey } from "@/src/domain/availability";
import { requireAdmin, requireSuperAdmin } from "./admin-service";
import { ledgerBalances, postEntries } from "./ledger-service";
import { getSettings } from "./settings-service";
import { notify, notifyAdmins } from "./notification-service";
import { lockRental } from "./rental-service";

async function reserveCommission(tx: Executor, amount: number) {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(7391806)`);
  const balances = await ledgerBalances(tx, ["pendapatan_komisi"]);
  assert(
    -(balances.get("pendapatan_komisi") ?? 0) >= amount,
    "INSUFFICIENT_COMMISSION",
    "Saldo komisi tidak cukup.",
    409,
  );
}
export async function withdrawCommission(db: Database, actor: User, raw: unknown, key?: string) {
  requireSuperAdmin(actor);
  const input = withdrawalInput.parse(raw);
  await inspectEvidence(actor.id, input.proofPath, "cash_proof");
  return mutation(db, actor.id, "commission-withdrawal", key, input, async (tx) => {
    await reserveCommission(tx, input.amount);
    const [account] = await tx
      .select()
      .from(platformAccounts)
      .where(eq(platformAccounts.id, input.fromAccountId));
    assert(account, "INVALID_ACCOUNT", "Rekening platform tidak ditemukan.", 422);
    await claimUploads(tx, actor.id, "cash_proof", [input.proofPath]);
    const [movement] = await tx
      .insert(cashMovements)
      .values({
        type: "penarikan_komisi",
        fromAccountId: input.fromAccountId,
        amount: input.amount,
        proofPath: input.proofPath,
        note: input.note,
        createdBy: actor.id,
      })
      .returning();
    await postEntries(
      tx,
      { cashMovementId: movement.id },
      [
        { account: "pendapatan_komisi", debit: input.amount },
        { account: `kas:${account.id}`, credit: input.amount },
      ],
      "Penarikan komisi platform",
    );
    await tx
      .insert(adminAuditLogs)
      .values({
        adminId: actor.id,
        action: "commission_withdrawn",
        targetType: "cash_movements",
        targetId: movement.id,
        meta: { amount: input.amount, note: input.note },
      });
    return { id: movement.id };
  });
}
export async function createAdjustment(db: Database, actor: User, raw: unknown, key?: string) {
  requireSuperAdmin(actor);
  const input = adjustmentInput.parse(raw);
  return mutation(db, actor.id, "payout-adjustment", key, input, async (tx) => {
    const [original] = await tx
      .select()
      .from(payoutTasks)
      .where(eq(payoutTasks.id, input.originalTaskId));
    assert(
      original?.status === "selesai",
      "INVALID_ORIGINAL",
      "Penyesuaian harus merujuk tugas pencairan yang sudah selesai.",
      422,
    );
    const rental = await lockRental(tx, original.rentalId);
    assert(
      ![rental.ownerId, rental.renterId].includes(actor.id),
      "SELF_PAYOUT_FORBIDDEN",
      "Penyesuaian transaksimu ditangani super admin lain.",
      403,
    );
    assert(
      original.kind !== "penyesuaian",
      "INVALID_ORIGINAL",
      "Pilih tugas pencairan atau refund asli.",
      422,
    );
    await reserveCommission(tx, input.amount);
    const rules = await getSettings(tx);
    const [task] = await tx
      .insert(payoutTasks)
      .values({
        rentalId: original.rentalId,
        recipientId: original.recipientId,
        kind: "penyesuaian",
        adjustmentOf: original.id,
        adjustmentReason: input.reason,
        createdBy: actor.id,
        amount: input.amount,
        accountSnapshot: original.accountSnapshot,
        targetAt: payoutTarget(new Date(), rules),
      })
      .returning();
    await postEntries(
      tx,
      { rentalId: rental.id, payoutTaskId: task.id },
      [
        { account: "pendapatan_komisi", debit: task.amount },
        {
          account: task.recipientId === rental.ownerId ? "hutang_pemilik" : "hutang_penyewa",
          credit: task.amount,
        },
      ],
      input.reason,
    );
    await tx
      .insert(adminAuditLogs)
      .values({
        adminId: actor.id,
        action: "payout_adjustment_created",
        targetType: "payout_tasks",
        targetId: task.id,
        meta: input,
      });
    await notify(
      tx,
      task.recipientId,
      "payout_scheduled",
      "Penyesuaian pencairan dijadwalkan",
      `${rental.publicCode}: ${input.reason}`,
      `/transaksi/${rental.id}`,
    );
    await notifyAdmins(
      tx,
      "Tugas penyesuaian baru",
      `${rental.publicCode}: penyesuaian menunggu transfer.`,
      "/admin/pencairan",
    );
    return { id: task.id };
  });
}
export async function listReconciliations(db: Executor, actor: User) {
  requireAdmin(actor);
  return db
    .select({
      reconciliation: reconciliations,
      provider: platformAccounts.provider,
      accountNo: platformAccounts.accountNo,
    })
    .from(reconciliations)
    .innerJoin(platformAccounts, eq(platformAccounts.id, reconciliations.platformAccountId))
    .orderBy(desc(reconciliations.date), asc(platformAccounts.provider))
    .limit(100);
}
export async function recordReconciliation(db: Database, actor: User, raw: unknown, key?: string) {
  requireAdmin(actor);
  const input = reconciliationInput.parse(raw);
  assert(
    !Number.isNaN(Date.parse(input.date)) &&
      new Date(input.date).toISOString().slice(0, 10) === input.date &&
      input.date <= wibDateKey(new Date()),
    "INVALID_DATE",
    "Tanggal rekonsiliasi harus tanggal yang valid dan tidak di masa depan.",
    422,
  );
  return mutation(db, actor.id, "reconciliation", key, input, async (tx) => {
    const [account] = await tx
      .select()
      .from(platformAccounts)
      .where(eq(platformAccounts.id, input.platformAccountId));
    assert(account, "INVALID_ACCOUNT", "Rekening platform tidak ditemukan.", 422);
    const [{ balance }] = await tx
      .select({
        balance: sql<string>`coalesce(sum(${ledgerEntries.debit}-${ledgerEntries.credit}),0)::text`,
      })
      .from(ledgerEntries)
      .where(
        and(
          eq(ledgerEntries.account, `kas:${account.id}`),
          lt(
            ledgerEntries.createdAt,
            new Date(new Date(`${input.date}T00:00:00+07:00`).getTime() + 86400000),
          ),
        ),
      );
    const ledgerBalance = Number(balance);
    assert(
      input.actualBalance === ledgerBalance || input.note.trim().length >= 5,
      "NOTE_REQUIRED",
      "Selisih saldo wajib dijelaskan dalam catatan.",
      422,
    );
    const [existing] = await tx
      .select()
      .from(reconciliations)
      .where(
        and(
          eq(reconciliations.date, input.date),
          eq(reconciliations.platformAccountId, input.platformAccountId),
        ),
      );
    assert(
      !existing,
      "RECONCILIATION_EXISTS",
      "Rekonsiliasi rekening dan tanggal ini sudah dicatat.",
      409,
    );
    const [saved] = await tx
      .insert(reconciliations)
      .values({ ...input, ledgerBalance, enteredBy: actor.id })
      .returning();
    await tx
      .insert(adminAuditLogs)
      .values({
        adminId: actor.id,
        action: "reconciliation_recorded",
        targetType: "reconciliations",
        targetId: saved.id,
        meta: { difference: input.actualBalance - ledgerBalance, note: input.note },
      });
    return { ...saved, difference: input.actualBalance - ledgerBalance };
  });
}
export async function financialRecap(db: Executor, actor: User) {
  requireAdmin(actor);
  const statuses = await db
    .select({
      status: rentals.status,
      count: sql<number>`count(*)::int`,
      rentalValue: sql<string>`coalesce(sum(${rentals.rentTotal}),0)::text`,
      received: sql<string>`coalesce(sum(${rentals.amountReceived}),0)::text`,
    })
    .from(rentals)
    .groupBy(rentals.status)
    .orderBy(asc(rentals.status));
  const balances = await ledgerBalances(db, [
    "pendapatan_komisi",
    "dana_ditahan",
    "hutang_pemilik",
    "hutang_penyewa",
  ]);
  const [pending] = await db
    .select({
      count: sql<number>`count(*)::int`,
      amount: sql<string>`coalesce(sum(${payoutTasks.amount}),0)::text`,
    })
    .from(payoutTasks)
    .where(ne(payoutTasks.status, "selesai"));
  return {
    statuses: statuses.map((r) => ({
      ...r,
      rentalValue: Number(r.rentalValue),
      received: Number(r.received),
    })),
    commission: -(balances.get("pendapatan_komisi") ?? 0),
    held: -(balances.get("dana_ditahan") ?? 0),
    pendingPayoutCount: pending.count,
    pendingPayoutAmount: Number(pending.amount),
  };
}
