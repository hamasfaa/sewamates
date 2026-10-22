// Calendar days are WIB (UTC+7, no daylight saving); stored periods are [start, end) in UTC.
const WIB_OFFSET = 7 * 3600000,
  DAY = 86400000;
export type Period = { start: Date; end: Date };

export function wibDateKey(at: Date) {
  return new Date(at.getTime() + WIB_OFFSET).toISOString().slice(0, 10);
}
export function wibDayStart(key: string) {
  return new Date(Date.parse(`${key}T00:00:00.000Z`) - WIB_OFFSET);
}
export function addDays(key: string, days: number) {
  return new Date(Date.parse(`${key}T00:00:00.000Z`) + days * DAY).toISOString().slice(0, 10);
}
export function daysBetween(from: string, to: string) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY);
}
// Inclusive calendar dates [from, to] become [from 00:00 WIB, to + 1 day 00:00 WIB).
export function wibDayRange(from: string, to: string): Period {
  return { start: wibDayStart(from), end: wibDayStart(addDays(to, 1)) };
}
export function monthKey(at: Date) {
  return wibDateKey(at).slice(0, 7);
}
export function shiftMonth(month: string, delta: number) {
  const [year, value] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, value - 1 + delta, 1));
  return date.toISOString().slice(0, 7);
}
export function monthDays(month: string) {
  const days: string[] = [];
  for (let key = `${month}-01`; key.startsWith(month); key = addDays(key, 1)) days.push(key);
  return days;
}
export function monthRange(month: string): Period {
  const days = monthDays(month);
  return wibDayRange(days[0], days[days.length - 1]);
}
// Days of the month that touch any unavailable period.
export function blockedDays(periods: Period[], month: string) {
  return monthDays(month).filter((key) => {
    const day = wibDayRange(key, key);
    return periods.some((period) => period.start < day.end && day.start < period.end);
  });
}
// Converts a stored [start, end) period back to the inclusive WIB dates shown to owners.
export function periodDates(period: Period) {
  return { from: wibDateKey(period.start), to: wibDateKey(new Date(period.end.getTime() - 1)) };
}

export function rentalPeriod(start: Date, days: number, bufferHours: number) {
  const due = new Date(start.getTime() + days * DAY);
  return { due, period: { start, end: new Date(due.getTime() + bufferHours * 3600000) } };
}
export function withinPickupHours(at: Date, hours: import("./pickup-points").PickupHours) {
  const local = new Date(at.getTime() + WIB_OFFSET);
  const day = hours[(local.getUTCDay() + 6) % 7];
  const clock = local.toISOString().slice(11, 16);
  return Boolean(day && clock >= day.open && clock < day.close);
}
export function paymentReviewTarget(
  at: Date,
  rules: {
    admin_open_hour: number;
    admin_close_hour: number;
    payment_sla_hours: number;
    payment_next_day_hour: number;
  },
) {
  const local = new Date(at.getTime() + WIB_OFFSET),
    hour = local.getUTCHours();
  if (hour >= rules.admin_open_hour && hour < rules.admin_close_hour)
    return new Date(at.getTime() + rules.payment_sla_hours * 3600000);
  const date = wibDateKey(at);
  const next = hour >= rules.admin_close_hour ? addDays(date, 1) : date;
  return new Date(wibDayStart(next).getTime() + rules.payment_next_day_hour * 3600000);
}
