"use client";
import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Clock3, MapPin, Pencil, Plus, Tags, Trash2 } from "lucide-react";
import { api, useApi } from "@/src/lib/client-api";
import type { CampusOption } from "@/src/domain/campuses";
import {
  DAY_LABELS,
  DEFAULT_HOURS,
  hoursSchema,
  type PickupHours,
} from "@/src/domain/pickup-points";
import { cn } from "@/src/lib/utils";
import { CampusSelect } from "./campus-select";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { Input } from "./ui/input";
import { StatusChip } from "./ui/status-chip";

export function SettingsTabs() {
  const pathname = usePathname();
  return (
    <nav aria-label="Bagian pengaturan" className="mb-6 flex gap-2 overflow-x-auto pb-1">
      {[
        { href: "/admin/pengaturan", label: "Aturan dasar" },
        { href: "/admin/pengaturan/kategori", label: "Kategori" },
        { href: "/admin/pengaturan/titik", label: "Titik serah terima" },
      ].map(({ href, label }) => (
        <Link
          key={href}
          href={href}
          aria-current={pathname === href ? "page" : undefined}
          className={cn(
            "flex min-h-11 shrink-0 items-center rounded-full px-4 text-sm font-bold",
            pathname === href
              ? "bg-primary text-primary-foreground"
              : "bg-card text-muted-foreground hover:text-primary",
          )}
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}

type Category = { id: string; name: string; active: boolean; itemCount: number };
export function CategoryManager() {
  const query = useApi<Category[]>("/api/admin/categories"),
    [name, setName] = useState(""),
    [editing, setEditing] = useState<{ id: string; name: string } | null>(null),
    [busy, setBusy] = useState(""),
    [error, setError] = useState("");
  async function run(key: string, work: () => Promise<unknown>) {
    setBusy(key);
    setError("");
    try {
      await work();
      query.reload();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy("");
    }
  }
  return (
    <>
      <h1 className="text-3xl">Kategori</h1>
      <p className="mt-3 mb-7 text-sm text-muted-foreground">
        Kategori nonaktif tidak ditawarkan di formulir listing, dan listing di dalamnya
        disembunyikan dari pencarian. Kategori yang sudah dipakai tidak bisa dihapus.
      </p>
      <Card>
        <form
          className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end"
          onSubmit={async (event) => {
            event.preventDefault();
            if (
              await run("create", () =>
                api("/api/admin/categories", { method: "POST", body: JSON.stringify({ name }) }),
              )
            )
              setName("");
          }}
        >
          <div className="min-w-0 flex-1">
            <label className="field-label" htmlFor="categoryName">
              Kategori baru
            </label>
            <Input
              id="categoryName"
              required
              minLength={2}
              maxLength={60}
              placeholder="Contoh: Perlengkapan Wisuda"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <Button type="submit" disabled={busy === "create"}>
            <Plus size={16} />
            Tambah
          </Button>
        </form>
        {error && (
          <p className="notice notice-error mb-5" role="alert">
            {error}
          </p>
        )}
        {query.error && (
          <p className="notice notice-error mb-5" role="alert">
            {query.error}
          </p>
        )}
        {query.loading && (
          <div className="skeleton h-40" role="status" aria-label="Memuat kategori" />
        )}
        <ul className="divide-y divide-border">
          {query.data?.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center gap-3 py-3">
              <Tags size={18} className="shrink-0 text-primary" aria-hidden />
              {editing?.id === row.id ? (
                <form
                  className="flex min-w-0 flex-1 flex-wrap gap-2"
                  onSubmit={async (event) => {
                    event.preventDefault();
                    if (
                      await run(row.id, () =>
                        api(`/api/admin/categories/${row.id}`, {
                          method: "PATCH",
                          body: JSON.stringify({ name: editing.name }),
                        }),
                      )
                    )
                      setEditing(null);
                  }}
                >
                  <Input
                    aria-label={`Nama baru untuk ${row.name}`}
                    className="min-w-0 flex-1"
                    minLength={2}
                    maxLength={60}
                    required
                    value={editing.name}
                    onChange={(event) => setEditing({ id: row.id, name: event.target.value })}
                  />
                  <Button type="submit" size="sm" disabled={busy === row.id}>
                    Simpan
                  </Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(null)}>
                    Batal
                  </Button>
                </form>
              ) : (
                <>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold">{row.name}</p>
                    <p className="text-xs text-muted-foreground">{row.itemCount} listing</p>
                  </div>
                  <StatusChip tone={row.active ? "success" : "neutral"}>
                    {row.active ? "Aktif" : "Nonaktif"}
                  </StatusChip>
                  <div className="flex gap-1">
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={`Ubah nama ${row.name}`}
                      onClick={() => setEditing({ id: row.id, name: row.name })}
                    >
                      <Pencil size={16} />
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy === row.id}
                      onClick={() =>
                        void run(row.id, () =>
                          api(`/api/admin/categories/${row.id}`, {
                            method: "PATCH",
                            body: JSON.stringify({ active: !row.active }),
                          }),
                        )
                      }
                    >
                      {row.active ? "Nonaktifkan" : "Aktifkan"}
                    </Button>
                    {row.itemCount === 0 && (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="text-destructive"
                        aria-label={`Hapus ${row.name}`}
                        disabled={busy === row.id}
                        onClick={() => {
                          if (window.confirm(`Hapus kategori ${row.name}?`))
                            void run(row.id, () =>
                              api(`/api/admin/categories/${row.id}`, { method: "DELETE" }),
                            );
                        }}
                      >
                        <Trash2 size={16} />
                      </Button>
                    )}
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
        {query.data?.length === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Belum ada kategori. Jalankan seed atau tambahkan kategori pertama.
          </p>
        )}
      </Card>
    </>
  );
}

const DAY_NAMES = ["Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu", "Minggu"];
function HoursEditor({
  value,
  onChange,
}: {
  value: PickupHours;
  onChange: (value: PickupHours) => void;
}) {
  const update = (index: number, day: PickupHours[number]) =>
    onChange(value.map((current, i) => (i === index ? day : current)));
  return (
    <fieldset>
      <legend className="field-label">Jam operasional (WIB)</legend>
      <div className="space-y-2">
        {DAY_LABELS.map((label, index) => {
          const day = value[index];
          return (
            <div key={label} className="grid grid-cols-[88px_minmax(0,1fr)] items-center gap-2">
              <label className="flex min-h-11 items-center gap-2 text-sm font-semibold">
                <input
                  type="checkbox"
                  className="size-4 accent-primary"
                  checked={Boolean(day)}
                  onChange={() => update(index, day ? null : { open: "08:00", close: "17:00" })}
                />
                {label}
              </label>
              {day ? (
                <div className="grid grid-cols-2 gap-2">
                  <Input
                    type="time"
                    step={900}
                    aria-label={`Jam buka ${DAY_NAMES[index]}`}
                    value={day.open}
                    onChange={(event) => update(index, { ...day, open: event.target.value })}
                  />
                  <Input
                    type="time"
                    step={900}
                    aria-label={`Jam tutup ${DAY_NAMES[index]}`}
                    value={day.close}
                    onChange={(event) => update(index, { ...day, close: event.target.value })}
                  />
                </div>
              ) : (
                <span className="text-sm text-muted-foreground">Tutup</span>
              )}
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}
type Point = {
  id: string;
  name: string;
  description: string;
  hours: PickupHours;
  hoursSummary: string[];
  active: boolean;
  itemCount: number;
};
type PointForm = {
  id?: string;
  name: string;
  description: string;
  hours: PickupHours;
  active: boolean;
};
const NEW_POINT: PointForm = { name: "", description: "", hours: DEFAULT_HOURS, active: true };
export function PickupPointManager() {
  const campuses = useApi<CampusOption[]>("/api/campuses"),
    [campus, setCampus] = useState("");
  return (
    <>
      <h1 className="text-3xl">Titik serah terima</h1>
      <p className="mt-3 mb-7 text-sm text-muted-foreground">
        Titik dikelola per kampus. Listing hanya bisa memakai titik aktif di kampusnya sendiri, dan
        titik yang sudah dipakai cukup dinonaktifkan.
      </p>
      <Card className="mb-5">
        {campuses.error && (
          <p className="notice notice-error" role="alert">
            {campuses.error}
          </p>
        )}
        {campuses.data ? (
          <CampusSelect
            id="point-campus"
            campuses={campuses.data}
            value={campus}
            onChange={setCampus}
            emptyLabel="Pilih kampus"
          />
        ) : (
          <div className="skeleton h-28" role="status" aria-label="Memuat kampus" />
        )}
      </Card>
      {campus ? (
        <CampusPoints key={campus} campusId={campus} />
      ) : (
        <Card className="flex min-h-48 flex-col items-center justify-center text-center">
          <MapPin size={36} className="mb-3 text-primary" />
          <p className="text-sm text-muted-foreground">
            Pilih kampus untuk melihat dan menambah titik.
          </p>
        </Card>
      )}
    </>
  );
}
function CampusPoints({ campusId }: { campusId: string }) {
  const query = useApi<Point[]>(`/api/admin/pickup-points?campus=${campusId}`),
    [form, setForm] = useState<PointForm | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!form) return;
    const hours = hoursSchema.safeParse(form.hours);
    if (!hours.success) {
      setError(hours.error.issues[0]?.message || "Periksa jam operasional.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const body = {
        name: form.name,
        description: form.description,
        hours: form.hours,
        active: form.active,
      };
      await (form.id
        ? api(`/api/admin/pickup-points/${form.id}`, {
            method: "PATCH",
            body: JSON.stringify(body),
          })
        : api("/api/admin/pickup-points", {
            method: "POST",
            body: JSON.stringify({ ...body, campusId }),
          }));
      setForm(null);
      query.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function remove(point: Point) {
    if (!window.confirm(`Hapus titik ${point.name}?`)) return;
    setError("");
    try {
      await api(`/api/admin/pickup-points/${point.id}`, { method: "DELETE" });
      query.reload();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
      <Card className="min-w-0">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-lg">Titik di kampus ini</h2>
          <Button size="sm" onClick={() => setForm({ ...NEW_POINT })}>
            <Plus size={16} />
            Titik baru
          </Button>
        </div>
        {query.error && (
          <p className="notice notice-error" role="alert">
            {query.error}
          </p>
        )}
        {query.loading && <div className="skeleton h-32" role="status" aria-label="Memuat titik" />}
        {query.data?.length === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Belum ada titik. Tambahkan titik pertama agar mahasiswa kampus ini bisa menyewakan
            barang.
          </p>
        )}
        <ul className="divide-y divide-border">
          {query.data?.map((point) => (
            <li key={point.id} className="flex flex-wrap items-start gap-3 py-3">
              <MapPin size={18} className="mt-0.5 shrink-0 text-primary" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold">{point.name}</p>
                {point.description && (
                  <p className="text-xs text-muted-foreground">{point.description}</p>
                )}
                <p className="mt-1 flex items-start gap-1 text-xs text-muted-foreground">
                  <Clock3 size={13} className="mt-0.5 shrink-0" aria-hidden />
                  {point.hoursSummary.join(" · ")}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">{point.itemCount} listing</p>
              </div>
              <StatusChip tone={point.active ? "success" : "neutral"}>
                {point.active ? "Aktif" : "Nonaktif"}
              </StatusChip>
              <div className="flex gap-1">
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={`Ubah ${point.name}`}
                  onClick={() =>
                    setForm({
                      id: point.id,
                      name: point.name,
                      description: point.description,
                      hours: point.hours,
                      active: point.active,
                    })
                  }
                >
                  <Pencil size={16} />
                </Button>
                {point.itemCount === 0 && (
                  <Button
                    size="icon"
                    variant="ghost"
                    className="text-destructive"
                    aria-label={`Hapus ${point.name}`}
                    onClick={() => void remove(point)}
                  >
                    <Trash2 size={16} />
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
        {error && !form && (
          <p className="notice notice-error mt-4" role="alert">
            {error}
          </p>
        )}
      </Card>
      {form && (
        <Card className="min-w-0">
          <form className="form-stack" onSubmit={save}>
            <h2 className="text-lg">{form.id ? "Ubah titik" : "Titik baru"}</h2>
            <div>
              <label className="field-label" htmlFor="pointName">
                Nama titik
              </label>
              <Input
                id="pointName"
                required
                minLength={3}
                maxLength={100}
                placeholder="Contoh: Lobi Perpustakaan Pusat"
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
              />
            </div>
            <div>
              <label className="field-label" htmlFor="pointDescription">
                Keterangan (opsional)
              </label>
              <textarea
                id="pointDescription"
                className="input min-h-20"
                maxLength={500}
                placeholder="Patokan lokasi, misalnya dekat pos satpam"
                value={form.description}
                onChange={(event) => setForm({ ...form, description: event.target.value })}
              />
            </div>
            <HoursEditor value={form.hours} onChange={(hours) => setForm({ ...form, hours })} />
            <label className="flex items-center gap-3 text-sm font-semibold">
              <input
                type="checkbox"
                className="size-5 accent-primary"
                checked={form.active}
                onChange={(event) => setForm({ ...form, active: event.target.checked })}
              />
              Aktif dan bisa dipilih pemilik barang
            </label>
            {error && (
              <p className="notice notice-error" role="alert">
                {error}
              </p>
            )}
            <div className="flex gap-2">
              <Button type="submit" disabled={busy}>
                {busy ? "Menyimpan…" : "Simpan titik"}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setForm(null)}>
                Batal
              </Button>
            </div>
          </form>
        </Card>
      )}
    </div>
  );
}
