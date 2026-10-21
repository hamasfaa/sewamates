"use client";
import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, CalendarX2, LoaderCircle, Trash2 } from "lucide-react";
import { api, useApi } from "@/src/lib/client-api";
import { addDays, blockedDays, shiftMonth, wibDayRange } from "@/src/domain/availability";
import { dateOnlyWib } from "@/src/lib/utils";
import { MonthCalendar } from "./month-calendar";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { Input } from "./ui/input";

type Block = { id: string; from: string; to: string; reason: string | null };
type Data = { item: { id: string; title: string; status: string }; blocks: Block[] };
// Owner tool for F4 "kalender blok": dates in WIB, stored as [from, to + 1 day).
export function BlockManager({ itemId, today }: { itemId: string; today: string }) {
  const query = useApi<Data>(`/api/items/${itemId}/blocks`),
    first = today.slice(0, 7),
    [month, setMonth] = useState(first),
    [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [reason, setReason] = useState(""),
    [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [saved, setSaved] = useState("");
  const blocks = query.data?.blocks ?? [];
  const unavailable = blockedDays(
    blocks.map((block) => wibDayRange(block.from, block.to)),
    month,
  );
  const archived = query.data?.item.status === "diarsipkan";
  async function add(event: React.FormEvent) {
    event.preventDefault();
    setBusy("add");
    setError("");
    setSaved("");
    try {
      await api(`/api/items/${itemId}/blocks`, {
        method: "POST",
        body: JSON.stringify({ from, to: to || from, ...(reason.trim() ? { reason } : {}) }),
      });
      setSaved(
        `Tanggal ${dateOnlyWib(from)}${to && to !== from ? ` – ${dateOnlyWib(to)}` : ""} diblokir.`,
      );
      setMonth(from.slice(0, 7));
      setFrom("");
      setTo("");
      setReason("");
      query.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  async function remove(block: Block) {
    if (!window.confirm(`Buka lagi tanggal ${dateOnlyWib(block.from)} – ${dateOnlyWib(block.to)}?`))
      return;
    setBusy(block.id);
    setError("");
    setSaved("");
    try {
      await api(`/api/items/${itemId}/blocks/${block.id}`, { method: "DELETE" });
      query.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  return (
    <div className="page-container max-w-5xl py-6 lg:py-10">
      <Link
        href="/profil/listing"
        className="mb-4 inline-flex min-h-11 items-center gap-1.5 text-sm font-bold text-primary"
      >
        <ArrowLeft size={16} />
        Listing saya
      </Link>
      <h1 className="text-2xl sm:text-3xl">Kalender blokir</h1>
      <p className="mt-2 mb-6 text-sm text-muted-foreground">
        {query.data?.item.title || "Memuat listing…"} · Blokir tanggal saat barang dipakai sendiri
        atau sedang tidak bisa disewakan.
      </p>
      {query.error && (
        <p className="notice notice-error" role="alert">
          {query.error}
        </p>
      )}
      {query.loading && (
        <div className="skeleton h-80" role="status" aria-label="Memuat kalender" />
      )}
      {query.data && (
        <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
          <Card className="min-w-0 p-4 sm:p-6">
            <MonthCalendar
              month={month}
              today={today}
              unavailable={unavailable}
              canPrev={month > first}
              canNext={month < shiftMonth(first, 12)}
              onPrev={() => setMonth(shiftMonth(month, -1))}
              onNext={() => setMonth(shiftMonth(month, 1))}
            />
          </Card>
          <div className="min-w-0 space-y-5">
            <Card className="p-4 sm:p-6">
              <h2 className="text-lg">Blokir tanggal</h2>
              {archived ? (
                <p className="notice mt-4">Listing yang diarsipkan tidak bisa diatur lagi.</p>
              ) : (
                <form className="form-stack mt-4" onSubmit={add}>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="min-w-0">
                      <label className="field-label" htmlFor="block-from">
                        Mulai
                      </label>
                      <Input
                        id="block-from"
                        type="date"
                        required
                        min={today}
                        max={addDays(today, 365)}
                        value={from}
                        onChange={(event) => setFrom(event.target.value)}
                      />
                    </div>
                    <div className="min-w-0">
                      <label className="field-label" htmlFor="block-to">
                        Sampai
                      </label>
                      <Input
                        id="block-to"
                        type="date"
                        min={from || today}
                        max={addDays(today, 365)}
                        value={to}
                        onChange={(event) => setTo(event.target.value)}
                      />
                    </div>
                  </div>
                  <div>
                    <label className="field-label" htmlFor="block-reason">
                      Catatan (opsional)
                    </label>
                    <Input
                      id="block-reason"
                      maxLength={200}
                      placeholder="Contoh: dipakai sendiri untuk KKN"
                      value={reason}
                      onChange={(event) => setReason(event.target.value)}
                    />
                    <p className="help">Catatan hanya terlihat olehmu.</p>
                  </div>
                  {error && (
                    <p className="notice notice-error" role="alert">
                      {error}
                    </p>
                  )}
                  {saved && (
                    <p className="notice notice-success" role="status">
                      {saved}
                    </p>
                  )}
                  <Button type="submit" disabled={busy === "add" || !from}>
                    {busy === "add" && <LoaderCircle size={16} className="animate-spin" />}
                    Blokir tanggal
                  </Button>
                </form>
              )}
            </Card>
            <Card className="p-4 sm:p-6">
              <h2 className="text-lg">Blokir mendatang</h2>
              {blocks.length ? (
                <ul className="mt-3 divide-y divide-border">
                  {blocks.map((block) => (
                    <li key={block.id} className="flex items-center gap-3 py-3">
                      <CalendarX2 size={20} className="shrink-0 text-destructive" aria-hidden />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-bold">
                          {dateOnlyWib(block.from)}
                          {block.to !== block.from && ` – ${dateOnlyWib(block.to)}`}
                        </p>
                        {block.reason && (
                          <p className="truncate text-xs text-muted-foreground">{block.reason}</p>
                        )}
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-destructive"
                        aria-label={`Hapus blokir ${dateOnlyWib(block.from)}`}
                        disabled={Boolean(busy)}
                        onClick={() => void remove(block)}
                      >
                        <Trash2 size={17} />
                      </Button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-3 text-sm text-muted-foreground">
                  Belum ada tanggal yang diblokir.
                </p>
              )}
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
