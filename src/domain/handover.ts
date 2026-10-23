// Handover, return and no-show timing (A-3.5, F10, F11).
import type { RentalStatus } from "./rental-state-machine";

const MINUTE = 60000;
export const HANDOVER_RULES = {
  codeLength: 6,
  maxAttempts: 5,
  lockMinutes: 15,
  minPhotos: 2,
  maxPhotos: 8,
  // Parties may check in shortly before the schedule; returns may happen early at any time.
  earlyMinutes: 60,
  // A new schedule must leave time to travel to the pickup point.
  rescheduleLeadMinutes: 60,
} as const;
export type Phase = "start" | "end";
export type Party = "owner" | "renter";
export const RESCHEDULE_STATUSES: RentalStatus[] = ["DISETUJUI", "MENUNGGU_VERIFIKASI", "DIBAYAR"];

export function phaseOf(status: RentalStatus): Phase | null {
  return status === "DIBAYAR" ? "start" : status === "BERJALAN" ? "end" : null;
}
export function scheduleOf(rental: { startAt: Date; dueAt: Date }, phase: Phase) {
  return phase === "start" ? rental.startAt : rental.dueAt;
}
// The renter photographs and shows the code at the start, the owner does both at the return.
export const photographer = (phase: Phase): Party => (phase === "start" ? "renter" : "owner");
export const codeReceiver = (phase: Phase): Party => (phase === "start" ? "owner" : "renter");
export const otherParty = (party: Party): Party => (party === "owner" ? "renter" : "owner");

export function checkInOpen(phase: Phase, scheduled: Date, now: Date) {
  return (
    phase === "end" || now.getTime() >= scheduled.getTime() - HANDOVER_RULES.earlyMinutes * MINUTE
  );
}
export function noShowOpensAt(scheduled: Date, rules: { no_show_wait_minutes: number }) {
  return new Date(scheduled.getTime() + rules.no_show_wait_minutes * MINUTE);
}
export function codeLocked(record: { codeLockedUntil: Date | null }, now: Date) {
  return Boolean(record.codeLockedUntil && record.codeLockedUntil > now);
}
// Five wrong codes lock entry for 15 minutes; the counter starts again after the lock.
export function failedCodeAttempt(attempts: number, now: Date) {
  const next = attempts + 1;
  return next >= HANDOVER_RULES.maxAttempts
    ? {
        codeFailedAttempts: 0,
        codeLockedUntil: new Date(now.getTime() + HANDOVER_RULES.lockMinutes * MINUTE),
      }
    : { codeFailedAttempts: next, codeLockedUntil: null };
}
