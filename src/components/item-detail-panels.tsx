"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { CalendarDays, MessageCircle, Minus, Pencil, Plus, ShieldCheck } from "lucide-react";
import { api } from "@/src/lib/client-api";
import { shiftMonth } from "@/src/domain/availability";
import { rupiah } from "@/src/lib/utils";
import { CostSummary } from "./cost-summary";
import { MonthCalendar } from "./month-calendar";
import { Button } from "./ui/button";
import { Card } from "./ui/card";

export type ViewerState = "owner" | "guest" | "unverified" | "verified";
// Rental requests and chat open in Sprint 3; until then the actions explain the next step.
function RentAction({ itemId, viewer }: { itemId: string; viewer: ViewerState }) {
  if (viewer === "owner")
    return (
      <div className="flex gap-2">
        <Button asChild className="flex-1">
          <Link href={`/barang/${itemId}/ubah`}>
            <Pencil size={16} />
            Ubah listing
          </Link>
        </Button>
        <Button asChild variant="outline" size="icon" aria-label="Atur kalender">
          <Link href={`/barang/${itemId}/kalender`}>
            <CalendarDays size={18} />
          </Link>
        </Button>
      </div>
    );
  return (
    <div className="flex gap-2">
      <Button
        variant="outline"
        size="icon"
        disabled
        aria-label="Chat pemilik (dibuka bersama pengajuan sewa)"
        title="Chat dibuka bersama pengajuan sewa"
      >
        <MessageCircle size={18} />
      </Button>
      {viewer === "guest" ? (
        <Button asChild className="flex-1">
          <Link href="/masuk">Masuk untuk menyewa</Link>
        </Button>
      ) : viewer === "unverified" ? (
        <Button asChild className="flex-1">
          <Link href="/profil/verifikasi">Verifikasi untuk menyewa</Link>
        </Button>
      ) : (
        <Button className="flex-1" disabled aria-describedby="rent-soon">
          Ajukan sewa
        </Button>
      )}
    </div>
  );
}
function actionNote(viewer: ViewerState) {
  if (viewer === "verified") return "Pengajuan sewa dan chat dibuka pada pembaruan berikutnya.";
  if (viewer === "unverified")
    return "Pengguna terverifikasi bisa mengajukan sewa dan chat pemilik.";
  return null;
}
export function RentCard({
  itemId,
  pricePerDay,
  deposit,
  minDays,
  maxDays,
  viewer,
}: {
  itemId: string;
  pricePerDay: number;
  deposit: number;
  minDays: number;
  maxDays: number;
  viewer: ViewerState;
}) {
  const [days, setDays] = useState(minDays),
    note = actionNote(viewer);
  return (
    <Card className="p-5">
      <p className="tabular text-2xl font-extrabold">
        {rupiah(pricePerDay)}
        <span className="text-sm font-semibold text-muted-foreground">/hari</span>
      </p>
      <p className="mt-1 text-sm text-muted-foreground">
        Deposit {rupiah(deposit)} · dikembalikan setelah barang kembali
      </p>
      <div className="mt-5">
        <p className="field-label" id="duration-label">
          Durasi sewa
        </p>
        <div className="flex items-center gap-3" role="group" aria-labelledby="duration-label">
          <Button
            variant="outline"
            size="icon"
            aria-label="Kurangi hari"
            disabled={days <= minDays}
            onClick={() => setDays(days - 1)}
          >
            <Minus size={18} />
          </Button>
          <output
            className="tabular min-w-20 text-center text-lg font-extrabold"
            aria-live="polite"
          >
            {days} hari
          </output>
          <Button
            variant="outline"
            size="icon"
            aria-label="Tambah hari"
            disabled={days >= maxDays}
            onClick={() => setDays(days + 1)}
          >
            <Plus size={18} />
          </Button>
        </div>
        <p className="help">
          Minimal {minDays} hari, maksimal {maxDays} hari.
        </p>
      </div>
      <CostSummary
        pricePerDay={pricePerDay}
        days={days}
        deposit={deposit}
        className="my-5 rounded-xl bg-[var(--color-accent-soft)] p-4"
      />
      <RentAction itemId={itemId} viewer={viewer} />
      {note && (
        <p id="rent-soon" className="mt-3 text-xs leading-5 text-muted-foreground">
          {note}
        </p>
      )}
      <p className="mt-4 flex items-start gap-2 rounded-xl bg-[var(--color-sky-soft)] p-3 text-xs leading-5 text-[var(--color-info)]">
        <ShieldCheck size={17} className="shrink-0" aria-hidden />
        Dana kamu aman, ditahan SewaMates sampai barang kembali.
      </p>
    </Card>
  );
}
// Mobile sticky bar above the bottom navigation (03 §3, detail barang).
export function MobileRentBar({
  itemId,
  pricePerDay,
  viewer,
}: {
  itemId: string;
  pricePerDay: number;
  viewer: ViewerState;
}) {
  return (
    <div className="fixed inset-x-0 bottom-[calc(65px+max(env(safe-area-inset-bottom),8px))] z-30 border-t border-border bg-card/95 px-4 py-3 backdrop-blur-md lg:hidden">
      <div className="mx-auto flex max-w-lg items-center gap-3">
        <p className="tabular shrink-0 text-base font-extrabold">
          {rupiah(pricePerDay)}
          <span className="block text-xs font-semibold text-muted-foreground">per hari</span>
        </p>
        <div className="min-w-0 flex-1">
          <RentAction itemId={itemId} viewer={viewer} />
        </div>
      </div>
    </div>
  );
}
export function AvailabilityCalendar({
  itemId,
  today,
  initialUnavailable,
}: {
  itemId: string;
  today: string;
  initialUnavailable: string[];
}) {
  const first = today.slice(0, 7),
    [month, setMonth] = useState(first),
    [cache, setCache] = useState<Record<string, string[]>>({ [first]: initialUnavailable }),
    [error, setError] = useState("");
  useEffect(() => {
    if (cache[month]) return;
    const controller = new AbortController();
    api<{ unavailable: string[] }>(`/api/items/${itemId}/availability?month=${month}`, {
      signal: controller.signal,
    })
      .then((result) => setCache((value) => ({ ...value, [month]: result.unavailable })))
      .catch((e: Error) => {
        if (e.name !== "AbortError") setError(e.message);
      });
    return () => controller.abort();
  }, [cache, itemId, month]);
  return (
    <>
      <MonthCalendar
        month={month}
        today={today}
        unavailable={cache[month] || []}
        busy={!cache[month]}
        canPrev={month > first}
        canNext={month < shiftMonth(first, 12)}
        onPrev={() => setMonth(shiftMonth(month, -1))}
        onNext={() => setMonth(shiftMonth(month, 1))}
      />
      {error && (
        <p className="notice notice-error mt-3" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
