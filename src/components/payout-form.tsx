"use client";
import { useEffect, useState } from "react";
import { Wallet, Send, ShieldCheck, Clock3 } from "lucide-react";
import { api, useApi } from "@/src/lib/client-api";
import { providers } from "@/src/lib/validation";
import type { ProfileData } from "./profile-form";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Card } from "./ui/card";
export function PayoutForm() {
  const profile = useApi<ProfileData>("/api/me");
  if (profile.error)
    return (
      <p className="notice notice-error" role="alert">
        {profile.error}
      </p>
    );
  if (!profile.data)
    return (
      <div className="skeleton h-80" role="status">
        <span className="sr-only">Memuat rekening…</span>
      </div>
    );
  return <PayoutFields profile={profile.data} reload={profile.reload} />;
}
function PayoutFields({ profile, reload }: { profile: ProfileData; reload: () => void }) {
  const [type, setType] = useState<"bank" | "ewallet">(profile.payout?.type || "bank"),
    [provider, setProvider] = useState(profile.payout?.provider || "Mandiri"),
    [number, setNumber] = useState(""),
    [name, setName] = useState(profile.payout?.accountName || profile.user.name),
    [confirmation, setConfirmation] = useState(profile.pendingConfirmation?.id || ""),
    [status, setStatus] = useState("menunggu"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    if (!confirmation || status !== "menunggu") return;
    let cancelled = false,
      timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const result = await api<{ status: string }>(`/api/me/confirmations/${confirmation}`);
        if (!cancelled) {
          setStatus(result.status);
          if (result.status === "dikonfirmasi") {
            setNumber("");
            reload();
          }
        }
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
      if (!cancelled) timer = setTimeout(poll, 2000);
    };
    timer = setTimeout(poll, 2000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [confirmation, status, reload]);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await api<{ id: string }>("/api/me/payout-account", {
        method: "PUT",
        body: JSON.stringify({ type, provider, accountNo: number, accountName: name }),
      });
      setStatus("menunggu");
      setConfirmation(result.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card>
      <div className="mb-6 flex items-start gap-3">
        <span className="rounded-2xl bg-secondary p-3 text-primary">
          <Wallet size={25} />
        </span>
        <div>
          <h2 className="text-2xl">Rekening pencairan</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Untuk menerima hasil sewa dan pengembalian deposit.
          </p>
        </div>
      </div>
      {profile.payout && (
        <div className="mb-6 rounded-xl bg-background p-4">
          <p className="text-xs text-muted-foreground">Rekening saat ini</p>
          <p className="mt-1 font-bold">
            {profile.payout.provider} · {profile.payout.maskedNumber}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">{profile.payout.accountName}</p>
        </div>
      )}
      {confirmation && (
        <p
          className={`notice mb-5 ${status === "dikonfirmasi" ? "notice-success" : ["ditolak", "kedaluwarsa"].includes(status) ? "notice-error" : ""}`}
          role="status"
        >
          {status === "menunggu" ? (
            <>
              <Clock3 size={17} className="mr-2 inline" />
              Konfirmasi di Telegram. Rekening baru berlaku setelah kamu menekan tombol Konfirmasi
              di bot.
            </>
          ) : status === "dikonfirmasi" ? (
            "Rekening berhasil diperbarui."
          ) : status === "ditolak" ? (
            "Perubahan rekening ditolak. Kamu bisa mengajukan perubahan lagi."
          ) : (
            "Konfirmasi kedaluwarsa. Kirim permintaan baru."
          )}
        </p>
      )}
      <form onSubmit={submit} className="form-stack">
        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <label className="field-label" htmlFor="payoutType">
              Jenis rekening
            </label>
            <select
              id="payoutType"
              className="input"
              value={type}
              onChange={(e) => {
                const next = e.target.value as "bank" | "ewallet";
                setType(next);
                setProvider(providers[next][0]);
              }}
            >
              <option value="bank">Bank</option>
              <option value="ewallet">E-wallet</option>
            </select>
          </div>
          <div>
            <label className="field-label" htmlFor="provider">
              Bank / penyedia
            </label>
            <select
              id="provider"
              className="input"
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
            >
              {providers[type].map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <label className="field-label" htmlFor="accountNo">
            Nomor rekening / e-wallet
          </label>
          <Input
            id="accountNo"
            inputMode="numeric"
            autoComplete="off"
            pattern="[0-9]{8,20}"
            minLength={8}
            maxLength={20}
            required
            value={number}
            onChange={(e) => setNumber(e.target.value.replace(/\D/g, ""))}
            placeholder="Masukkan nomor lengkap"
          />
        </div>
        <div>
          <label className="field-label" htmlFor="accountName">
            Nama pemilik rekening
          </label>
          <Input
            id="accountName"
            minLength={3}
            maxLength={100}
            autoComplete="name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        {error && (
          <p className="notice notice-error" role="alert">
            {error}
          </p>
        )}
        <Button disabled={busy} type="submit" className="self-start">
          <Send size={17} />
          {busy ? "Mengirim…" : "Konfirmasi lewat Telegram"}
        </Button>
        <p className="flex items-start gap-2 text-xs leading-5 text-muted-foreground">
          <ShieldCheck size={17} className="shrink-0 text-primary" />
          Nomor rekening disimpan terenkripsi. Penggantian rekening tidak mengubah pencairan yang
          sudah dibuat.
        </p>
      </form>
    </Card>
  );
}
