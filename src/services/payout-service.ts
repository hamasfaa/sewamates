import { and, asc, desc, eq, gt, ilike, inArray, lt, lte, ne, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Database, Executor } from "@/src/db";
import {
  adminAuditLogs,
  cashMovements,
  items,
  payoutTasks,
  platformAccounts,
  rentals,
  users,
  type User,
} from "@/src/db/schema";
import { mutation } from "@/src/db/mutation";
import { assert } from "@/src/lib/errors";
import { decrypt } from "@/src/lib/crypto";
import { rupiah } from "@/src/lib/utils";
import { claimUploads, evidencePreview, inspectEvidence } from "@/src/lib/storage";
import {
  cashMovementInput,
  payoutCompleteInput,
  payoutQueueInput,
} from "@/src/lib/transaction-validation";
import { requireAdmin } from "./admin-service";
import { lockRental, transitionRental } from "./rental-service";
import { ledgerBalances, postEntries } from "./ledger-service";
import { notify } from "./notification-service";
import { getSettings } from "./settings-service";

type Snapshot = { type: string; provider: string; accountNoEnc: string; accountName: string };
export const PAYOUT_KINDS: Record<string, string> = {
  pencairan_pemilik: "Pencairan ke pemilik",
  refund_penyewa: "Refund ke penyewa",
  penyesuaian: "Penyesuaian",
};
const recipient = alias(users, "recipient"),
  claimer = alias(users, "claimer");
