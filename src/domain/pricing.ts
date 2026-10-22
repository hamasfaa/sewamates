// Money is integer rupiah and rates are basis points (10000 = 100%), see A-3.2 and A-3.8.
export type DepositRules = { deposit_min_bp: number; deposit_max_bp: number; deposit_cap: number };
export const DEPOSIT_STEP = 1000;

// min(10% × value, cap) ≤ deposit ≤ min(50% × value, cap), rounded inward to Rp1.000.
export function depositRange(itemValue: number, rules: DepositRules) {
  const bound = (bp: number) => Math.min(itemValue * bp, rules.deposit_cap * 10000);
  const unit = DEPOSIT_STEP * 10000;
  return {
    min: Math.max(Math.ceil(bound(rules.deposit_min_bp) / unit) * DEPOSIT_STEP, DEPOSIT_STEP),
    max: Math.floor(bound(rules.deposit_max_bp) / unit) * DEPOSIT_STEP,
  };
}
export function depositAllowed(deposit: number, itemValue: number, rules: DepositRules) {
  const range = depositRange(itemValue, rules);
  return deposit % DEPOSIT_STEP === 0 && deposit >= range.min && deposit <= range.max;
}
// Half-up rounding to the nearest rupiah.
export function commission(amount: number, rateBp: number) {
  return Math.floor((amount * rateBp + 5000) / 10000);
}
export function rentTotal(pricePerDay: number, days: number) {
  return pricePerDay * days;
}
// Owner estimate shown in the listing wizard (F4): price × minimum days − commission.
export function netEstimate(pricePerDay: number, days: number, rateBp: number) {
  const rent = rentTotal(pricePerDay, days);
  return rent - commission(rent, rateBp);
}

export function paymentTotals(rent: number, deposit: number, uniqueCode: number, received = 0) {
  const due = rent + deposit + uniqueCode;
  return {
    amountDue: due,
    remaining: Math.max(0, due - received),
    overpayment: Math.max(0, received - due),
    refundableDeposit: deposit + uniqueCode + Math.max(0, received - due),
  };
}
export function firstFreeCode(used: number[]) {
  const reserved = new Set(used);
  for (let code = 1; code <= 999; code++) if (!reserved.has(code)) return code;
  return null;
}
