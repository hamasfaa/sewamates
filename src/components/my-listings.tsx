"use client";
import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import {
  Archive,
  CalendarDays,
  CircleAlert,
  Eye,
  Package,
  PackagePlus,
  Pause,
  Pencil,
  Play,
} from "lucide-react";
import { api, useApi } from "@/src/lib/client-api";
import type { myItems } from "@/src/services/item-service";
import { cn, dateOnlyWib, rupiah } from "@/src/lib/utils";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { ItemStatusChip } from "./ui/status-chip";

type Row = Awaited<ReturnType<typeof myItems>>[number];
const FILTERS = [
  ["semua", "Semua"],
  ["aktif", "Aktif"],
  ["menunggu_review", "Menunggu review"],
  ["dijeda", "Dijeda"],
  ["ditolak", "Ditolak"],
  ["diarsipkan", "Diarsipkan"],
] as const;
export function MyListings() {
  const query = useApi<Row[]>("/api/me/items"),
    [filter, setFilter] = useState("semua"),
    [busy, setBusy] = useState(""),
    [error, setError] = useState("");
  async function act(row: Row, action: "pause" | "resume" | "archive") {
    if (
      action === "archive" &&
      !window.confirm(
        `Arsipkan “${row.title}”?\nListing yang diarsipkan tidak tampil lagi dan tidak bisa diaktifkan atau diubah.`,
      )
    )
      return;
    setBusy(`${row.id}:${action}`);
    setError("");
    try {
      await api(`/api/items/${row.id}/${action}`, { method: "POST", body: "{}" });
      query.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  const rows = query.data?.filter((row) => filter === "semua" || row.status === filter) ?? [];
  return (
    <Card className="min-w-0 p-4 sm:p-6">
      <div className="mb-5 flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-2xl">Listing saya</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Pantau status review, jeda sementara, atau blokir tanggal saat barang dipakai sendiri.
          </p>
        </div>
        <Button asChild variant="accent" className="w-full sm:w-auto">
          <Link href="/sewakan">
            <PackagePlus size={17} />
            Pasang barang
          </Link>
        </Button>
      </div>
      {query.data && query.data.length > 0 && (
        <div
          className="mb-4 flex gap-2 overflow-x-auto pb-1"
          role="group"
          aria-label="Saring status"
        >
          {FILTERS.map(([value, label]) => {
            const count =
              value === "semua"
                ? query.data!.length
                : query.data!.filter((row) => row.status === value).length;
            return (
              <button
                key={value}
                type="button"
                aria-pressed={filter === value}
                onClick={() => setFilter(value)}
                className={cn(
                  "min-h-10 shrink-0 rounded-full px-4 text-xs font-bold",
                  filter === value
                    ? "bg-primary text-primary-foreground"
                    : "bg-secondary text-secondary-foreground hover:bg-border",
                )}
              >
                {label} ({count})
              </button>
            );
          })}
        </div>
      )}
      {(error || query.error) && (
        <p className="notice notice-error mb-4" role="alert">
          {error || query.error}
        </p>
      )}
      {query.loading && <div className="skeleton h-48" role="status" aria-label="Memuat listing" />}
      {query.data?.length === 0 && (
        <div className="py-12 text-center">
          <Package size={40} className="mx-auto mb-4 text-primary" />
          <h3 className="text-lg">Belum ada barang</h3>
          <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
            Sewakan barang pertamamu. Barang menganggur bisa jadi cerita baru buat teman kampus.
          </p>
          <Button asChild className="mt-5">
            <Link href="/sewakan">Sewakan barang pertamamu</Link>
          </Button>
        </div>
      )}
      <div className="divide-y divide-border">
        {rows.map((row) => {
          const archived = row.status === "diarsipkan";
          return (
            <article
              key={row.id}
              className="grid grid-cols-[88px_minmax(0,1fr)] gap-3 py-4 sm:grid-cols-[112px_minmax(0,1fr)_auto] sm:gap-4"
            >
              <Link
                href={`/barang/${row.id}`}
                className="relative aspect-[4/3] self-start overflow-hidden rounded-xl bg-muted"
                aria-label={`Lihat ${row.title}`}
              >
                {row.thumbUrl ? (
                  <Image
                    unoptimized
                    fill
                    sizes="112px"
                    src={row.thumbUrl}
                    alt=""
                    className="object-cover"
                  />
                ) : (
                  <span className="flex h-full items-center justify-center text-primary">
                    <Package size={24} aria-hidden />
                  </span>
                )}
              </Link>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <ItemStatusChip status={row.status} />
                  <span className="text-xs text-muted-foreground">{row.categoryName}</span>
                </div>
                <h3 className="mt-2 text-sm break-words sm:text-base">{row.title}</h3>
                <p className="tabular mt-1 text-sm font-extrabold">
                  {rupiah(row.pricePerDay)}
                  <span className="text-xs font-semibold text-muted-foreground">/hari</span>
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {row.publishedAt
                    ? `Tayang sejak ${dateOnlyWib(row.publishedAt)}`
                    : `Dikirim ${dateOnlyWib(row.submittedAt)}`}
                  {row.upcomingBlocks > 0 && ` · ${row.upcomingBlocks} blokir tanggal`}
                </p>
                {row.status === "ditolak" && row.rejectReason && (
                  <p className="notice notice-error mt-2 text-xs">
                    <strong>Alasan ditolak:</strong> {row.rejectReason}
                  </p>
                )}
                {!archived && (!row.categoryActive || row.activePoints === 0) && (
                  <p className="mt-2 flex items-start gap-1.5 text-xs text-[var(--color-warning)]">
                    <CircleAlert size={14} className="mt-0.5 shrink-0" aria-hidden />
                    {!row.categoryActive
                      ? "Kategori tidak tersedia lagi. Ubah kategori agar listing tampil."
                      : "Titik serah terima tidak aktif lagi. Pilih titik baru agar listing tampil."}
                  </p>
                )}
              </div>
              <div className="col-span-2 flex flex-wrap gap-2 sm:col-span-1 sm:w-36 sm:flex-col">
                <Button asChild variant="outline" size="sm" className="flex-1 sm:flex-none">
                  <Link href={`/barang/${row.id}`}>
                    <Eye size={15} />
                    Lihat
                  </Link>
                </Button>
                {!archived && (
                  <>
                    <Button asChild variant="outline" size="sm" className="flex-1 sm:flex-none">
                      <Link href={`/barang/${row.id}/ubah`}>
                        <Pencil size={15} />
                        Ubah
                      </Link>
                    </Button>
                    <Button asChild variant="outline" size="sm" className="flex-1 sm:flex-none">
                      <Link href={`/barang/${row.id}/kalender`}>
                        <CalendarDays size={15} />
                        Kalender
                      </Link>
                    </Button>
                  </>
                )}
                {row.status === "aktif" && (
                  <Button
                    variant="secondary"
                    size="sm"
                    className="flex-1 sm:flex-none"
                    disabled={Boolean(busy)}
                    onClick={() => void act(row, "pause")}
                  >
                    <Pause size={15} />
                    {busy === `${row.id}:pause` ? "Menjeda…" : "Jeda"}
                  </Button>
                )}
                {row.status === "dijeda" && (
                  <Button
                    variant="secondary"
                    size="sm"
                    className="flex-1 sm:flex-none"
                    disabled={Boolean(busy)}
                    onClick={() => void act(row, "resume")}
                  >
                    <Play size={15} />
                    {busy === `${row.id}:resume` ? "Mengaktifkan…" : "Aktifkan"}
                  </Button>
                )}
                {!archived && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="flex-1 text-destructive sm:flex-none"
                    disabled={Boolean(busy)}
                    onClick={() => void act(row, "archive")}
                  >
                    <Archive size={15} />
                    Arsipkan
                  </Button>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </Card>
  );
}
