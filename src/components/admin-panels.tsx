"use client";
import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import {
  ArrowRight,
  BadgeCheck,
  Clock3,
  CircleAlert,
  Inbox,
  PackageSearch,
  ShieldCheck,
  Wallet,
  Send,
  Scale,
} from "lucide-react";
import { api, useApi } from "@/src/lib/client-api";
import { useLiveApi, type Wire } from "@/src/lib/live-api";
import type { adminSummary } from "@/src/services/admin-service";
import { dateWib } from "@/src/lib/utils";
import type { Settings } from "@/src/domain/settings";
import { Card } from "./ui/card";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { StatusChip } from "./ui/status-chip";
export function AdminSummary() {
  const query = useLiveApi<Wire<Awaited<ReturnType<typeof adminSummary>>>>(
    "/api/admin/summary",
    5000,
  );
  return (
    <>
      <p className="mb-2 text-xs font-bold tracking-widest text-primary uppercase">
        Selamat bertugas
      </p>
      <h1 className="text-3xl">Jaga kepercayaan, bareng.</h1>
      <p className="mt-3 mb-7 text-sm text-muted-foreground">
        Pantau verifikasi identitas, moderasi listing, pembayaran, pencairan, dan sengketa dari satu
        tempat.
      </p>
      {query.error && (
        <p className="notice notice-error mb-5" role="alert">
          {query.error}
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {[
          {
            icon: BadgeCheck,
            title: "Menunggu verifikasi",
            value: query.data?.pending,
            help: "Periksa pengajuan paling lama lebih dulu",
          },
          {
            icon: Clock3,
            title: "Identitas lewat target",
            value: query.data?.overdue,
            help: "Pengajuan di luar target pemeriksaan",
          },
          {
            icon: PackageSearch,
            title: "Listing menunggu review",
            value: query.data?.listingsPending,
            help: "Listing baru dan perubahan judul, foto, atau kategori",
          },
          {
            icon: Clock3,
            title: "Listing lewat target",
            value: query.data?.listingsOverdue,
            help: "Listing di luar target moderasi",
          },
          {
            icon: Wallet,
            title: "Pembayaran menunggu verifikasi",
            value: query.data?.paymentsPending,
            help: "Jumlah bukti transfer yang perlu diperiksa",
          },
          {
            icon: Clock3,
            title: "Pembayaran lewat target",
            value: query.data?.paymentsOverdue,
            help: "Bukti transfer yang melewati target verifikasi",
          },
          {
            icon: Send,
            title: "Pencairan & refund menunggu",
            value: query.data?.payoutsPending,
            help: "Tugas transfer ke pemilik atau penyewa yang belum berbukti",
          },
          {
            icon: Clock3,
            title: "Pencairan lewat target",
            value: query.data?.payoutsOverdue,
            help: "Sebelum 18.00 selesai pukul 21.00; setelahnya besok pukul 12.00",
          },
          {
            icon: Scale,
            title: "Sengketa terbuka",
            value: query.data?.disputesOpen,
            help: "Dana ditahan sampai ada putusan",
          },
          {
            icon: Clock3,
            title: "Sengketa lewat target putusan",
            value: query.data?.disputesOverdue,
            help: "Putusan melewati 72 jam sejak dibuka",
          },
        ].map(({ icon: Icon, title, value, help }) => (
          <Card key={title}>
            <Icon size={24} className="mb-5 text-primary" />
            <p className="text-sm text-muted-foreground">{title}</p>
            <p className="tabular mt-2 text-4xl font-extrabold">{value ?? "—"}</p>
            <p className="mt-3 text-xs text-muted-foreground">{help}</p>
          </Card>
        ))}
      </div>
      <div className="mt-5 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        {[
          {
            title: "Antrean identitas",
            text: "Bandingkan kartu, selfie, dan nama profil. Setiap keputusan dan akses bukti masuk ke audit log.",
            href: "/admin/verifikasi",
          },
          {
            title: "Moderasi listing",
            text: "Cocokkan foto dengan judul, kategori, dan kewajaran nilai barang sebelum listing tayang.",
            href: "/admin/listing",
          },
          {
            title: "Antrean pembayaran",
            text: "Cocokkan setiap bukti transfer dengan mutasi rekening platform, lalu terima atau tolak bukti.",
            href: "/admin/pembayaran",
          },
        ].map(({ title, text, href }) => (
          <Card key={href} className="flex min-w-0 flex-col">
            <h2 className="text-lg">{title}</h2>
            <p className="my-3 text-sm text-muted-foreground">{text}</p>
            <Button asChild className="mt-auto self-start">
              <Link href={href} aria-label={`Buka ${title.toLowerCase()}`}>
                Buka antrean
                <ArrowRight size={16} />
              </Link>
            </Button>
          </Card>
        ))}
      </div>
    </>
  );
}
type QueueRow = {
  id: string;
  name: string;
  cardType: string;
  createdAt: string;
  userId: string;
  overdue: boolean;
  slaHours: number;
};
export function VerificationQueue() {
  const query = useApi<QueueRow[]>("/api/admin/verifications"),
    [selected, setSelected] = useState("");
  return (
    <>
      <h1 className="text-3xl">Verifikasi identitas</h1>
      <p className="mt-3 mb-7 text-sm text-muted-foreground">
        Urut terlama. Target pemeriksaan mengikuti pengaturan admin.
      </p>
      {query.error && (
        <p className="notice notice-error mb-5" role="alert">
          {query.error}
        </p>
      )}
      <div className="grid gap-5 xl:grid-cols-[280px_1fr]">
        <Card className="p-3">
          {query.loading && (
            <div className="skeleton h-40" role="status" aria-label="Memuat antrean" />
          )}
          {query.data?.length === 0 && (
            <div className="px-4 py-10 text-center">
              <Inbox size={30} className="mx-auto mb-4 text-primary" />
              <h2 className="text-base">Antrean sudah beres</h2>
              <p className="mt-2 text-xs text-muted-foreground">
                Pengajuan baru akan muncul di sini.
              </p>
            </div>
          )}
          <ul className="space-y-2">
            {query.data?.map((entry) => (
              <li key={entry.id}>
                <button
                  className={`w-full rounded-xl border p-4 text-left ${entry.id === selected ? "border-primary bg-secondary" : "border-transparent hover:bg-background"}`}
                  onClick={() => setSelected(entry.id)}
                >
                  <p className="text-sm font-bold">{entry.name}</p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {entry.cardType.toUpperCase()} · {dateWib(entry.createdAt)}
                  </p>
                  {entry.overdue && (
                    <span className="mt-2 inline-flex items-center gap-1 text-xs text-destructive">
                      <CircleAlert size={13} />
                      Melewati target
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </Card>
        {selected ? (
          <VerificationDecision
            key={selected}
            id={selected}
            complete={() => {
              setSelected("");
              query.reload();
            }}
          />
        ) : (
          <Card className="flex min-h-70 flex-col items-center justify-center text-center">
            <BadgeCheck size={40} className="mb-4 text-primary" />
            <h2 className="text-lg">Pilih pengajuan untuk diperiksa</h2>
            <p className="mt-3 max-w-sm text-sm text-muted-foreground">
              Foto kartu dan selfie hanya dibuka saat kamu memilih pengajuan.
            </p>
          </Card>
        )}
      </div>
    </>
  );
}
function VerificationDecision({ id, complete }: { id: string; complete: () => void }) {
  const query = useApi<{
      id: string;
      name: string;
      cardType: string;
      status: string;
      cardUrl: string;
      selfieUrl: string;
    }>(`/api/admin/verifications/${id}`),
    [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function decide(decision: "diterima" | "ditolak") {
    if (
      !window.confirm(
        `${decision === "diterima" ? "Terima" : "Tolak"} identitas ${query.data?.name}?${decision === "ditolak" ? `\nAlasan: ${reason}` : "\nPastikan wajah dan nama pada kartu sudah sesuai."}`,
      )
    )
      return;
    setBusy(true);
    setError("");
    try {
      await api(`/api/admin/verifications/${id}/decision`, {
        method: "POST",
        body: JSON.stringify({ decision, ...(decision === "ditolak" ? { reason } : {}) }),
      });
      complete();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card>
      {query.error && (
        <p className="notice notice-error mb-4" role="alert">
          {query.error}
        </p>
      )}
      {query.loading && <div className="skeleton h-80" role="status" aria-label="Memuat bukti" />}
      {query.data && (
        <>
          <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-xl">{query.data.name}</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Pemeriksaan {query.data.cardType.toUpperCase()}
              </p>
            </div>
            <StatusChip tone={query.data.status === "menunggu" ? "warning" : "neutral"}>
              {query.data.status}
            </StatusChip>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {[
              { title: "Foto kartu", url: query.data.cardUrl },
              { title: "Selfie dengan kartu", url: query.data.selfieUrl },
            ].map((photo) => (
              <div key={photo.title}>
                <h3 className="mb-2 text-sm font-semibold">{photo.title}</h3>
                <a href={photo.url} target="_blank" rel="noreferrer">
                  <Image
                    unoptimized
                    src={photo.url}
                    alt={photo.title}
                    width={600}
                    height={450}
                    className="aspect-[4/3] w-full rounded-xl bg-background object-contain"
                  />
                </a>
              </div>
            ))}
          </div>
          <p className="mt-4 text-xs text-muted-foreground">
            Tautan bukti berlaku 5 menit.{" "}
            <button className="font-bold text-primary underline" onClick={query.reload}>
              Muat ulang tautan
            </button>
          </p>
          <div className="notice my-5">
            <ShieldCheck size={17} className="mr-2 inline" />
            Cocokkan wajah, keterbacaan kartu, serta nama: <strong>{query.data.name}</strong>.
          </div>
          {query.data.status === "menunggu" && (
            <>
              <label className="field-label" htmlFor="reasonTemplate">
                Alasan jika ditolak
              </label>
              <select
                id="reasonTemplate"
                className="input mb-3"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              >
                <option value="">Pilih alasan…</option>
                <option>Foto kartu kurang jelas. Coba foto ulang di tempat terang.</option>
                <option>
                  Nama di kartu berbeda dengan nama profil. Sesuaikan profil terlebih dahulu.
                </option>
                <option>Selfie belum menampilkan wajah dan kartu dengan jelas.</option>
              </select>
              <textarea
                aria-label="Alasan penolakan"
                className="input min-h-24"
                maxLength={1000}
                placeholder="Tambahkan alasan yang membantu pengguna memperbaiki fotonya"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
              {error && (
                <p className="notice notice-error mt-4" role="alert">
                  {error}
                </p>
              )}
              <div className="mt-5 flex flex-wrap gap-3">
                <Button disabled={busy} onClick={() => void decide("diterima")}>
                  Terima identitas
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
            </>
          )}
        </>
      )}
    </Card>
  );
}
type AuditRow = {
  id: string;
  adminId: string;
  adminName: string;
  action: string;
  targetType: string;
  targetId: string;
  createdAt: string;
};
export function AuditPanel() {
  const [action, setAction] = useState(""),
    [admin, setAdmin] = useState(""),
    [filter, setFilter] = useState("");
  const query = useApi<AuditRow[]>(`/api/admin/audit-logs${filter}`);
  return (
    <>
      <h1 className="mb-3 text-3xl">Audit log</h1>
      <p className="mb-7 text-sm text-muted-foreground">
        Jejak keputusan dan akses admin yang tersimpan permanen. Menampilkan 100 aktivitas terbaru.
      </p>
      <Card>
        <form
          className="mb-6 flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            const params = new URLSearchParams();
            if (action) params.set("action", action);
            if (admin) params.set("admin", admin);
            setFilter(params.size ? `?${params}` : "");
          }}
        >
          <div>
            <label className="field-label" htmlFor="auditAdmin">
              ID admin
            </label>
            <Input
              id="auditAdmin"
              placeholder="UUID admin (opsional)"
              value={admin}
              onChange={(e) => setAdmin(e.target.value)}
            />
          </div>
          <div>
            <label className="field-label" htmlFor="auditAction">
              Jenis aksi
            </label>
            <select
              className="input"
              id="auditAction"
              value={action}
              onChange={(e) => setAction(e.target.value)}
            >
              <option value="">Semua aksi</option>
              {[
                "identity_viewed",
                "identity_diterima",
                "identity_ditolak",
                "item_disetujui",
                "item_ditolak",
                "category_created",
                "category_updated",
                "category_deleted",
                "pickup_point_created",
                "pickup_point_updated",
                "pickup_point_deleted",
                "settings_updated",
                "bootstrap_super_admin",
              ].map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </div>
          <Button variant="outline" type="submit">
            Terapkan
          </Button>
        </form>
        {query.error && (
          <p className="notice notice-error mb-5" role="alert">
            {query.error}
          </p>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border text-xs text-muted-foreground">
                <th className="px-3 py-3">Waktu (WIB)</th>
                <th className="px-3 py-3">Admin</th>
                <th className="px-3 py-3">Aksi</th>
                <th className="px-3 py-3">Objek</th>
              </tr>
            </thead>
            <tbody>
              {query.data?.map((row) => (
                <tr key={row.id} className="border-b border-border last:border-0">
                  <td className="px-3 py-3 whitespace-nowrap">{dateWib(row.createdAt)}</td>
                  <td className="px-3 py-3" title={row.adminId}>
                    {row.adminName || "Super admin"}
                  </td>
                  <td className="px-3 py-3">{row.action}</td>
                  <td className="max-w-40 truncate px-3 py-3" title={row.targetId}>
                    {row.targetType} · {row.targetId.slice(0, 8)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {query.data?.length === 0 && (
          <p className="py-10 text-center text-sm text-muted-foreground">
            Belum ada aktivitas yang sesuai filter.
          </p>
        )}
        {query.loading && (
          <div className="skeleton mt-4 h-36" role="status" aria-label="Memuat audit log" />
        )}
      </Card>
    </>
  );
}
const basicSettings: {
  key: keyof Settings;
  label: string;
  suffix: string;
  min: number;
  max: number;
}[] = [
  {
    key: "login_ttl_minutes",
    label: "Masa berlaku permintaan login",
    suffix: "menit",
    min: 1,
    max: 30,
  },
  {
    key: "login_max_requests",
    label: "Batas permintaan login",
    suffix: "permintaan",
    min: 1,
    max: 20,
  },
  {
    key: "login_window_minutes",
    label: "Jendela pembatasan login",
    suffix: "menit",
    min: 1,
    max: 60,
  },
  {
    key: "action_ttl_minutes",
    label: "Masa berlaku konfirmasi Telegram",
    suffix: "menit",
    min: 1,
    max: 30,
  },
  { key: "user_session_days", label: "Masa aktif sesi pengguna", suffix: "hari", min: 1, max: 30 },
  {
    key: "admin_session_hours",
    label: "Masa aktif sesi admin",
    suffix: "jam (maks. 12)",
    min: 1,
    max: 12,
  },
  {
    key: "identity_sla_hours",
    label: "Target verifikasi identitas",
    suffix: "jam",
    min: 1,
    max: 72,
  },
  { key: "admin_open_hour", label: "Jam buka admin", suffix: "WIB", min: 0, max: 23 },
  { key: "admin_close_hour", label: "Jam tutup admin", suffix: "WIB", min: 1, max: 24 },
  {
    key: "listing_sla_hours",
    label: "Target moderasi listing",
    suffix: "jam",
    min: 1,
    max: 168,
  },
  {
    key: "deposit_min_bp",
    label: "Deposit minimal dari nilai barang",
    suffix: "bp (1000 = 10%)",
    min: 1,
    max: 10000,
  },
  {
    key: "deposit_max_bp",
    label: "Deposit maksimal dari nilai barang",
    suffix: "bp (5000 = 50%)",
    min: 1,
    max: 10000,
  },
  { key: "deposit_cap", label: "Batas atas deposit", suffix: "rupiah", min: 1000, max: 100000000 },
  {
    key: "commission_rate_bp",
    label: "Komisi platform",
    suffix: "bp (1000 = 10%)",
    min: 0,
    max: 10000,
  },
];
export function SettingsPanel() {
  const query = useApi<Settings>("/api/admin/settings");
  if (query.error)
    return (
      <p className="notice notice-error" role="alert">
        {query.error}
      </p>
    );
  if (!query.data)
    return <div className="skeleton h-80" aria-label="Memuat pengaturan" role="status" />;
  return <SettingsFields initial={query.data} />;
}
function SettingsFields({ initial }: { initial: Settings }) {
  const [values, setValues] = useState(initial),
    [baseline, setBaseline] = useState(initial),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [saved, setSaved] = useState(false);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setSaved(false);
    setError("");
    try {
      const patch = Object.fromEntries(
        basicSettings
          .filter(({ key }) => values[key] !== baseline[key])
          .map(({ key }) => [key, values[key]]),
      );
      if (!Object.keys(patch).length) {
        setSaved(true);
        return;
      }
      const next = await api<Settings>("/api/admin/settings", {
        method: "PUT",
        body: JSON.stringify(patch),
      });
      setValues(next);
      setBaseline(next);
      setSaved(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <h1 className="text-3xl">Pengaturan dasar</h1>
      <p className="mt-3 mb-7 text-sm text-muted-foreground">
        Perubahan langsung berlaku untuk permintaan baru dan masuk ke audit log.
      </p>
      <Card>
        <form className="form-stack" onSubmit={save}>
          <div className="grid gap-6 sm:grid-cols-2">
            {basicSettings.map(({ key, label, suffix, min, max }) => (
              <div key={key}>
                <label className="field-label" htmlFor={key}>
                  {label}
                </label>
                <div className="flex items-center gap-3">
                  <Input
                    id={key}
                    type="number"
                    min={min}
                    max={max}
                    step={1}
                    required
                    value={values[key]}
                    onChange={(e) =>
                      setValues({
                        ...values,
                        [key]: e.target.value === "" ? "" : Number(e.target.value),
                      })
                    }
                  />
                  <span className="shrink-0 text-xs text-muted-foreground">{suffix}</span>
                </div>
              </div>
            ))}
          </div>
          {error && (
            <p className="notice notice-error" role="alert">
              {error}
            </p>
          )}
          {saved && (
            <p className="notice notice-success" role="status">
              Pengaturan sudah tersimpan.
            </p>
          )}
          <Button type="submit" className="self-start" disabled={busy}>
            {busy ? "Menyimpan…" : "Simpan pengaturan"}
          </Button>
        </form>
      </Card>
    </>
  );
}