export async function payoutQueue(db: Executor, actor: User, filter: unknown = {}) {
  requireAdmin(actor);
  const { state, sla, q } = payoutQueueInput.parse(filter),
    now = new Date(),
    search = `%${q.replace(/[\\%_]/g, "\\$&")}%`;
  const rows = await db
    .select({
      task: payoutTasks,
      publicCode: rentals.publicCode,
      ownerId: rentals.ownerId,
      renterId: rentals.renterId,
      recipientName: recipient.name,
      claimerName: claimer.name,
    })
    .from(payoutTasks)
    .innerJoin(rentals, eq(rentals.id, payoutTasks.rentalId))
    .innerJoin(recipient, eq(recipient.id, payoutTasks.recipientId))
    .leftJoin(claimer, eq(claimer.id, payoutTasks.claimedBy))
    .where(
      and(
        state === "open" ? ne(payoutTasks.status, "selesai") : eq(payoutTasks.status, "selesai"),
        q ? or(ilike(rentals.publicCode, search), ilike(recipient.name, search)) : undefined,
        sla === "overdue"
          ? lte(payoutTasks.targetAt, now)
          : sla === "on_time"
            ? gt(payoutTasks.targetAt, now)
            : undefined,
      ),
    )
    .orderBy(
      state === "open" ? asc(payoutTasks.targetAt) : desc(payoutTasks.completedAt),
      asc(payoutTasks.id),
    )
    .limit(100);
  return rows.map(({ task, ...row }) => {
    const snapshot = task.accountSnapshot as Snapshot;
    return {
      ...row,
      id: task.id,
      rentalId: task.rentalId,
      kind: task.kind,
      amount: task.amount,
      status: task.status,
      targetAt: task.targetAt,
      createdAt: task.createdAt,
      completedAt: task.completedAt,
      claimedBy: task.claimedBy,
      claimedUntil: task.claimedUntil,
      provider: snapshot.provider,
      accountName: snapshot.accountName,
      self: [row.ownerId, row.renterId].includes(actor.id),
    };
  });
}
// The full account number appears only on this screen, and every view is audited (04 §6.2).
export async function payoutDetail(db: Database, actor: User, id: string) {
  requireAdmin(actor);
  const [row] = await db
    .select({ task: payoutTasks, rental: rentals, recipientName: recipient.name })
    .from(payoutTasks)
    .innerJoin(rentals, eq(rentals.id, payoutTasks.rentalId))
    .innerJoin(recipient, eq(recipient.id, payoutTasks.recipientId))
    .where(eq(payoutTasks.id, id));
  assert(row, "NOT_FOUND", "Tugas pencairan tidak ditemukan.", 404);
  const snapshot = row.task.accountSnapshot as Snapshot;
  let accountNo: string | null = null;
  try {
    accountNo = decrypt(snapshot.accountNoEnc);
  } catch {
    accountNo = null;
  }
  await db.insert(adminAuditLogs).values({
    adminId: actor.id,
    action: "payout_account_viewed",
    targetType: "payout_tasks",
    targetId: id,
    meta: { rentalId: row.rental.id },
  });
  const accounts = await db
    .select()
    .from(platformAccounts)
    .orderBy(desc(platformAccounts.active), asc(platformAccounts.provider));
  const balances = await ledgerBalances(
    db,
    accounts.map((account) => `kas:${account.id}`),
  );
  const task = row.task;
  return {
    task: {
      id: task.id,
      rentalId: task.rentalId,
      recipientId: task.recipientId,
      kind: task.kind,
      amount: task.amount,
      status: task.status,
      targetAt: task.targetAt,
      createdAt: task.createdAt,
      claimedBy: task.claimedBy,
      claimedUntil: task.claimedUntil,
      sourceAccountId: task.sourceAccountId,
      transferFee: task.transferFee,
      transferredAt: task.transferredAt,
      completedAt: task.completedAt,
    },
    recipientName: row.recipientName,
    account: {
      type: snapshot.type,
      provider: snapshot.provider,
      accountName: snapshot.accountName,
      accountNo,
    },
    rental: {
      id: row.rental.id,
      publicCode: row.rental.publicCode,
      title: String(row.rental.listingSnapshot.title),
      status: row.rental.status,
      settlement: row.rental.settlement,
    },
    self: [row.rental.ownerId, row.rental.renterId].includes(actor.id),
    platformAccounts: accounts.map((account) => ({
      id: account.id,
      provider: account.provider,
      accountNo: account.accountNo,
      accountName: account.accountName,
      active: account.active,
      balance: balances.get(`kas:${account.id}`) ?? 0,
    })),
    proofUrl: task.proofPath ? await evidencePreview(task.proofPath) : null,
  };
}
async function audit(tx: Executor, actor: User, action: string, id: string, meta = {}) {
  await tx
    .insert(adminAuditLogs)
    .values({ adminId: actor.id, action, targetType: "payout_tasks", targetId: id, meta });
}
// UPDATE … WHERE status = 'menunggu' OR claim expired (04 §6.3); the claimer may extend its claim.
export async function claimPayout(db: Database, actor: User, id: string, key?: string) {
  requireAdmin(actor);
  return mutation(db, actor.id, `payout:${id}:claim`, key, {}, async (tx) => {
    const [row] = await tx
      .select({ task: payoutTasks, ownerId: rentals.ownerId, renterId: rentals.renterId })
      .from(payoutTasks)
      .innerJoin(rentals, eq(rentals.id, payoutTasks.rentalId))
      .where(eq(payoutTasks.id, id));
    assert(row, "NOT_FOUND", "Tugas pencairan tidak ditemukan.", 404);
    assert(
      ![row.ownerId, row.renterId].includes(actor.id),
      "SELF_PAYOUT_FORBIDDEN",
      "Minta admin lain memproses pencairan transaksi milikmu.",
      403,
    );
    const now = new Date(),
      rules = await getSettings(tx);
    const [claimed] = await tx
      .update(payoutTasks)
      .set({
        status: "diklaim",
        claimedBy: actor.id,
        claimedUntil: new Date(now.getTime() + rules.claim_minutes * 60000),
      })
      .where(
        and(
          eq(payoutTasks.id, id),
          or(
            eq(payoutTasks.status, "menunggu"),
            and(
              eq(payoutTasks.status, "diklaim"),
              or(lt(payoutTasks.claimedUntil, now), eq(payoutTasks.claimedBy, actor.id)),
            ),
          ),
        ),
      )
      .returning();
    assert(
      claimed,
      "PAYOUT_CLAIMED",
      row.task.status === "selesai"
        ? "Tugas ini sudah selesai."
        : "Tugas sedang diklaim admin lain. Muat ulang antrean.",
      409,
    );
    await audit(tx, actor, "payout_claimed", id, { claimedUntil: claimed.claimedUntil });
    return { id, status: claimed.status, claimedUntil: claimed.claimedUntil };
  });
}
export async function releasePayout(db: Database, actor: User, id: string) {
  requireAdmin(actor);
  return db.transaction(async (tx) => {
    const [released] = await tx
      .update(payoutTasks)
      .set({ status: "menunggu", claimedBy: null, claimedUntil: null })
      .where(
        and(
          eq(payoutTasks.id, id),
          eq(payoutTasks.status, "diklaim"),
          eq(payoutTasks.claimedBy, actor.id),
        ),
      )
      .returning({ id: payoutTasks.id });
    assert(released, "CLAIM_REQUIRED", "Tugas tidak sedang kamu klaim.", 409);
    await audit(tx, actor, "payout_released", id);
    return { id, status: "menunggu" };
  });
}
export async function completePayout(
  db: Database,
  actor: User,
  id: string,
  raw: unknown,
  key?: string,
) {
  requireAdmin(actor);
  const input = payoutCompleteInput.parse(raw);
  await inspectEvidence(actor.id, input.proofPath, "payout_proof");
  return mutation(db, actor.id, `payout:${id}:complete`, key, input, async (tx) => {
    const [reference] = await tx
      .select({ rentalId: payoutTasks.rentalId })
      .from(payoutTasks)
      .where(eq(payoutTasks.id, id));
    assert(reference, "NOT_FOUND", "Tugas pencairan tidak ditemukan.", 404);
    const rental = await lockRental(tx, reference.rentalId),
      now = new Date();
    const [task] = await tx.select().from(payoutTasks).where(eq(payoutTasks.id, id)).for("update");
    assert(task.status !== "selesai", "PAYOUT_DONE", "Tugas ini sudah selesai.", 409);
    assert(
      task.status === "diklaim" &&
        task.claimedBy === actor.id &&
        task.claimedUntil &&
        task.claimedUntil > now,
      "CLAIM_REQUIRED",
      "Klaim tugas ini terlebih dahulu. Klaim yang lewat waktu perlu diperpanjang.",
      409,
    );
    assert(
      input.transferredAmount === task.amount,
      "AMOUNT_MISMATCH",
      `Nominal transfer harus sama dengan tugas: ${rupiah(task.amount)}.`,
      422,
    );
    assert(
      new Date(input.transferredAt).getTime() <= now.getTime() + 60000,
      "INVALID_TRANSFER_TIME",
      "Waktu transfer tidak boleh di masa depan.",
      422,
    );
    const [source] = await tx
      .select()
      .from(platformAccounts)
      .where(eq(platformAccounts.id, input.sourceAccountId));
    assert(source, "INVALID_ACCOUNT", "Pilih rekening platform sumber yang terdaftar.", 422);
    await claimUploads(tx, actor.id, "payout_proof", [input.proofPath]);
    await tx
      .update(payoutTasks)
      .set({
        status: "selesai",
        sourceAccountId: source.id,
        transferredAmount: input.transferredAmount,
        transferFee: input.transferFee,
        proofPath: input.proofPath,
        transferredAt: new Date(input.transferredAt),
        completedBy: actor.id,
        completedAt: now,
      })
      .where(eq(payoutTasks.id, id));
    // The platform pays transfer fees; the recipient's share is unchanged (A-3.8).
    await postEntries(
      tx,
      { rentalId: rental.id, paymentId: task.sourcePaymentId, payoutTaskId: task.id },
      [
        {
          account: task.recipientId === rental.ownerId ? "hutang_pemilik" : "hutang_penyewa",
          debit: task.amount,
        },
        { account: "biaya_transfer", debit: input.transferFee },
        { account: `kas:${source.id}`, credit: task.amount + input.transferFee },
      ],
      PAYOUT_KINDS[task.kind],
    );
    await audit(tx, actor, "payout_completed", id, {
      rentalId: rental.id,
      amount: task.amount,
      fee: input.transferFee,
      sourceAccountId: source.id,
    });
    const snapshot = task.accountSnapshot as Snapshot;
    await notify(
      tx,
      task.recipientId,
      "payout_completed",
      task.kind === "refund_penyewa" ? "Refund sudah ditransfer" : "Pencairan sudah ditransfer",
      `${rental.publicCode}: ${rupiah(task.amount)} ke ${snapshot.provider} a.n. ${snapshot.accountName}. Bukti ada di detail transaksi.`,
      `/transaksi/${rental.id}`,
    );
    const [open] = await tx
      .select({ id: payoutTasks.id })
      .from(payoutTasks)
      .where(and(eq(payoutTasks.rentalId, rental.id), ne(payoutTasks.status, "selesai")))
      .limit(1);
    let rentalStatus = rental.status;
    // The last proof closes the transaction (A-2.2).
    if (!open && rental.status === "PENCAIRAN_DIPROSES") {
      rentalStatus = (
        await transitionRental(tx, rental, "SELESAI", { type: "system" }, { payoutTaskId: id })
      ).status;
      await tx
        .update(users)
        .set({ completedCount: sql`${users.completedCount} + 1` })
        .where(inArray(users.id, [rental.ownerId, rental.renterId]));
      await tx
        .update(items)
        .set({ completedCount: sql`${items.completedCount} + 1` })
        .where(eq(items.id, rental.itemId));
    }
    return { id, status: "selesai", rentalStatus };
  });
}

