import { randomUUID } from "node:crypto";
import { inArray, sql } from "drizzle-orm";
import type { Executor } from "@/src/db";
import { ledgerEntries } from "@/src/db/schema";
import { assert } from "@/src/lib/errors";

export type JournalLine = { account: string; debit?: number; credit?: number };
// One balanced journal (04 §4.4). Zero lines are skipped, e.g. a payout without a transfer fee.
export type JournalRef = {
  rentalId?: string | null;
  paymentId?: string | null;
  payoutTaskId?: string | null;
  cashMovementId?: string | null;
};
export async function postEntries(
  tx: Executor,
  ref: JournalRef,
  lines: JournalLine[],
  memo: string,
) {
  const entries = lines
    .map((line) => ({ account: line.account, debit: line.debit ?? 0, credit: line.credit ?? 0 }))
    .filter((line) => line.debit > 0 || line.credit > 0);
  const total = (side: "debit" | "credit") => entries.reduce((sum, line) => sum + line[side], 0);
  assert(
    entries.length >= 2 &&
      entries.every(
        (line) =>
          Number.isSafeInteger(line.debit) &&
          Number.isSafeInteger(line.credit) &&
          line.debit >= 0 &&
          line.credit >= 0 &&
          line.debit > 0 !== line.credit > 0,
      ) &&
      new Set(entries.map((line) => line.account)).size === entries.length &&
      total("debit") === total("credit"),
    "INVALID_JOURNAL",
    "Nominal jurnal tidak valid.",
    422,
  );
  const journalId = randomUUID();
  await tx.insert(ledgerEntries).values(
    entries.map((line) => ({
      journalId,
      rentalId: ref.rentalId ?? null,
      paymentId: ref.paymentId ?? null,
      payoutTaskId: ref.payoutTaskId ?? null,
      cashMovementId: ref.cashMovementId ?? null,
      memo,
      ...line,
    })),
  );
  return journalId;
}
// Debit-minus-credit per account; liabilities and revenue therefore read negative.
export async function ledgerBalances(db: Executor, accounts: string[]) {
  if (!accounts.length) return new Map<string, number>();
  const rows = await db
    .select({
      account: ledgerEntries.account,
      balance: sql<string>`sum(${ledgerEntries.debit} - ${ledgerEntries.credit})::text`,
    })
    .from(ledgerEntries)
    .where(inArray(ledgerEntries.account, accounts))
    .groupBy(ledgerEntries.account);
  return new Map(rows.map((row) => [row.account, Number(row.balance)]));
}
