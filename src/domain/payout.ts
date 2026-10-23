// Settlement of held funds (A-3.6, A-3.8, A-3.9). Money is integer rupiah, rates are basis points.
import { addDays, wibDateKey, wibDayStart } from "./availability";
import { commission } from "./pricing";

const HOUR = 3600000,
  DAY = 24 * HOUR;
export type Split = { owner: number; renter: number; commission: number };
export const SETTLEMENT_REASONS = ["normal", "refund_penuh", "biaya_batal", "putusan"] as const;
export type SettlementReason = (typeof SETTLEMENT_REASONS)[number];
export type Settlement = Split & {
  reason: SettlementReason;
  received: number;
  lateFee: number;
  cancellationFee: number;
};
type Money = { rentTotal: number; deposit: number; pricePerDay: number; commissionRateBp: number };

// ceil((returned − due − grace) / 24 h) × rate × price per day, capped at the deposit
// (the unique code is not part of the cap).
export function lateFee(
  rental: Pick<Money, "deposit" | "pricePerDay"> & { dueAt: Date },
  returnedAt: Date,
  rules: { late_grace_hours: number; late_rate_bp: number },
) {
  const over = returnedAt.getTime() - rental.dueAt.getTime() - rules.late_grace_hours * HOUR;
  if (over <= 0) return 0;
  const periods = Math.ceil(over / DAY);
  return Math.min(
    rental.deposit,
    Math.floor((periods * rental.pricePerDay * rules.late_rate_bp + 5000) / 10000),
  );
}
export function cancellationFee(rentTotal: number, rateBp: number) {
  return Math.floor((rentTotal * rateBp + 5000) / 10000);
}

// Without a dispute: owner = rent − commission + late fee, renter = everything else (A-3.8).
export function normalSplit(
  rental: Pick<Money, "rentTotal"> & { commissionAmount: number },
  received: number,
  fee: number,
): Split {
  return {
    owner: rental.rentTotal - rental.commissionAmount + fee,
    renter: received - rental.rentTotal - fee,
    commission: rental.commissionAmount,
  };
}
// The cancellation fee goes to the owner minus commission on that fee (A-3.6).
export function cancellationSplit(
  rental: Pick<Money, "rentTotal" | "commissionRateBp">,
  received: number,
  rateBp: number,
): Split & { fee: number } {
  const fee = cancellationFee(rental.rentTotal, rateBp),
    cut = commission(fee, rental.commissionRateBp);
  return { owner: fee - cut, renter: received - fee, commission: cut, fee };
}
export const fullRefund = (received: number): Split => ({
  owner: 0,
  renter: received,
  commission: 0,
});
// Owner + renter + commission = funds received, all non-negative (A-3.8).
export function splitIsValid(split: Split, received: number) {
  const parts = [split.owner, split.renter, split.commission];
  return (
    parts.every((part) => Number.isSafeInteger(part) && part >= 0) &&
    parts.reduce((sum, part) => sum + part, 0) === received
  );
}

export type CancelActor = "owner" | "renter";
// Consequences shown before confirming a cancellation (F11) and applied by the server.
export function cancellationTerms(
  status: string,
  actor: CancelActor,
  startAt: Date,
  now: Date,
  rules: { cancel_free_hours: number },
) {
  if (status !== "DIBAYAR") return { fee: false, strike: false };
  if (actor === "owner") return { fee: false, strike: true };
  return { fee: now.getTime() > startAt.getTime() - rules.cancel_free_hours * HOUR, strike: false };
}

// Tasks created before the cutoff are due the same evening, later ones by noon next day (A-3.9).
export function payoutTarget(
  at: Date,
  rules: { payout_cutoff_hour: number; payout_same_day_hour: number; payout_next_day_hour: number },
) {
  const hour = new Date(at.getTime() + 7 * HOUR).getUTCHours(),
    sameDay = hour < rules.payout_cutoff_hour,
    date = wibDateKey(at);
  return new Date(
    wibDayStart(sameDay ? date : addDays(date, 1)).getTime() +
      (sameDay ? rules.payout_same_day_hour : rules.payout_next_day_hour) * HOUR,
  );
}
