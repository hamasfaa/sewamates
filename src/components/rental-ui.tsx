"use client";
import { useEffect, useState } from "react";
import type { rentalDetail } from "@/src/services/rental-service";
import type { Wire } from "@/src/lib/live-api";
import { RENTAL_LABELS, type RentalStatus } from "@/src/domain/rental-state-machine";
import { cn, dateWib } from "@/src/lib/utils";
import { Button } from "./ui/button";
import { StatusChip } from "./ui/status-chip";

export type RentalDetail = Wire<Awaited<ReturnType<typeof rentalDetail>>>;
export function CopyButton({ value, label = "Salin" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      onClick={() =>
        void navigator.clipboard
          ?.writeText(value)
          .then(() => setCopied(true))
          .catch(() => setCopied(false))
      }
    >
      {copied ? "Tersalin" : label}
    </Button>
  );
}
// Chip tones from 03 §4; a rental past its due time reads "Terlambat".
const TONES: Record<RentalStatus, "neutral" | "warning" | "info" | "success" | "danger"> = {
  DIAJUKAN: "neutral",
  DISETUJUI: "warning",
  MENUNGGU_VERIFIKASI: "warning",
  DIBAYAR: "info",
  BERJALAN: "info",
  DIKEMBALIKAN: "info",
  SENGKETA: "danger",
  PENCAIRAN_DIPROSES: "success",
  SELESAI: "success",
  DITOLAK: "neutral",
  KADALUARSA: "neutral",
  DIBATALKAN: "neutral",
};
export function RentalStatusChip({ status, late }: { status: RentalStatus; late?: boolean }) {
  return (
    <StatusChip tone={late ? "danger" : TONES[status]}>
      {late ? "Terlambat" : RENTAL_LABELS[status]}
    </StatusChip>
  );
}
export function Countdown({ target, label }: { target: string; label: string }) {
  const [now, setNow] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const seconds = Math.max(0, Math.ceil((Date.parse(target) - now) / 1000));
  return (
    <p className="mt-3 text-sm text-muted-foreground">
      {label}:{" "}
      <strong className="tabular text-foreground">
        {now
          ? seconds
            ? `${Math.floor(seconds / 3600)}j ${Math.floor((seconds % 3600) / 60)}m ${seconds % 60}d`
            : "Waktu berakhir"
          : dateWib(target)}
      </strong>
    </p>
  );
}
const STEPS = ["Diajukan", "Pembayaran", "Serah terima", "Disewa", "Pengembalian", "Selesai"];
const STEP_OF: Partial<Record<RentalStatus, number>> = {
  DIAJUKAN: 0,
  DISETUJUI: 1,
  MENUNGGU_VERIFIKASI: 1,
  DIBAYAR: 2,
  BERJALAN: 3,
  DIKEMBALIKAN: 4,
  PENCAIRAN_DIPROSES: 5,
  SELESAI: 5,
};
// Six-step progress (03 §4). A dispute stays on the step it was opened from.
export function RentalStepper({
  status,
  before,
}: {
  status: RentalStatus;
  before: RentalStatus | null;
}) {
  const disputed = status === "SENGKETA",
    step = STEP_OF[disputed && before ? before : status];
  if (step === undefined) return null;
  const finished = status === "SELESAI";
  return (
    <div className="mt-5">
      <p className="text-sm font-bold sm:hidden" aria-hidden="true">
        Langkah {step + 1} dari {STEPS.length}: {STEPS[step]}
        {disputed && " · dalam mediasi"}
      </p>
      <ol className="mt-2 grid grid-cols-6 gap-1.5 sm:gap-2" aria-label="Progres transaksi">
        {STEPS.map((label, index) => {
          const state =
            index < step || finished
              ? "selesai"
              : index === step
                ? disputed
                  ? "dalam mediasi"
                  : "sedang berjalan"
                : "belum";
          return (
            <li key={label} className="min-w-0" aria-current={index === step ? "step" : undefined}>
              <span
                aria-hidden="true"
                className={cn(
                  "block h-1.5 rounded-full",
                  state === "selesai"
                    ? "bg-primary"
                    : state === "sedang berjalan"
                      ? "bg-accent"
                      : state === "dalam mediasi"
                        ? "bg-destructive"
                        : "bg-border",
                )}
              />
              <span
                className={cn(
                  "mt-2 hidden truncate text-xs sm:block",
                  index === step ? "font-bold text-foreground" : "text-muted-foreground",
                )}
              >
                {label}
              </span>
              <span className="sr-only">
                {label}: {state}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
const ACTIONS: Record<string, string> = {
  payment_submitted: "Bukti transfer dikirim",
  payment_verified: "Bukti transfer diperiksa admin",
  reschedule_requested: "Usulan jadwal ulang dikirim",
  rescheduled: "Jadwal serah terima dipindah",
  reschedule_rejected: "Usulan jadwal ulang ditolak",
  no_show_reported: "Laporan pihak tidak hadir",
  no_show_accepted: "Laporan tidak hadir diterapkan",
  check_ok: "Kondisi barang dinyatakan sesuai",
  dispute_evidence_added: "Bukti sengketa ditambahkan",
};
const ACTORS: Record<string, string> = { admin: "admin", system: "sistem" };
// Timeline from rental_events (F12): status changes plus actions within a status.
export function RentalTimeline({ data }: { data: RentalDetail }) {
  const r = data.rental;
  return (
    <ol className="mt-4 space-y-4">
      {data.history.map((event) => {
        const action = typeof event.meta.action === "string" ? ACTIONS[event.meta.action] : null;
        const by =
          event.actorType === "user"
            ? event.actorId === r.ownerId
              ? "pemilik"
              : event.actorId === r.renterId
                ? "penyewa"
                : "pengguna"
            : ACTORS[event.actorType];
        return (
          <li key={event.id} className="border-l-2 border-border pl-4 text-sm">
            <p className="font-bold">
              {action ??
                (event.fromStatus === event.toStatus ? "Pembaruan" : RENTAL_LABELS[event.toStatus])}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {dateWib(event.createdAt)}
              {by && ` · oleh ${by}`}
            </p>
            {typeof event.meta.reason === "string" && (
              <p className="mt-1 break-words">{event.meta.reason}</p>
            )}
            {typeof event.meta.lateFee === "number" && event.meta.lateFee > 0 && (
              <p className="mt-1">Denda telat dihitung otomatis.</p>
            )}
          </li>
        );
      })}
    </ol>
  );
}
