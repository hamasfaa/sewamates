"use client";
import { useState } from "react";
import Image from "next/image";
import { CircleAlert, CircleCheck, Clock3, Inbox, PackageSearch, RotateCcw } from "lucide-react";
import { api, useApi } from "@/src/lib/client-api";
import type { moderationDetail } from "@/src/services/moderation-service";
import { cn, dateOnlyWib, dateWib, rupiah } from "@/src/lib/utils";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { ItemStatusChip, StatusChip, VerificationChip } from "./ui/status-chip";

type QueueRow = {
  id: string;
  title: string;
  submittedAt: string;
  ownerName: string;
  categoryName: string;
  reviewedBefore: boolean;
  overdue: boolean;
  thumbUrl: string | null;
  slaHours: number;
};
type Detail = Awaited<ReturnType<typeof moderationDetail>>;
const REASONS = [
  "Foto kurang jelas atau tidak memperlihatkan barang dengan utuh. Unggah foto terang dari beberapa sisi.",
  "Judul atau deskripsi belum sesuai dengan foto barang. Perbaiki agar penyewa tidak salah paham.",
  "Barang termasuk kategori yang tidak diizinkan di SewaMates.",
  "Nilai barang, harga, atau deposit belum wajar. Sesuaikan dengan kondisi barang.",
];
export function ModerationQueue() {
  const query = useApi<QueueRow[]>("/api/admin/items/pending"),
    [selected, setSelected] = useState("");
  return (
    <>
      <h1 className="text-3xl">Moderasi listing</h1>
      <p className="mt-3 mb-7 text-sm text-muted-foreground">
        Urut terlama. Listing baru dan listing yang diubah judul, foto, atau kategorinya masuk ke
        sini sebelum tampil di pencarian.
      </p>
      {query.error && (
        <p className="notice notice-error mb-5" role="alert">
          {query.error}
        </p>
      )}
      <div className="grid gap-5 xl:grid-cols-[300px_minmax(0,1fr)]">
        <Card className="p-3">
          {query.loading && (
            <div className="skeleton h-40" role="status" aria-label="Memuat antrean" />
          )}
          {query.data?.length === 0 && (
            <div className="px-4 py-10 text-center">
              <Inbox size={30} className="mx-auto mb-4 text-primary" />
              <h2 className="text-base">Antrean sudah beres</h2>
              <p className="mt-2 text-xs text-muted-foreground">
                Listing baru akan muncul di sini.
              </p>
            </div>
          )}
          <ul className="space-y-2">
            {query.data?.map((entry) => (
              <li key={entry.id}>
                <button
                  className={cn(
                    "flex w-full gap-3 rounded-xl border p-3 text-left",
                    entry.id === selected
                      ? "border-primary bg-secondary"
                      : "border-transparent hover:bg-background",
                  )}
                  onClick={() => setSelected(entry.id)}
                >
                  <span className="relative aspect-[4/3] w-16 shrink-0 overflow-hidden rounded-lg bg-muted">
                    {entry.thumbUrl && (
                      <Image
                        unoptimized
                        fill
                        sizes="64px"
                        src={entry.thumbUrl}
                        alt=""
                        className="object-cover"
                      />
                    )}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-bold">{entry.title}</span>
                    <span className="mt-1 block truncate text-xs text-muted-foreground">
                      {entry.ownerName} · {entry.categoryName}
                    </span>
                    <span className="mt-1 block text-xs text-muted-foreground">
                      {dateWib(entry.submittedAt)}
                    </span>
                    <span className="mt-1 flex flex-wrap gap-x-2 text-xs">
                      {entry.overdue && (
                        <span className="inline-flex items-center gap-1 text-destructive">
                          <CircleAlert size={13} />
                          Lewat {entry.slaHours} jam
                        </span>
                      )}
                      {entry.reviewedBefore && (
                        <span className="inline-flex items-center gap-1 text-primary">
                          <RotateCcw size={13} />
                          Ditinjau ulang
                        </span>
                      )}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Card>
        {selected ? (
          <ModerationDecision
            key={selected}
            id={selected}
            complete={() => {
              setSelected("");
              query.reload();
            }}
          />
        ) : (
          <Card className="flex min-h-70 flex-col items-center justify-center text-center">
            <PackageSearch size={40} className="mb-4 text-primary" />
            <h2 className="text-lg">Pilih listing untuk ditinjau</h2>
            <p className="mt-3 max-w-sm text-sm text-muted-foreground">
              Bandingkan foto dengan judul, kategori, deskripsi, dan kewajaran nilai barang.
            </p>
          </Card>
        )}
      </div>
    </>
  );
}
function ModerationDecision({ id, complete }: { id: string; complete: () => void }) {
  const query = useApi<Detail>(`/api/admin/items/${id}`),
    [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function decide(decision: "disetujui" | "ditolak") {
    const data = query.data;
    if (!data) return;
    if (
      !window.confirm(
        decision === "disetujui"
          ? `Setujui “${data.title}”? Listing langsung tampil di pencarian.`
          : `Tolak “${data.title}”?\nAlasan: ${reason}`,
      )
    )
      return;
    setBusy(true);
    setError("");
    try {
      await api(`/api/admin/items/${id}/decision`, {
        method: "POST",
        body: JSON.stringify({
          decision,
          version: data.version,
          ...(decision === "ditolak" ? { reason } : {}),
        }),
      });
      complete();
    } catch (e) {
      setError((e as Error).message);
      query.reload();
    } finally {
      setBusy(false);
    }
  }
  if (query.error)
    return (
      <Card>
        <p className="notice notice-error" role="alert">
          {query.error}
        </p>
      </Card>
    );
  if (!query.data)
    return (
      <Card>
        <div className="skeleton h-80" role="status" aria-label="Memuat listing" />
      </Card>
    );
  const data = query.data;
  const facts: [string, React.ReactNode][] = [
    ["Kategori", `${data.category.name}${data.category.active ? "" : " (nonaktif)"}`],
    ["Kampus", data.campusName],
    ["Nilai barang", rupiah(data.itemValue)],
    ["Harga per hari", rupiah(data.pricePerDay)],
    [
      "Deposit",
      <span key="deposit" className="block">
        <span className="flex flex-wrap items-center gap-2">
          {rupiah(data.deposit)}
          <StatusChip tone={data.depositValid ? "success" : "danger"}>
            {data.depositValid ? "Sesuai rentang" : "Di luar rentang"}
          </StatusChip>
        </span>
        <span className="mt-1 block text-xs font-normal text-muted-foreground">
          Rentang {rupiah(data.depositRange.min)} – {rupiah(data.depositRange.max)}
        </span>
      </span>,
    ],
    ["Durasi", `${data.minDays}–${data.maxDays} hari`],
    ["Dikirim", dateWib(data.submittedAt)],
  ];
  return (
    <Card className="min-w-0">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-xl break-words">{data.title}</h2>
          <p className="mt-1 text-sm text-muted-foreground">Versi {data.version}</p>
        </div>
        <ItemStatusChip status={data.status} />
      </div>
      {data.owner.isSelf && (
        <p className="notice notice-error mb-5" role="alert">
          Ini listing milikmu. Minta admin lain meninjaunya.
        </p>
      )}
      <div className="grid gap-5 lg:grid-cols-2">
        <section aria-label="Foto listing">
          <div className="grid grid-cols-2 gap-2">
            {data.photos.map((photo, index) => (
              <a
                key={index}
                href={photo.url || undefined}
                target="_blank"
                rel="noreferrer"
                className="relative aspect-[4/3] overflow-hidden rounded-xl bg-muted"
              >
                {photo.url && (
                  <Image
                    unoptimized
                    fill
                    sizes="320px"
                    src={photo.url}
                    alt={`Foto ${index + 1} ${data.title}`}
                    className="object-contain"
                  />
                )}
              </a>
            ))}
          </div>
          <h3 className="mt-5 mb-2 text-sm">Deskripsi kondisi</h3>
          <p className="text-sm leading-6 whitespace-pre-line text-muted-foreground">
            {data.description}
          </p>
        </section>
        <section aria-label="Data pembanding" className="min-w-0">
          <dl className="divide-y divide-border rounded-xl border border-border text-sm">
            {facts.map(([label, value]) => (
              <div key={label} className="grid grid-cols-[120px_minmax(0,1fr)] gap-3 px-4 py-2.5">
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="tabular min-w-0 font-semibold break-words">{value}</dd>
              </div>
            ))}
          </dl>
          <h3 className="mt-5 mb-2 text-sm">Titik serah terima</h3>
          <ul className="space-y-2 text-sm">
            {data.pickupPoints.map((point) => (
              <li key={point.name} className="rounded-xl bg-background px-3 py-2">
                <span className="font-semibold">{point.name}</span>
                {!point.active && <span className="ml-2 text-xs text-destructive">nonaktif</span>}
                <span className="block text-xs text-muted-foreground">
                  {point.hoursSummary.join(" · ")}
                </span>
              </li>
            ))}
          </ul>
          <h3 className="mt-5 mb-2 text-sm">Pemilik</h3>
          <div className="rounded-xl bg-background p-3 text-sm">
            <p className="font-semibold">{data.owner.name}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <VerificationChip status={data.owner.verificationStatus} />
              {data.owner.accountStatus !== "aktif" && (
                <StatusChip tone="danger">Akun {data.owner.accountStatus}</StatusChip>
              )}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Bergabung {dateOnlyWib(data.owner.createdAt)}
            </p>
          </div>
          {data.history.length > 0 && (
            <>
              <h3 className="mt-5 mb-2 text-sm">Riwayat moderasi</h3>
              <ol className="space-y-2 text-xs">
                {data.history.map((entry, index) => (
                  <li key={index} className="flex items-start gap-2">
                    {entry.action === "item_disetujui" ? (
                      <CircleCheck
                        size={14}
                        className="mt-0.5 shrink-0 text-[var(--color-success)]"
                      />
                    ) : (
                      <Clock3 size={14} className="mt-0.5 shrink-0 text-destructive" />
                    )}
                    <span>
                      <strong>{entry.action === "item_disetujui" ? "Disetujui" : "Ditolak"}</strong>{" "}
                      oleh {entry.adminName} · {dateWib(entry.createdAt)}
                      {entry.reason && (
                        <span className="block text-muted-foreground">{entry.reason}</span>
                      )}
                    </span>
                  </li>
                ))}
              </ol>
            </>
          )}
        </section>
      </div>
      {data.status === "menunggu_review" && !data.owner.isSelf && (
        <div className="mt-6 border-t border-border pt-5">
          <label className="field-label" htmlFor="itemReason">
            Alasan jika ditolak
          </label>
          <select
            id="itemReason"
            className="input mb-3"
            value={REASONS.includes(reason) ? reason : ""}
            onChange={(event) => setReason(event.target.value)}
          >
            <option value="">Pilih alasan…</option>
            {REASONS.map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
          <textarea
            aria-label="Alasan penolakan"
            className="input min-h-24"
            maxLength={1000}
            placeholder="Tambahkan alasan yang membantu pemilik memperbaiki listing"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
          {error && (
            <p className="notice notice-error mt-4" role="alert">
              {error}
            </p>
          )}
          <div className="mt-5 flex flex-wrap gap-3">
            <Button disabled={busy} onClick={() => void decide("disetujui")}>
              Setujui listing
            </Button>
            <Button
              variant="outline"
              className="text-destructive"
              disabled={busy || reason.trim().length < 5}
              onClick={() => void decide("ditolak")}
            >
              Tolak dengan alasan
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
