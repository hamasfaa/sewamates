"use client";
import { useState } from "react";
import { api, useApi } from "@/src/lib/client-api";
import { providers } from "@/src/lib/validation";
import { Card } from "./ui/card";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
type Account = {
  id?: string;
  type: "bank" | "ewallet";
  provider: string;
  accountNo: string;
  accountName: string;
  active: boolean;
};
const EMPTY: Account = {
  type: "bank",
  provider: "BCA",
  accountNo: "",
  accountName: "",
  active: true,
};
export function PlatformAccounts() {
  const query = useApi<(Account & { id: string })[]>("/api/admin/platform-accounts"),
    [form, setForm] = useState<Account>(EMPTY),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const { id, ...data } = form;
      await api(id ? `/api/admin/platform-accounts/${id}` : "/api/admin/platform-accounts", {
        method: id ? "PATCH" : "POST",
        body: JSON.stringify(data),
      });
      setForm(EMPTY);
      query.reload();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function remove(account: Account & { id: string }) {
    if (
      !window.confirm(
        `Hapus ${account.provider} ${account.accountNo}? Rekening yang sudah dipakai hanya dapat dinonaktifkan.`,
      )
    )
      return;
    setError("");
    try {
      await api(`/api/admin/platform-accounts/${account.id}`, { method: "DELETE" });
      query.reload();
    } catch (error) {
      setError((error as Error).message);
    }
  }
  return (
    <>
      <h1 className="text-3xl">Rekening platform</h1>
      <p className="mt-3 mb-6 text-sm text-muted-foreground">
        Rekening bank dan e-wallet tujuan pembayaran penyewa. Pastikan nomor dan nama sesuai
        rekening operasional platform.
      </p>
      <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card className="min-w-0">
          {query.error && (
            <p className="notice notice-error" role="alert">
              {query.error}
            </p>
          )}
          {!query.data && !query.error && (
            <div className="skeleton h-48" role="status" aria-label="Memuat rekening platform" />
          )}
          {query.data?.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Belum ada rekening. Tambahkan rekening pertama agar pemilik bisa menyetujui pengajuan.
            </p>
          )}
          <ul className="divide-y divide-border">
            {query.data?.map((a) => (
              <li key={a.id} className="py-4">
                <div className="flex flex-wrap justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="text-lg">{a.provider}</h2>
                    <p className="mt-1 font-bold break-all">{a.accountNo}</p>
                    <p className="mt-1 text-sm break-words">a.n. {a.accountName}</p>
                    <p className="mt-2 text-xs font-bold text-muted-foreground">
                      {a.active ? "Aktif" : "Nonaktif"}
                    </p>
                  </div>
                  <div className="flex gap-2 self-start">
                    <Button size="sm" variant="outline" onClick={() => setForm(a)}>
                      Ubah
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => void remove(a)}>
                      Hapus
                    </Button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </Card>
        <Card className="min-w-0">
          <h2 className="mb-5 text-xl">{form.id ? "Ubah rekening" : "Tambah rekening"}</h2>
          <form className="form-stack" onSubmit={save}>
            <div>
              <label className="field-label" htmlFor="platform-type">
                Jenis
              </label>
              <select
                id="platform-type"
                className="input"
                value={form.type}
                onChange={(e) => {
                  const type = e.target.value as Account["type"];
                  setForm({ ...form, type, provider: providers[type][0] });
                }}
              >
                <option value="bank">Bank</option>
                <option value="ewallet">E-wallet</option>
              </select>
            </div>
            <div>
              <label className="field-label" htmlFor="platform-provider">
                Penyedia
              </label>
              <select
                id="platform-provider"
                className="input"
                value={form.provider}
                onChange={(e) => setForm({ ...form, provider: e.target.value })}
              >
                {providers[form.type].map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="field-label" htmlFor="platform-number">
                Nomor rekening / e-wallet
              </label>
              <Input
                id="platform-number"
                required
                inputMode="numeric"
                pattern="[0-9]{8,20}"
                value={form.accountNo}
                onChange={(e) => setForm({ ...form, accountNo: e.target.value })}
              />
            </div>
            <div>
              <label className="field-label" htmlFor="platform-name">
                Nama pemilik rekening
              </label>
              <Input
                id="platform-name"
                required
                minLength={3}
                maxLength={100}
                value={form.accountName}
                onChange={(e) => setForm({ ...form, accountName: e.target.value })}
              />
            </div>
            <label className="flex items-center gap-3 text-sm">
              <input
                type="checkbox"
                className="size-5"
                checked={form.active}
                onChange={(e) => setForm({ ...form, active: e.target.checked })}
              />
              Aktif untuk menerima pembayaran
            </label>
            {error && (
              <p className="notice notice-error" role="alert">
                {error}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={busy}>
                {busy ? "Menyimpan…" : "Simpan rekening"}
              </Button>
              {form.id && (
                <Button type="button" variant="outline" onClick={() => setForm(EMPTY)}>
                  Batal
                </Button>
              )}
            </div>
          </form>
        </Card>
      </div>
    </>
  );
}
