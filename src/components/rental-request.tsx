"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, useApi } from "@/src/lib/client-api";
import type { Wire } from "@/src/lib/live-api";
import type { rentalOptions } from "@/src/services/rental-service";
import { dateWib } from "@/src/lib/utils";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Card } from "./ui/card";
import { CostSummary } from "./cost-summary";
type Options = Wire<Awaited<ReturnType<typeof rentalOptions>>>;
export function RentalRequest({ itemId }: { itemId: string }) {
  const query = useApi<Options>(`/api/items/${itemId}/rental-options`);
  if (query.error)
    return (
      <p className="notice notice-error page-container my-8" role="alert">
        {query.error}
      </p>
    );
  if (!query.data)
    return (
      <div className="page-container py-8">
        <div className="skeleton h-80" role="status" aria-label="Memuat pengajuan" />
      </div>
    );
  const { eligible } = query.data;
  const gate = !eligible.active
    ? "Akun sedang dibatasi."
    : eligible.isOwner
      ? "Kamu tidak dapat menyewa barang milikmu sendiri."
      : !eligible.verified
        ? "Verifikasi identitas dulu sebelum menyewa."
        : !eligible.payout
          ? "Isi dan konfirmasi rekening/e-wallet untuk pengembalian deposit."
          : null;
  if (gate)
    return (
      <div className="page-container max-w-2xl py-10">
        <Card>
          <h1 className="text-2xl">Siapkan akunmu dulu</h1>
          <p className="notice mt-5">{gate}</p>
          <Button asChild className="mt-5">
            <Link
              href={
                !eligible.verified
                  ? "/profil/verifikasi"
                  : !eligible.payout
                    ? "/profil/rekening"
                    : `/barang/${itemId}`
              }
            >
              {!eligible.verified
                ? "Verifikasi identitas"
                : !eligible.payout
                  ? "Isi rekening"
                  : "Kembali ke barang"}
            </Link>
          </Button>
        </Card>
      </div>
    );
  return <RequestForm data={query.data} />;
}
function RequestForm({ data }: { data: Options }) {
  const { item, rules } = data,
    router = useRouter(),
    [start, setStart] = useState(""),
    [days, setDays] = useState(item.minDays),
    [point, setPoint] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const schedule = start ? new Date(`${start}+07:00`) : null;
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await api<{ id: string }>("/api/rentals", {
        method: "POST",
        body: JSON.stringify({
          itemId: item.id,
          pickupPointId: point,
          startAt: schedule!.toISOString(),
          days,
          ...(message.trim() ? { message: message.trim() } : {}),
        }),
      });
      router.push(`/transaksi/${result.id}`);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="page-container py-7 lg:py-10">
      <Link className="text-sm font-bold text-primary" href={`/barang/${item.id}`}>
        ← Kembali ke barang
      </Link>
      <h1 className="mt-4 text-3xl">Ajukan sewa</h1>
      <p className="mt-2 text-muted-foreground">{item.title}</p>
      <div className="mt-6 grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Card className="min-w-0">
          <form className="form-stack" onSubmit={submit}>
            <div>
              <label className="field-label" htmlFor="rental-start">
                Mulai sewa (WIB)
              </label>
              <Input
                id="rental-start"
                type="datetime-local"
                required
                value={start}
                onChange={(e) => setStart(e.target.value)}
              />
              <p className="help">
                Minimal {rules.booking_lead_hours} jam dan maksimal {rules.booking_max_days} hari
                dari sekarang.
              </p>
            </div>
            <div>
              <label className="field-label" htmlFor="rental-days">
                Durasi (hari)
              </label>
              <Input
                id="rental-days"
                type="number"
                required
                min={item.minDays}
                max={item.maxDays}
                value={days}
                onChange={(e) => setDays(Number(e.target.value))}
              />
              <p className="help">
                {item.minDays}–{item.maxDays} hari. Satu hari = 24 jam.
              </p>
            </div>
            <div>
              <label className="field-label" htmlFor="rental-point">
                Titik serah terima
              </label>
              <select
                id="rental-point"
                className="input"
                required
                value={point}
                onChange={(e) => setPoint(e.target.value)}
              >
                <option value="">Pilih titik</option>
                {item.pickupPoints.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <p className="help">
                {item.pickupPoints.find((p) => p.id === point)?.hoursSummary.join(" · ")}
              </p>
            </div>
            <div>
              <label className="field-label" htmlFor="rental-message">
                Pesan untuk pemilik (opsional)
              </label>
              <textarea
                id="rental-message"
                className="input min-h-28"
                maxLength={1000}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
              />
            </div>
            {error && (
              <p className="notice notice-error" role="alert">
                {error}
              </p>
            )}
            <Button type="submit" disabled={busy}>
              {busy ? "Mengirim…" : "Kirim pengajuan"}
            </Button>
          </form>
        </Card>
        <Card className="min-w-0 lg:sticky lg:top-24 lg:self-start">
          <h2 className="mb-5 text-xl">Ringkasan biaya</h2>
          <CostSummary
            pricePerDay={item.pricePerDay}
            days={days || item.minDays}
            deposit={item.deposit}
          />
          {schedule && !Number.isNaN(schedule.getTime()) && (
            <p className="mt-4 text-sm">
              Jatuh tempo:{" "}
              <strong>{dateWib(new Date(schedule.getTime() + days * 86400000))}</strong>
            </p>
          )}
          <p className="notice mt-5">
            Bayar setelah pemilik menyetujui. Dana ditahan aman di SewaMates sampai barang kembali.
          </p>
        </Card>
      </div>
    </div>
  );
}
