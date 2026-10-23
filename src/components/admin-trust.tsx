"use client";
import { useId, useState } from "react";
import Link from "next/link";
import { api } from "@/src/lib/client-api";
import { useLiveApi, type Wire } from "@/src/lib/live-api";
import { acceptFor, uploadPrivateFile } from "@/src/lib/private-upload";
import type { adminUserDetail, adminUsers, reportQueue } from "@/src/services/trust-service";
import type { financialRecap, listReconciliations } from "@/src/services/admin-finance-service";
import type { cashOverview, payoutQueue } from "@/src/services/payout-service";
import { dateWib, rupiah } from "@/src/lib/utils";
import { RENTAL_LABELS } from "@/src/domain/rental-state-machine";
import { Card } from "./ui/card";
import { Button } from "./ui/button";

type Field = {
  name: string;
  label: string;
  type?: "number" | "text" | "textarea" | "date" | "datetime-local" | "file";
  options?: { value: string; label: string }[];
  optional?: boolean;
  value?: string;
};
export function AdminActionForm({
  url,
  fields,
  values = {},
  method = "POST",
  label = "Simpan",
  done,
}: {
  url: string;
  fields: Field[];
  values?: Record<string, unknown>;
  method?: string;
  label?: string;
  done?: () => unknown;
}) {
  const id = useId(),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  return (
    <form
      className="mt-4 min-w-0 space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const data = new FormData(form);
        setBusy(true);
        setMessage("");
        try {
          const body: Record<string, unknown> = { ...values };
          for (const f of fields) {
            const value = data.get(f.name);
            if (f.optional && !value) continue;
            if (f.type === "file") {
              if (value instanceof File && value.size)
                body[f.name] = await uploadPrivateFile(value, "cash_proof");
            } else if (f.type === "number") body[f.name] = Number(value);
            else if (f.type === "datetime-local")
              body[f.name] = new Date(`${value}:00+07:00`).toISOString();
            else body[f.name] = value;
          }
          await api(url, { method, body: JSON.stringify(body) });
          setMessage("Berhasil disimpan.");
          void done?.();
        } catch (e) {
          setMessage((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="grid min-w-0 gap-4 sm:grid-cols-2">
        {fields.map((f) => (
          <div key={f.name} className="min-w-0">
            <label className="field-label" htmlFor={`${id}-${f.name}`}>
              {f.label}
            </label>
            {f.options ? (
              <select
                className="input mt-1 w-full"
                id={`${id}-${f.name}`}
                name={f.name}
                required={!f.optional}
                defaultValue={f.value ?? ""}
              >
                <option value="">Pilih</option>
                {f.options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            ) : f.type === "textarea" ? (
              <textarea
                className="input mt-1 min-h-24 w-full"
                id={`${id}-${f.name}`}
                name={f.name}
                required={!f.optional}
                maxLength={3000}
                defaultValue={f.value}
              />
            ) : (
              <input
                className="input mt-1 w-full"
                id={`${id}-${f.name}`}
                name={f.name}
                type={f.type || "text"}
                required={!f.optional}
                min={f.type === "number" ? 0 : undefined}
                step={f.type === "number" ? 1 : undefined}
                accept={f.type === "file" ? acceptFor("cash_proof") : undefined}
                defaultValue={f.type === "file" ? undefined : f.value}
              />
            )}
          </div>
        ))}
      </div>
      <Button type="submit" disabled={busy}>
        {busy ? "Menyimpan…" : label}
      </Button>
      {message && (
        <p className="notice break-words" role="status">
          {message}
        </p>
      )}
    </form>
  );
}
export function UsersPanel({ superAdmin }: { superAdmin: boolean }) {
  const [q, setQ] = useState(""),
    [search, setSearch] = useState(""),
    [selected, setSelected] = useState(""),
    [action, setAction] = useState("suspend"),
    query = useLiveApi<Wire<Awaited<ReturnType<typeof adminUsers>>>>(
      `/api/admin/users?q=${encodeURIComponent(search)}`,
      5000,
    ),
    detail = useLiveApi<Wire<Awaited<ReturnType<typeof adminUserDetail>>>>(
      selected ? `/api/admin/users/${selected}` : null,
      5000,
    );
  return (
    <div className="space-y-5">
      <h1 className="text-3xl">Pengguna</h1>
      <form
        className="flex flex-wrap gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          setSearch(q);
        }}
      >
        <label className="min-w-0 flex-1">
          <span className="field-label">Cari nama, HP, atau kode transaksi</span>
          <input
            className="input w-full"
            maxLength={100}
            disabled={query.loading}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </label>
        <Button type="submit" className="self-end" disabled={query.loading}>
          Cari
        </Button>
      </form>
      {query.error && (
        <p role="alert" className="notice notice-error">
          {query.error}
        </p>
      )}
      <Card>
        <ul className="divide-y divide-border">
          {query.data?.map((u) => (
            <li
              className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm"
              key={u.id}
            >
              <div className="min-w-0">
                <strong>{u.name}</strong>
                <p className="break-words">
                  {u.phone} · {u.role} · {u.accountStatus}
                </p>
                <p>
                  {u.activeStrikes} strike aktif · {u.verificationStatus}
                </p>
                {u.suspensionReason && <p className="text-destructive">{u.suspensionReason}</p>}
              </div>
              <Button size="sm" variant="outline" onClick={() => setSelected(u.id)}>
                Lihat riwayat
              </Button>
            </li>
          ))}
        </ul>
      </Card>
      {detail.error && <p role="alert">{detail.error}</p>}
      {detail.data && (
        <Card key={selected}>
          <h2 className="text-xl">{detail.data.user.name}</h2>
          <ul className="mt-3 space-y-2 text-sm">
            {detail.data.strikes.map((s) => (
              <li key={s.id}>
                {s.reason} · {dateWib(s.createdAt)} · berlaku sampai {dateWib(s.expiresAt)}
              </li>
            ))}
          </ul>
          <ul className="mt-4 space-y-2 text-sm">
            {detail.data.rentals.map((r) => (
              <li key={r.id}>
                <Link className="text-primary" href={`/transaksi/${r.id}`}>
                  {r.publicCode}
                </Link>{" "}
                · {RENTAL_LABELS[r.status]}
              </li>
            ))}
          </ul>
          <label className="field-label mt-5" htmlFor="user-action">
            Tindakan
          </label>
          <select
            className="input mt-1"
            id="user-action"
            value={action}
            onChange={(e) => setAction(e.target.value)}
          >
            {[
              ["suspend", "Tangguhkan"],
              ["reactivate", "Aktifkan kembali"],
              ["strike", "Beri strike"],
              ...(superAdmin ? [["role", "Ubah role"]] : []),
            ].map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
          <AdminActionForm
            key={`${selected}-${action}`}
            url={`/api/admin/users/${selected}/${action}`}
            method={action === "role" ? "PUT" : "POST"}
            fields={[
              ...(action === "role"
                ? [
                    {
                      name: "role",
                      label: "Role baru",
                      options: [
                        { value: "user", label: "Pengguna" },
                        { value: "admin", label: "Admin" },
                        { value: "super_admin", label: "Super admin" },
                      ],
                    },
                  ]
                : []),
              { name: "reason", label: "Alasan tindakan", type: "textarea" },
            ]}
            done={() => {
              void query.refresh();
              void detail.refresh();
            }}
          />
        </Card>
      )}
    </div>
  );
}
export function ReportsPanel() {
  const query = useLiveApi<Wire<Awaited<ReturnType<typeof reportQueue>>>>(
      "/api/admin/reports",
      5000,
    ),
    [selected, setSelected] = useState("");
  const row = query.data?.find((r) => r.id === selected);
  return (
    <div className="space-y-5">
      <h1 className="text-3xl">Laporan</h1>
      {query.error && <p role="alert">{query.error}</p>}
      <Card>
        {query.data?.length === 0 && <p>Tidak ada laporan menunggu.</p>}
        <ul className="divide-y divide-border">
          {query.data?.map((r) => (
            <li key={r.id} className="py-4 text-sm">
              <p className="font-bold">
                {r.targetType} · {r.reason}
              </p>
              <p className="mt-1 break-words whitespace-pre-line">{r.note}</p>
              <p className="mt-1 text-xs text-muted-foreground">{dateWib(r.createdAt)}</p>
              <Button
                size="sm"
                variant="outline"
                className="mt-2"
                onClick={() => setSelected(r.id)}
              >
                Tinjau laporan
              </Button>
            </li>
          ))}
        </ul>
      </Card>
      {row && (
        <Card key={row.id}>
          <h2 className="text-xl">Tinjau laporan</h2>
          <p className="mt-3 break-words text-sm whitespace-pre-line">
            {row.target?.text || "Konten tidak tersedia"}
          </p>
          {row.target && "conversationId" in row.target && (
            <Link
              className="text-sm text-primary"
              href={`/admin/laporan/chat/${row.target.conversationId}`}
            >
              Buka chat terkait (diaudit)
            </Link>
          )}
          <AdminActionForm
            url={`/api/admin/reports/${row.id}/action`}
            fields={[
              {
                name: "action",
                label: "Tindakan",
                options: [
                  { value: "abaikan", label: "Abaikan laporan" },
                  ...(row.targetType !== "user"
                    ? [{ value: "sembunyikan", label: "Sembunyikan konten" }]
                    : []),
                  { value: "strike", label: "Beri strike" },
                  { value: "tangguhkan", label: "Tangguhkan akun" },
                ],
              },
              { name: "reason", label: "Alasan keputusan", type: "textarea" },
            ]}
            label="Putuskan laporan"
            done={query.refresh}
          />
        </Card>
      )}
    </div>
  );
}
export function ReconciliationPanel() {
  const cash = useLiveApi<Wire<Awaited<ReturnType<typeof cashOverview>>>>("/api/admin/cash", 10000),
    query = useLiveApi<Wire<Awaited<ReturnType<typeof listReconciliations>>>>(
      "/api/admin/reconciliations",
      10000,
    );
  return (
    <div className="space-y-5">
      <h1 className="text-3xl">Rekonsiliasi harian</h1>
      <p className="text-sm text-muted-foreground">
        Bandingkan saldo aktual dengan ledger pada tanggal WIB. Catatan wajib jika ada selisih.
        Catatan yang disimpan menjadi jejak pemeriksaan permanen.
      </p>
      {(cash.error || query.error) && <p role="alert">{cash.error || query.error}</p>}
      {cash.data && (
        <Card>
          <h2 className="text-xl">Catat saldo aktual</h2>
          <AdminActionForm
            url="/api/admin/reconciliations"
            fields={[
              { name: "date", label: "Tanggal (WIB)", type: "date" },
              {
                name: "platformAccountId",
                label: "Rekening platform",
                options: cash.data.accounts.map((a) => ({
                  value: a.id,
                  label: `${a.provider} ${a.accountNo} · ledger saat ini ${rupiah(a.balance)}`,
                })),
              },
              { name: "actualBalance", label: "Saldo aktual (Rp)", type: "number" },
              { name: "note", label: "Catatan selisih", type: "textarea", optional: true },
            ]}
            done={query.refresh}
          />
        </Card>
      )}
      <Card>
        <h2 className="text-xl">Riwayat pemeriksaan</h2>
        <ul className="mt-3 divide-y divide-border">
          {query.data?.map(({ reconciliation: r, provider, accountNo }) => (
            <li className="py-3 text-sm" key={r.id}>
              <strong>
                {r.date} · {provider} {accountNo}
              </strong>
              <p>
                Aktual {rupiah(r.actualBalance)} · ledger {rupiah(r.ledgerBalance)}
              </p>
              <p
                className={
                  r.actualBalance !== r.ledgerBalance
                    ? "font-bold text-destructive"
                    : "text-muted-foreground"
                }
              >
                Selisih {rupiah(r.actualBalance - r.ledgerBalance)}
              </p>
              <p className="break-words">{r.note}</p>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
export function RecapPanel({ superAdmin }: { superAdmin: boolean }) {
  const query = useLiveApi<Wire<Awaited<ReturnType<typeof financialRecap>>>>(
      "/api/admin/recap",
      5000,
    ),
    cash = useLiveApi<Wire<Awaited<ReturnType<typeof cashOverview>>>>(
      superAdmin ? "/api/admin/cash" : null,
      10000,
    ),
    tasks = useLiveApi<Wire<Awaited<ReturnType<typeof payoutQueue>>>>(
      superAdmin ? "/api/admin/payout-tasks?state=done" : null,
      10000,
    );
  return (
    <div className="space-y-5">
      <h1 className="text-3xl">Rekap transaksi & dana</h1>
      <a
        className="inline-flex min-h-11 items-center font-bold text-primary"
        href="/api/admin/recap?format=csv"
        download
      >
        Unduh rekap CSV
      </a>
      {query.error && <p role="alert">{query.error}</p>}
      {query.data && (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            {[
              ["Saldo komisi", query.data.commission],
              ["Dana ditahan", query.data.held],
              [
                `Pencairan tertunda (${query.data.pendingPayoutCount})`,
                query.data.pendingPayoutAmount,
              ],
            ].map(([l, n]) => (
              <Card key={l}>
                <p className="text-sm">{l}</p>
                <p className="tabular mt-2 text-xl font-bold">{rupiah(Number(n))}</p>
              </Card>
            ))}
          </div>
          <Card>
            <ul className="divide-y divide-border">
              {query.data.statuses.map((r) => (
                <li key={r.status} className="flex flex-wrap justify-between gap-2 py-3 text-sm">
                  <strong>
                    {RENTAL_LABELS[r.status]} · {r.count}
                  </strong>
                  <span>
                    Sewa {rupiah(r.rentalValue)} · diterima {rupiah(r.received)}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </>
      )}
      {superAdmin && cash.data && (
        <Card>
          <h2 className="text-xl">Catat penarikan komisi</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Nominal dibatasi saldo komisi. Unggah bukti setelah transfer benar-benar dilakukan.
          </p>
          <AdminActionForm
            url="/api/admin/commission-withdrawals"
            fields={[
              {
                name: "fromAccountId",
                label: "Rekening sumber",
                options: cash.data.accounts.map((a) => ({
                  value: a.id,
                  label: `${a.provider} ${a.accountNo}`,
                })),
              },
              { name: "amount", label: "Nominal (Rp)", type: "number" },
              { name: "proofPath", label: "Bukti transfer", type: "file" },
              { name: "note", label: "Catatan", type: "textarea" },
            ]}
            done={query.refresh}
          />
        </Card>
      )}
      {superAdmin && tasks.data && (
        <Card>
          <h2 className="text-xl">Buat tugas penyesuaian</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Pembayaran tambahan kepada penerima memakai snapshot rekening tugas asli dan mengurangi
            saldo komisi. Bukti tugas asli tetap tersimpan.
          </p>
          <AdminActionForm
            url="/api/admin/payout-tasks/adjustments"
            fields={[
              {
                name: "originalTaskId",
                label: "Tugas asli yang sudah selesai",
                options: tasks.data
                  .filter((t) => t.kind !== "penyesuaian")
                  .map((t) => ({
                    value: t.id,
                    label: `${t.publicCode} · ${t.recipientName} · ${rupiah(t.amount)}`,
                  })),
              },
              { name: "amount", label: "Nominal tambahan (Rp)", type: "number" },
              { name: "reason", label: "Alasan koreksi", type: "textarea" },
            ]}
            done={query.refresh}
          />
        </Card>
      )}
    </div>
  );
}
export function ReportChat({ id }: { id: string }) {
  const q = useLiveApi<{
    messages: { id: string; text: string; originalBody?: string; imageUrl: string | null }[];
  }>(`/api/admin/conversations/${id}`, 5000);
  return (
    <Card>
      <h1 className="text-xl">Chat terkait laporan</h1>
      {q.error && <p role="alert">{q.error}</p>}
      <ol className="mt-4 space-y-3 text-sm">
        {q.data?.messages.map((m) => (
          <li className="break-words" key={m.id}>
            {m.originalBody ?? m.text}
            {m.imageUrl && (
              <a className="text-primary" href={m.imageUrl} target="_blank" rel="noreferrer">
                {" "}
                Lihat lampiran
              </a>
            )}
          </li>
        ))}
      </ol>
    </Card>
  );
}