const fromAccount = alias(platformAccounts, "from_account"),
  toAccount = alias(platformAccounts, "to_account");
const LEDGER_TOTALS = [
  "dana_ditahan",
  "hutang_pemilik",
  "hutang_penyewa",
  "pendapatan_komisi",
  "biaya_transfer",
] as const;
// Cash per platform account and the main ledger positions, for daily checks (A-3.9).
export async function cashOverview(db: Executor, actor: User) {
  requireAdmin(actor);
  const accounts = await db
    .select()
    .from(platformAccounts)
    .orderBy(desc(platformAccounts.active), asc(platformAccounts.provider));
  const balances = await ledgerBalances(db, [
    ...accounts.map((account) => `kas:${account.id}`),
    ...LEDGER_TOTALS,
  ]);
  const movements = await db
    .select({
      movement: cashMovements,
      fromProvider: fromAccount.provider,
      fromAccountNo: fromAccount.accountNo,
      toProvider: toAccount.provider,
      toAccountNo: toAccount.accountNo,
      createdByName: users.name,
    })
    .from(cashMovements)
    .innerJoin(fromAccount, eq(fromAccount.id, cashMovements.fromAccountId))
    .leftJoin(toAccount, eq(toAccount.id, cashMovements.toAccountId))
    .innerJoin(users, eq(users.id, cashMovements.createdBy))
    .orderBy(desc(cashMovements.createdAt), desc(cashMovements.id))
    .limit(50);
  // Liabilities and revenue are credit balances; show them as positive amounts.
  const credit = (account: string) => -(balances.get(account) ?? 0);
  return {
    accounts: accounts.map((account) => ({
      id: account.id,
      type: account.type,
      provider: account.provider,
      accountNo: account.accountNo,
      accountName: account.accountName,
      active: account.active,
      balance: balances.get(`kas:${account.id}`) ?? 0,
    })),
    totals: {
      held: credit("dana_ditahan"),
      ownerPayable: credit("hutang_pemilik"),
      renterPayable: credit("hutang_penyewa"),
      commission: credit("pendapatan_komisi"),
      transferFees: balances.get("biaya_transfer") ?? 0,
    },
    movements: await Promise.all(
      movements.map(async ({ movement: { proofPath, ...movement }, ...names }) => ({
        ...movement,
        ...names,
        proofUrl: await evidencePreview(proofPath),
      })),
    ),
  };
}
// Moving money between platform accounts, e.g. OVO → BCA before a payout (A-3.9).
export async function recordCashMovement(db: Database, actor: User, raw: unknown, key?: string) {
  requireAdmin(actor);
  const input = cashMovementInput.parse(raw);
  await inspectEvidence(actor.id, input.proofPath, "cash_proof");
  return mutation(db, actor.id, "cash-movement", key, input, async (tx) => {
    const accounts = await tx
      .select({ id: platformAccounts.id })
      .from(platformAccounts)
      .where(inArray(platformAccounts.id, [input.fromAccountId, input.toAccountId]));
    assert(
      accounts.length === 2,
      "INVALID_ACCOUNT",
      "Pilih rekening platform yang terdaftar.",
      422,
    );
    await claimUploads(tx, actor.id, "cash_proof", [input.proofPath]);
    const [movement] = await tx
      .insert(cashMovements)
      .values({
        type: "antar_rekening",
        fromAccountId: input.fromAccountId,
        toAccountId: input.toAccountId,
        amount: input.amount,
        fee: input.fee,
        proofPath: input.proofPath,
        note: input.note,
        createdBy: actor.id,
      })
      .returning();
    await postEntries(
      tx,
      { cashMovementId: movement.id },
      [
        { account: `kas:${input.toAccountId}`, debit: input.amount },
        { account: "biaya_transfer", debit: input.fee },
        { account: `kas:${input.fromAccountId}`, credit: input.amount + input.fee },
      ],
      "Pemindahan dana antar rekening platform",
    );
    await tx.insert(adminAuditLogs).values({
      adminId: actor.id,
      action: "cash_movement_recorded",
      targetType: "cash_movements",
      targetId: movement.id,
      meta: { amount: input.amount, fee: input.fee },
    });
    return { id: movement.id };
  });
}
