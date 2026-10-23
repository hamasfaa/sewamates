"use client";
import { useId, useState } from "react";
import { type Wire } from "@/src/lib/live-api";
import { api, useApi } from "@/src/lib/client-api";
import { acceptFor, uploadPrivateFile } from "@/src/lib/private-upload";
import type { cashOverview } from "@/src/services/payout-service";
import { dateWib, rupiah } from "@/src/lib/utils";
import { Card } from "./ui/card";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

type Overview = Wire<Awaited<ReturnType<typeof cashOverview>>>;
// Ledger cash per platform account and transfers between accounts (A-3.9, F25 cash part).
export function CashPanel() {
  const query = useApi<Overview>("/api/admin/cash");
  return (
    <>
      <h1 className="text-3xl">Kas platform</h1>
      <p className="mt-3 mb-6 text-sm text-muted-foreground">
        Saldo menurut ledger per rekening platform. Catat pemindahan dana antar rekening (mis. OVO →
        BCA) sebelum mencairkan dari rekening tujuan.
      </p>
      {query.error && (
        <p className="notice notice-error mb-4" role="alert">
          {query.error}
        </p>
      )}
      {!query.data && !query.error && (
        <div className="skeleton h-64" role="status" aria-label="Memuat kas platform" />
      )}
      {query.data && (
        <div className="min-w-0 space-y-5">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            {(
              [
                ["Dana ditahan", query.data.totals.held],
                ["Hutang ke pemilik", query.data.totals.ownerPayable],
                ["Hutang ke penyewa", query.data.totals.renterPayable],
                ["Pendapatan komisi", query.data.totals.commission],
                ["Biaya transfer", query.data.totals.transferFees],
              ] as [string, number][]
            ).map(([label, value]) => (
              <Card key={label} className="p-5">
                <p className="text-sm text-muted-foreground">{label}</p>
                <p className="tabular mt-2 text-xl font-extrabold">{rupiah(value)}</p>
              </Card>
            ))}
          </div>
          <Card className="min-w-0">
            <h2 className="text-xl">Saldo kas per rekening</h2>
            <ul className="mt-4 divide-y divide-border">
              {query.data.accounts.map((account) => (
                <li key={account.id} className="flex flex-wrap justify-between gap-3 py-3 text-sm">
                  <span className="min-w-0 break-words">
                    <strong>{account.provider}</strong> · {account.accountNo} ·{" "}
                    {account.accountName}
                    {!account.active && " (nonaktif)"}
                  </span>
                  <strong className={`tabular ${account.balance < 0 ? "text-destructive" : ""}`}>
                    {rupiah(account.balance)}
                  </strong>
                </li>
              ))}
            </ul>
          </Card>
          <MovementForm data={query.data} done={query.reload} />
          <Card className="min-w-0">
            <h2 className="text-xl">Riwayat pemindahan dana</h2>
            {query.data.movements.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">Belum ada pemindahan dana.</p>
            ) : (
              <ul className="mt-4 divide-y divide-border">
                {query.data.movements.map((movement) => (
                  <li key={movement.id} className="py-3 text-sm">
                    <p className="font-bold">
                      {movement.fromProvider} {movement.fromAccountNo} → {movement.toProvider}{" "}
                      {movement.toAccountNo}
                    </p>
                    <p className="mt-1">
                      {rupiah(movement.amount)} · biaya {rupiah(movement.fee)} ·{" "}
                      {dateWib(movement.createdAt)} · {movement.createdByName}
                    </p>
                    {movement.note && (
                      <p className="mt-1 break-words text-muted-foreground">{movement.note}</p>
                    )}
                    <a
                      className="mt-1 inline-flex min-h-11 items-center font-bold text-primary"
                      href={movement.proofUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Lihat bukti ↗
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}
    </>
  );
}
function MovementForm({ data, done }: { data: Overview; done: () => void }) {
  const id = useId(),
    [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [amount, setAmount] = useState(""),
    [fee, setFee] = useState("0"),
    [note, setNote] = useState(""),
    [file, setFile] = useState<File | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [saved, setSaved] = useState(false),
    [round, setRound] = useState(0);
  const name = (accountId: string) => {
    const account = data.accounts.find((item) => item.id === accountId);
    return account ? `${account.provider} ${account.accountNo}` : "";
  };
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setSaved(false);
    if (from === to) return setError("Rekening asal dan tujuan harus berbeda.");
    if (!file) return setError("Unggah bukti pemindahan dana.");
    if (
      !window.confirm(
        `Catat pemindahan ${rupiah(Number(amount))} dari ${name(from)} ke ${name(to)} dengan biaya ${rupiah(Number(fee))}?`,
      )
    )
      return;
    setBusy(true);
    try {
      const proofPath = await uploadPrivateFile(file, "cash_proof");
      await api("/api/admin/cash-movements", {
        method: "POST",
        body: JSON.stringify({
          fromAccountId: from,
          toAccountId: to,
          amount: Number(amount),
          fee: Number(fee),
          proofPath,
          ...(note.trim() ? { note: note.trim() } : {}),
        }),
      });
      setAmount("");
      setNote("");
      setFile(null);
      setRound((value) => value + 1);
      setSaved(true);
      done();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card className="min-w-0">
      <h2 className="text-xl">Catat pemindahan antar rekening</h2>
      <form className="form-stack mt-5" onSubmit={submit}>
        <div className="grid gap-4 sm:grid-cols-2">
          {(
            [
              ["from", "Dari rekening", from, setFrom],
              ["to", "Ke rekening", to, setTo],
            ] as const
          ).map(([key, label, value, set]) => (
            <div key={key}>
              <label className="field-label" htmlFor={`${id}-${key}`}>
                {label}
              </label>
              <select
                id={`${id}-${key}`}
                className="input"
                required
                value={value}
                onChange={(event) => set(event.target.value)}
              >
                <option value="">Pilih rekening</option>
                {data.accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.provider} · {account.accountNo} · {rupiah(account.balance)}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="field-label" htmlFor={`${id}-amount`}>
              Nominal (Rp)
            </label>
            <Input
              id={`${id}-amount`}
              type="number"
              inputMode="numeric"
              min={1}
              required
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
            />
          </div>
          <div>
            <label className="field-label" htmlFor={`${id}-fee`}>
              Biaya transfer (Rp)
            </label>
            <Input
              id={`${id}-fee`}
              type="number"
              inputMode="numeric"
              min={0}
              max={1000000}
              required
              value={fee}
              onChange={(event) => setFee(event.target.value)}
            />
          </div>
        </div>
        <div>
          <label className="field-label" htmlFor={`${id}-proof`}>
            Bukti pemindahan
          </label>
          <Input
            key={round}
            id={`${id}-proof`}
            type="file"
            required
            accept={acceptFor("cash_proof")}
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
        </div>
        <div>
          <label className="field-label" htmlFor={`${id}-note`}>
            Catatan (opsional)
          </label>
          <Input
            id={`${id}-note`}
            maxLength={500}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </div>
        {error && (
          <p className="notice notice-error" role="alert">
            {error}
          </p>
        )}
        {saved && (
          <p className="notice notice-success" role="status">
            Pemindahan dana tercatat di ledger.
          </p>
        )}
        <Button type="submit" disabled={busy || data.accounts.length < 2}>
          {busy ? "Menyimpan…" : "Catat pemindahan"}
        </Button>
      </form>
    </Card>
  );
}
