"use client";
import { useId, useState } from "react";
import { Lock } from "lucide-react";
import { useClock, useLiveApi, type Wire } from "@/src/lib/live-api";
import { api, useApi } from "@/src/lib/client-api";
import { acceptFor, uploadPrivateFile } from "@/src/lib/private-upload";
import type { payoutDetail, payoutQueue } from "@/src/services/payout-service";
import { dateWib, rupiah } from "@/src/lib/utils";
import { Card } from "./ui/card";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { StatusChip } from "./ui/status-chip";

type Queue = Wire<Awaited<ReturnType<typeof payoutQueue>>>;
type Detail = Wire<Awaited<ReturnType<typeof payoutDetail>>>;
const KINDS: Record<string, string> = {
  pencairan_pemilik: "Pencairan ke pemilik",
  refund_penyewa: "Refund ke penyewa",
  penyesuaian: "Penyesuaian",
};
function remaining(until: string | null, now: number) {
  if (!until || !now) return 0;
  return Math.max(0, Math.ceil((Date.parse(until) - now) / 60000));
}
function ClaimState({ row, actorId, now }: { row: Queue[number]; actorId: string; now: number }) {
  const minutes = remaining(row.claimedUntil, now);
  if (row.status === "selesai") return <StatusChip tone="success">Selesai</StatusChip>;
  if (row.status === "diklaim" && minutes > 0)
    return row.claimedBy === actorId ? (
      <StatusChip tone="info">Klaim kamu · {minutes} menit</StatusChip>
    ) : (
      <span className="inline-flex items-center gap-1 text-xs font-bold text-muted-foreground">
        <Lock size={14} aria-hidden="true" />
        Diklaim {row.claimerName} · {minutes} menit
      </span>
    );
  return <StatusChip tone="warning">Menunggu</StatusChip>;
}
// F23: claim (30 minutes), transfer, then record source account, fee, time and proof.
export function AdminPayouts({ actorId }: { actorId: string }) {
  const now = useClock(),
    [state, setState] = useState("open"),
    [sla, setSla] = useState("all"),
    [search, setSearch] = useState(""),
    [q, setQuery] = useState(""),
    [selected, setSelected] = useState("");
  const query = useLiveApi<Queue>(
    `/api/admin/payout-tasks?${new URLSearchParams({ state, sla, q })}`,
    5000,
  );
  return (
    <>
      <h1 className="text-3xl">Pencairan &amp; refund</h1>
      <p className="mt-3 mb-6 text-sm text-muted-foreground">
        Klaim tugas sebelum mentransfer. Klaim berlaku 30 menit dan mengunci tugas dari admin lain.
        Biaya transfer ditanggung platform.
      </p>
      {query.error && (
        <p className="notice notice-error mb-4" role="alert">
          {query.error}
        </p>
      )}
      <div className="min-w-0 space-y-5">
        <Card className="min-w-0">
          <form
            className="mb-5 grid gap-3 sm:grid-cols-[minmax(0,1fr)_170px_190px_auto]"
            onSubmit={(event) => {
              event.preventDefault();
              setQuery(search.trim());
            }}
          >
            <div className="min-w-0">
              <label className="field-label" htmlFor="payout-search">
                Cari tugas
              </label>
              <Input
                id="payout-search"
                type="search"
                placeholder="Kode transaksi atau nama penerima"
                maxLength={100}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
            <div>
              <label className="field-label" htmlFor="payout-state">
                Status
              </label>
              <select
                id="payout-state"
                className="input"
                value={state}
                onChange={(event) => setState(event.target.value)}
              >
                <option value="open">Belum selesai</option>
                <option value="done">Selesai</option>
              </select>
            </div>
            <div>
              <label className="field-label" htmlFor="payout-sla">
                Target
              </label>
              <select
                id="payout-sla"
                className="input"
                value={sla}
                onChange={(event) => setSla(event.target.value)}
              >
                <option value="all">Semua target</option>
                <option value="overdue">Lewat target</option>
                <option value="on_time">Dalam batas waktu</option>
              </select>
            </div>
            <Button type="submit" className="self-end">
              Cari
            </Button>
          </form>
          {!query.data && !query.error && (
            <div className="skeleton h-48" role="status" aria-label="Memuat antrean pencairan" />
          )}
          {query.data?.length === 0 && (
            <p className="py-10 text-center text-sm text-muted-foreground">
              {state === "open"
                ? "Tidak ada tugas pencairan yang menunggu."
                : "Belum ada tugas selesai."}
            </p>
          )}
          <div className={query.data?.length ? "hidden overflow-x-auto lg:block" : "hidden"}>
            <table className="w-full text-left text-sm" aria-label="Antrean pencairan">
              <thead className="border-b border-border text-xs text-muted-foreground">
                <tr>
                  {["Transaksi", "Penerima", "Jenis", "Nominal", "Target", "Status", "Aksi"].map(
                    (label) => (
                      <th key={label} scope="col" className="p-3 font-semibold">
                        {label}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {query.data?.map((row) => (
                  <tr key={row.id} className={selected === row.id ? "bg-secondary" : ""}>
                    <td className="p-3 font-bold">{row.publicCode}</td>
                    <td className="p-3 break-words [overflow-wrap:anywhere]">
                      {row.recipientName}
                      <p className="text-xs text-muted-foreground">{row.provider}</p>
                    </td>
                    <td className="p-3 text-xs">{KINDS[row.kind]}</td>
                    <td className="tabular p-3 font-semibold">{rupiah(row.amount)}</td>
                    <td className="p-3 text-xs">
                      <time dateTime={row.targetAt}>{dateWib(row.targetAt)}</time>
                      {row.status !== "selesai" && Date.parse(row.targetAt) < now && (
                        <p className="mt-1 font-bold text-destructive">Lewat target</p>
                      )}
                    </td>
                    <td className="p-3">
                      <ClaimState row={row} actorId={actorId} now={now} />
                    </td>
                    <td className="p-3">
                      <Button
                        size="sm"
                        variant="outline"
                        aria-label={`Buka ${row.publicCode} untuk ${row.recipientName}`}
                        onClick={() => setSelected(row.id)}
                      >
                        Buka
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="space-y-2 lg:hidden">
            {query.data?.map((row) => (
              <li key={row.id}>
                <button
                  className={`w-full rounded-xl border p-3 text-left ${selected === row.id ? "border-primary bg-secondary" : "border-transparent hover:bg-background"}`}
                  onClick={() => setSelected(row.id)}
                >
                  <p className="text-xs text-muted-foreground">
                    {row.publicCode} · {KINDS[row.kind]}
                  </p>
                  <p className="mt-1 font-bold">{rupiah(row.amount)}</p>
                  <p className="mt-1 text-sm break-words">{row.recipientName}</p>
                  <div className="mt-2">
                    <ClaimState row={row} actorId={actorId} now={now} />
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </Card>
        {selected ? (
          <PayoutReview
            key={selected}
            id={selected}
            actorId={actorId}
            changed={query.refresh}
            close={() => setSelected("")}
          />
        ) : (
          <Card className="flex min-h-48 items-center justify-center text-center">
            <p className="text-sm text-muted-foreground">
              Pilih tugas untuk melihat rekening tujuan.
            </p>
          </Card>
        )}
      </div>
    </>
  );
}
function PayoutReview({
  id,
  actorId,
  changed,
  close,
}: {
  id: string;
  actorId: string;
  changed: () => Promise<void>;
  close: () => void;
}) {
  const form = useId(),
    now = useClock(),
    query = useApi<Detail>(`/api/admin/payout-tasks/${id}`),
    [source, setSource] = useState(""),
    [amount, setAmount] = useState(""),
    [fee, setFee] = useState("0"),
    [time, setTime] = useState(""),
    [file, setFile] = useState<File | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function run(work: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await work();
      await changed();
      query.reload();
    } catch (error) {
      setError((error as Error).message);
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
        <div className="skeleton h-80" role="status" aria-label="Memuat tugas pencairan" />
      </Card>
    );
  const { task, account, rental } = query.data,
    mine =
      task.status === "diklaim" &&
      task.claimedBy === actorId &&
      remaining(task.claimedUntil, now) > 0,
    lockedByOther =
      task.status === "diklaim" &&
      task.claimedBy !== actorId &&
      remaining(task.claimedUntil, now) > 0;
  const chosen = query.data.platformAccounts.find((item) => item.id === source);
  async function complete(event: React.FormEvent) {
    event.preventDefault();
    const transferred = Number(amount),
      transferFee = Number(fee);
    if (transferred !== task.amount)
      return setError(`Nominal transfer harus ${rupiah(task.amount)}.`);
    if (!file) return setError("Unggah bukti transfer.");
    if (
      !window.confirm(
        `Selesaikan ${KINDS[task.kind].toLowerCase()} ${rental.publicCode}?\n${rupiah(task.amount)} ke ${account.provider} ${account.accountNo ?? ""} a.n. ${account.accountName}\nDari: ${chosen?.provider} ${chosen?.accountNo}\nBiaya transfer: ${rupiah(transferFee)}`,
      )
    )
      return;
    await run(async () => {
      const proofPath = await uploadPrivateFile(file, "payout_proof");
      await api(`/api/admin/payout-tasks/${id}/complete`, {
        method: "POST",
        body: JSON.stringify({
          sourceAccountId: source,
          transferredAmount: transferred,
          transferFee,
          transferredAt: new Date(`${time}+07:00`).toISOString(),
          proofPath,
        }),
      });
    });
  }
  return (
    <Card className="min-w-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm text-muted-foreground">{rental.publicCode}</p>
          <h2 className="mt-1 text-2xl break-words">{KINDS[task.kind]}</h2>
          <p className="mt-1 text-sm text-muted-foreground break-words">{rental.title}</p>
        </div>
        <Button size="sm" variant="ghost" onClick={close}>
          Tutup
        </Button>
      </div>
      <div className="mt-6 grid min-w-0 gap-5 lg:grid-cols-2">
        <section
          className="min-w-0 rounded-2xl border border-border p-5"
          aria-label="Rekening tujuan"
        >
          <p className="text-sm text-muted-foreground">Transfer ke</p>
          <p className="tabular mt-2 text-3xl font-extrabold">{rupiah(task.amount)}</p>
          <p className="mt-4 text-lg font-bold">{account.provider}</p>
          <p className="tabular mt-1 text-2xl font-extrabold break-all">
            {account.accountNo ?? "Nomor tidak dapat dibaca"}
          </p>
          <p className="mt-1 text-base break-words">a.n. {account.accountName}</p>
          <p className="mt-3 text-xs text-muted-foreground">
            Penerima: {query.data.recipientName}. Target selesai {dateWib(task.targetAt)}.
          </p>
        </section>
        <section className="min-w-0">
          {task.status === "selesai" ? (
            <div className="space-y-2 text-sm">
              <StatusChip tone="success">
                Selesai {task.completedAt && dateWib(task.completedAt)}
              </StatusChip>
              <p>Biaya transfer: {rupiah(task.transferFee ?? 0)}</p>
              {task.transferredAt && <p>Waktu transfer: {dateWib(task.transferredAt)}</p>}
              {query.data.proofUrl && (
                <a
                  className="font-bold text-primary"
                  href={query.data.proofUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Lihat bukti transfer ↗
                </a>
              )}
            </div>
          ) : query.data.self ? (
            <p className="notice">Minta admin lain memproses pencairan transaksi milikmu.</p>
          ) : lockedByOther ? (
            <p className="notice">
              Tugas sedang diklaim admin lain. Sisa klaim {remaining(task.claimedUntil, now)} menit.
            </p>
          ) : !mine ? (
            <>
              <p className="text-sm text-muted-foreground">
                Klaim tugas sebelum mentransfer agar admin lain tidak mentransfer dua kali.
              </p>
              <Button
                className="mt-4"
                disabled={busy}
                onClick={() =>
                  void run(() =>
                    api(`/api/admin/payout-tasks/${id}/claim`, { method: "POST", body: "{}" }),
                  )
                }
              >
                Klaim tugas
              </Button>
            </>
          ) : (
            <form className="form-stack" onSubmit={complete}>
              <p className="notice">
                Klaim kamu berlaku {remaining(task.claimedUntil, now)} menit lagi.
              </p>
              <div>
                <label className="field-label" htmlFor={`${form}-source`}>
                  Rekening platform sumber
                </label>
                <select
                  id={`${form}-source`}
                  className="input"
                  required
                  value={source}
                  onChange={(event) => setSource(event.target.value)}
                >
                  <option value="">Pilih rekening sumber</option>
                  {query.data.platformAccounts.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.provider} · {item.accountNo} · saldo ledger {rupiah(item.balance)}
                      {item.active ? "" : " (nonaktif)"}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="field-label" htmlFor={`${form}-amount`}>
                  Nominal ditransfer (Rp)
                </label>
                <Input
                  id={`${form}-amount`}
                  type="number"
                  inputMode="numeric"
                  min={1}
                  required
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                />
                <p className="help">Harus sama dengan nominal tugas.</p>
              </div>
              <div>
                <label className="field-label" htmlFor={`${form}-fee`}>
                  Biaya transfer (Rp)
                </label>
                <Input
                  id={`${form}-fee`}
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={1000000}
                  required
                  value={fee}
                  onChange={(event) => setFee(event.target.value)}
                />
              </div>
              <div>
                <label className="field-label" htmlFor={`${form}-time`}>
                  Waktu transfer (WIB)
                </label>
                <Input
                  id={`${form}-time`}
                  type="datetime-local"
                  required
                  value={time}
                  onChange={(event) => setTime(event.target.value)}
                />
              </div>
              <div>
                <label className="field-label" htmlFor={`${form}-proof`}>
                  Bukti transfer
                </label>
                <Input
                  id={`${form}-proof`}
                  type="file"
                  required
                  accept={acceptFor("payout_proof")}
                  onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="submit" disabled={busy}>
                  {busy ? "Menyimpan…" : "Selesaikan pencairan"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    void run(() =>
                      api(`/api/admin/payout-tasks/${id}/claim`, { method: "POST", body: "{}" }),
                    )
                  }
                >
                  Perpanjang klaim
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={busy}
                  onClick={() =>
                    void run(() =>
                      api(`/api/admin/payout-tasks/${id}/release`, { method: "POST", body: "{}" }),
                    )
                  }
                >
                  Lepas klaim
                </Button>
              </div>
            </form>
          )}
          {error && (
            <p className="notice notice-error mt-4" role="alert">
              {error}
            </p>
          )}
        </section>
      </div>
    </Card>
  );
}
