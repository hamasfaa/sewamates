"use client";
import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  CircleAlert,
  ClipboardCheck,
  Clock3,
  Images,
  LoaderCircle,
  MapPin,
  PartyPopper,
  Tag,
  UserRound,
  Wallet,
} from "lucide-react";
import { api, useApi } from "@/src/lib/client-api";
import { depositRange, netEstimate } from "@/src/domain/pricing";
import { LISTING_LIMITS, needsReview } from "@/src/domain/listing";
import { itemInput } from "@/src/lib/validation";
import { cn, rupiah } from "@/src/lib/utils";
import type { itemForEdit, listingOptions } from "@/src/services/item-service";
import { CostSummary } from "./cost-summary";
import { ItemCard } from "./item-card";
import { MoneyInput } from "./money-input";
import { PhotoManager, type PhotoSlot } from "./photo-manager";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { Input } from "./ui/input";
import { ItemStatusChip } from "./ui/status-chip";

type Options = Awaited<ReturnType<typeof listingOptions>>;
type EditData = Awaited<ReturnType<typeof itemForEdit>>;
type Form = {
  title: string;
  categoryId: string;
  description: string;
  itemValue: number | null;
  pricePerDay: number | null;
  deposit: number | null;
  minDays: number;
  maxDays: number;
  pickupPointIds: string[];
};
const STEPS = [
  { label: "Foto", icon: Images, fields: ["photos"] },
  { label: "Detail", icon: Tag, fields: ["title", "categoryId", "description", "itemValue"] },
  { label: "Harga", icon: Wallet, fields: ["pricePerDay", "deposit", "minDays", "maxDays"] },
  { label: "Titik", icon: MapPin, fields: ["pickupPointIds"] },
  { label: "Pratinjau", icon: ClipboardCheck, fields: [] },
] as const;
const ALL_FIELDS = STEPS.flatMap((step) => step.fields as readonly string[]);
const EMPTY: Form = {
  title: "",
  categoryId: "",
  description: "",
  itemValue: null,
  pricePerDay: null,
  deposit: null,
  minDays: 1,
  maxDays: 7,
  pickupPointIds: [],
};
// Drafts survive reloads on weak connections (02 §3); upload tickets expire after two hours.
const DRAFT_KEY = "sewamates:listing-draft:v1",
  DRAFT_PHOTO_TTL = 100 * 60000;
type Draft = { form: Form; photos: PhotoSlot[]; step: number; savedAt: number };
function readDraft(now: number) {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const draft = JSON.parse(raw) as Draft;
    return {
      form: { ...EMPTY, ...draft.form },
      step: Math.min(Math.max(draft.step || 0, 0), 3),
      photos: (draft.photos || [])
        .filter((photo) => photo.uploadedAt && now - photo.uploadedAt < DRAFT_PHOTO_TTL)
        .map((photo) => ({ ...photo, status: "done" as const, preview: photo.thumbUrl ?? null })),
    };
  } catch {
    return null;
  }
}
function clearDraft() {
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch {}
}

function gateFor(data: Options | EditData, editing: boolean) {
  const status = data.eligibility;
  if (!status.active)
    return {
      title: "Akunmu sedang dibatasi",
      text: "Listing baru belum bisa dibuat. Hubungi admin SewaMates untuk bantuan.",
    };
  if (editing) {
    return status.verified
      ? null
      : {
          title: "Verifikasi ulang identitasmu",
          text: "Listing hanya bisa diubah oleh pemilik yang terverifikasi.",
          href: "/profil/verifikasi",
          action: "Verifikasi identitas",
        };
  }
  if (!status.onboarded)
    return {
      title: "Lengkapi profil dulu, yuk",
      text: "Isi nama, pilih kampus, dan setujui ketentuan sebelum menyewakan barang.",
      href: "/daftar",
      action: "Lengkapi profil",
    };
  if (!status.verified)
    return {
      title: "Verifikasi identitas dulu, yuk",
      text: "Penyewa lebih tenang kalau pemilik barang sudah terverifikasi. Prosesnya cuma tiga langkah.",
      href: "/profil/verifikasi",
      action: "Verifikasi identitas",
    };
  if (!status.payout)
    return {
      title: "Siapkan rekening pencairan",
      text: "Hasil sewa dan pengembalian deposit dikirim ke rekening ini, jadi wajib diisi sebelum menerbitkan listing.",
      href: "/profil/rekening",
      action: "Isi rekening",
    };
  if (!status.campusActive)
    return {
      title: "Perbarui kampusmu",
      text: "Kampus di profilmu sudah tidak tersedia. Pilih kampus yang aktif agar listing tampil di tempat yang tepat.",
      href: "/profil",
      action: "Perbarui profil",
    };
  if (!data.pickupPoints.length)
    return {
      title: "Titik serah terima belum tersedia",
      text: `Admin perlu menambahkan titik serah terima untuk ${data.campus?.name || "kampusmu"} dulu. Coba lagi nanti, ya.`,
    };
  return null;
}

export function ListingWizard({ itemId }: { itemId?: string }) {
  const query = useApi<Options | EditData>(
    itemId ? `/api/items/${itemId}/edit` : "/api/me/listing-options",
  );
  if (query.error)
    return (
      <div className="page-container max-w-3xl py-10">
        <p className="notice notice-error" role="alert">
          {query.error}
        </p>
      </div>
    );
  if (!query.data)
    return (
      <div className="page-container py-10">
        <div className="skeleton h-96" role="status" aria-label="Memuat formulir" />
      </div>
    );
  const gate = gateFor(query.data, Boolean(itemId));
  if (gate)
    return (
      <div className="page-container max-w-2xl py-10">
        <Card className="px-6 py-12 text-center">
          <span className="mx-auto mb-5 flex size-16 items-center justify-center rounded-3xl bg-secondary text-primary">
            <BadgeCheck size={30} />
          </span>
          <h1 className="text-2xl">{gate.title}</h1>
          <p className="mx-auto mt-3 max-w-md text-sm leading-7 text-muted-foreground">
            {gate.text}
          </p>
          {gate.href && (
            <Button asChild className="mt-6">
              <Link href={gate.href}>
                {gate.action}
                <ArrowRight size={16} />
              </Link>
            </Button>
          )}
        </Card>
      </div>
    );
  return <WizardForm key={itemId || "new"} data={query.data} itemId={itemId} />;
}

function FieldError({ id, message }: { id: string; message?: string }) {
  return message ? (
    <p id={`${id}-error`} className="mt-1.5 flex items-start gap-1 text-sm text-destructive">
      <CircleAlert size={15} className="mt-0.5 shrink-0" aria-hidden />
      {message}
    </p>
  ) : null;
}
const invalid = (id: string, message?: string) =>
  message ? { "aria-invalid": true, "aria-describedby": `${id}-error` } : {};

function WizardForm({ data, itemId }: { data: Options | EditData; itemId?: string }) {
  const edit = "item" in data ? data.item : null;
  const [restored] = useState(() => (edit ? null : readDraft(Date.now())));
  const [form, setForm] = useState<Form>(() =>
    edit
      ? {
          title: edit.title,
          categoryId: edit.categoryId,
          description: edit.description,
          itemValue: edit.itemValue,
          pricePerDay: edit.pricePerDay,
          deposit: edit.deposit,
          minDays: edit.minDays,
          maxDays: edit.maxDays,
          pickupPointIds: edit.pickupPointIds.filter((id) =>
            data.pickupPoints.some((point) => point.id === id),
          ),
        }
      : (restored?.form ?? EMPTY),
  );
  const [photos, setPhotos] = useState<PhotoSlot[]>(() =>
    edit
      ? edit.photos.map((photo) => ({
          key: photo.path,
          status: "done" as const,
          path: photo.path,
          thumbPath: photo.thumbPath,
          thumbUrl: photo.thumbUrl,
          preview: photo.thumbUrl,
        }))
      : (restored?.photos ?? []),
  );
  const [step, setStep] = useState(restored?.step ?? 0),
    [reached, setReached] = useState(edit ? STEPS.length - 1 : (restored?.step ?? 0)),
    [errors, setErrors] = useState<Record<string, string>>({}),
    [busy, setBusy] = useState(false),
    [submitError, setSubmitError] = useState(""),
    [restoredNotice, setRestoredNotice] = useState(Boolean(restored)),
    [done, setDone] = useState<{ id: string; reviewRequired: boolean } | null>(null);
  const top = useRef<HTMLDivElement>(null),
    latestPhotos = useRef(photos),
    rules = data.rules;
  useEffect(() => {
    latestPhotos.current = photos;
  }, [photos]);
  // Blob previews stay valid across steps and are released only when the wizard closes.
  useEffect(
    () => () =>
      latestPhotos.current.forEach(
        (photo) => photo.preview?.startsWith("blob:") && URL.revokeObjectURL(photo.preview),
      ),
    [],
  );
  useEffect(() => {
    if (edit || done) return;
    const timer = setTimeout(() => {
      try {
        const saved: Draft = {
          form,
          step,
          savedAt: Date.now(),
          photos: photos
            .filter((photo) => photo.status === "done")
            .map(({ key, status, path, thumbPath, thumbUrl, uploadedAt }) => ({
              key,
              status,
              path,
              thumbPath,
              thumbUrl,
              uploadedAt,
              preview: null,
            })),
        };
        localStorage.setItem(DRAFT_KEY, JSON.stringify(saved));
      } catch {}
    }, 400);
    return () => clearTimeout(timer);
  }, [form, photos, step, edit, done]);

  const set = <K extends keyof Form>(key: K, value: Form[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
  };
  const payload = () => ({
    ...form,
    photos: photos.map((photo) => ({ path: photo.path || "", thumbPath: photo.thumbPath || "" })),
  });
  const range = form.itemValue ? depositRange(form.itemValue, rules) : null;
  function validate(fields: readonly string[]) {
    const found: Record<string, string> = {};
    const result = itemInput.safeParse(payload());
    if (!result.success)
      for (const issue of result.error.issues) {
        const key = String(issue.path[0] ?? "");
        if (fields.includes(key) && !found[key]) found[key] = issue.message;
      }
    if (fields.includes("photos")) {
      if (photos.some((photo) => photo.status === "uploading"))
        found.photos = "Tunggu sampai semua foto selesai diunggah.";
      else if (photos.some((photo) => photo.status === "error"))
        found.photos = "Hapus atau unggah ulang foto yang gagal.";
    }
    if (fields.includes("deposit") && !found.deposit && range && form.deposit !== null) {
      if (range.min > range.max)
        found.deposit = "Nilai barang terlalu kecil untuk menentukan deposit.";
      else if (form.deposit < range.min || form.deposit > range.max)
        found.deposit = `Deposit untuk nilai barang ini harus antara ${rupiah(range.min)} dan ${rupiah(range.max)}.`;
    }
    setErrors(found);
    return found;
  }
  function show(next: number) {
    setStep(next);
    setReached((value) => Math.max(value, next));
    top.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  function nextStep() {
    const found = validate(STEPS[step].fields);
    if (Object.keys(found).length) {
      document.getElementById(Object.keys(found)[0])?.focus();
      return;
    }
    show(step + 1);
  }
  async function submit() {
    const found = validate(ALL_FIELDS);
    if (Object.keys(found).length) {
      show(STEPS.findIndex((value) => value.fields.some((field) => found[field])));
      return;
    }
    setBusy(true);
    setSubmitError("");
    try {
      const body = JSON.stringify(payload());
      if (itemId) {
        const result = await api<{ id: string; reviewRequired: boolean }>(`/api/items/${itemId}`, {
          method: "PATCH",
          body,
        });
        setDone(result);
      } else {
        const result = await api<{ id: string }>("/api/items", { method: "POST", body });
        clearDraft();
        setDone({ id: result.id, reviewRequired: true });
      }
    } catch (error) {
      setSubmitError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const category = data.categories.find((row) => row.id === form.categoryId),
    chosenPoints = data.pickupPoints.filter((point) => form.pickupPointIds.includes(point.id)),
    net = form.pricePerDay
      ? netEstimate(form.pricePerDay, form.minDays, rules.commission_rate_bp)
      : null;
  const reviewAgain =
    edit &&
    edit.status !== "menunggu_review" &&
    (edit.status === "ditolak" ||
      needsReview(
        {
          title: edit.title,
          categoryId: edit.categoryId,
          photoPaths: edit.photos.map((photo) => photo.path),
        },
        {
          title: form.title,
          categoryId: form.categoryId,
          photoPaths: photos.map((photo) => photo.path || photo.key),
        },
      ));
  const preview = (
    <ItemCard
      preview
      item={{
        id: itemId || "pratinjau",
        title: form.title || "Judul barangmu",
        pricePerDay: form.pricePerDay ?? 0,
        ratingAvg: 0,
        ratingCount: 0,
        isNew: true,
        thumbUrl: photos.find((photo) => photo.preview)?.preview ?? null,
        pointName: chosenPoints[0]?.name ?? null,
        categoryName: category?.name ?? "",
        campus: data.campus?.label ?? "",
      }}
    />
  );

  if (done)
    return (
      <div className="page-container max-w-2xl py-10">
        <Card className="px-6 py-12 text-center">
          <span className="mx-auto mb-5 flex size-16 items-center justify-center rounded-3xl bg-accent text-accent-foreground">
            <PartyPopper size={30} />
          </span>
          <h1 className="text-2xl">
            {!itemId
              ? "Listing terkirim!"
              : done.reviewRequired
                ? "Perubahan dikirim untuk ditinjau"
                : "Perubahan tersimpan"}
          </h1>
          <p className="mx-auto mt-3 max-w-md text-sm leading-7 text-muted-foreground">
            {done.reviewRequired
              ? `Admin memeriksa listing dengan target ${rules.listing_sla_hours} jam. Kamu akan dapat notifikasi saat listing tayang atau perlu diperbaiki.`
              : "Harga, deposit, durasi, dan titik baru langsung berlaku untuk pengajuan berikutnya."}
          </p>
          <div className="mt-7 flex flex-col justify-center gap-3 sm:flex-row">
            <Button asChild>
              <Link href="/profil/listing">Lihat listing saya</Link>
            </Button>
            {itemId ? (
              <Button asChild variant="outline">
                <Link href={`/barang/${itemId}`}>Buka halaman barang</Link>
              </Button>
            ) : (
              <Button variant="outline" onClick={() => window.location.reload()}>
                Pasang barang lain
              </Button>
            )}
          </div>
        </Card>
      </div>
    );

  return (
    <div ref={top} className="page-container scroll-mt-24 py-6 lg:py-10">
      <p className="mb-2 text-xs font-bold tracking-widest text-primary uppercase">
        {edit ? "Ubah listing" : "Sewakan barang"}
      </p>
      <h1 className="mb-5 text-2xl sm:text-3xl">{edit ? edit.title : "Pasang barangmu"}</h1>
      {edit?.status === "ditolak" && (
        <p className="notice notice-error mb-5" role="alert">
          <strong>Listing ditolak admin.</strong> {edit.rejectReason} Perbaiki lalu kirim ulang.
        </p>
      )}
      {edit && !edit.categoryActive && (
        <p className="notice mb-5" role="status">
          Kategori listing ini tidak tersedia lagi. Pilih kategori lain supaya listing bisa tampil.
        </p>
      )}
      {restoredNotice && (
        <div
          className="notice mb-5 flex flex-wrap items-center justify-between gap-3"
          role="status"
        >
          Draf terakhirmu dipulihkan.
          <button
            type="button"
            className="font-bold underline"
            onClick={() => {
              clearDraft();
              setForm(EMPTY);
              setPhotos([]);
              setStep(0);
              setReached(0);
              setRestoredNotice(false);
            }}
          >
            Mulai dari awal
          </button>
        </div>
      )}
      <div className="grid min-w-0 gap-5 lg:grid-cols-[190px_minmax(0,1fr)_250px] lg:gap-6">
        <nav aria-label="Langkah listing" className="min-w-0 lg:sticky lg:top-24 lg:self-start">
          <ol className="flex gap-1.5 lg:flex-col lg:gap-1">
            {STEPS.map(({ label, icon: Icon }, index) => (
              <li key={label} className="min-w-0 flex-1 lg:flex-none">
                <button
                  type="button"
                  disabled={index > reached || busy}
                  aria-current={index === step ? "step" : undefined}
                  onClick={() => show(index)}
                  className={cn(
                    "flex w-full flex-col gap-1.5 text-left text-xs font-semibold lg:min-h-11 lg:flex-row lg:items-center lg:gap-3 lg:rounded-xl lg:px-3 lg:text-sm",
                    index === step
                      ? "text-primary lg:bg-secondary"
                      : index <= reached
                        ? "text-foreground hover:text-primary"
                        : "text-muted-foreground",
                  )}
                >
                  <span
                    className={cn(
                      "h-1 rounded-full lg:hidden",
                      index <= Math.max(step, 0) ? "bg-primary" : "bg-border",
                    )}
                  />
                  <Icon size={18} className="hidden shrink-0 lg:block" aria-hidden />
                  <span className="truncate">
                    <span className="lg:hidden">{index + 1}. </span>
                    {label}
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </nav>
        <Card className="min-w-0 p-4 sm:p-6">
          {step === 0 && (
            <>
              <h2 className="text-xl">Foto barang</h2>
              <p className="mt-2 mb-5 text-sm leading-6 text-muted-foreground">
                Foto terang dan jujur bikin penyewa lebih percaya. Tunjukkan juga bagian yang lecet
                atau minus.
              </p>
              <div id="photos" tabIndex={-1}>
                <PhotoManager photos={photos} onChange={setPhotos} error={errors.photos} />
              </div>
            </>
          )}
          {step === 1 && (
            <div className="form-stack">
              <h2 className="text-xl">Detail barang</h2>
              <div>
                <label className="field-label" htmlFor="title">
                  Judul
                </label>
                <Input
                  id="title"
                  value={form.title}
                  maxLength={LISTING_LIMITS.title.max}
                  placeholder="Contoh: Kamera Canon EOS 1200D + lensa kit"
                  onChange={(event) => set("title", event.target.value)}
                  {...invalid("title", errors.title)}
                />
                <p className="help">
                  {form.title.trim().length}/{LISTING_LIMITS.title.max} karakter
                </p>
                <FieldError id="title" message={errors.title} />
              </div>
              <div>
                <label className="field-label" htmlFor="categoryId">
                  Kategori
                </label>
                <select
                  id="categoryId"
                  className="input"
                  value={form.categoryId}
                  onChange={(event) => set("categoryId", event.target.value)}
                  {...invalid("categoryId", errors.categoryId)}
                >
                  <option value="">Pilih kategori</option>
                  {data.categories.map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.name}
                    </option>
                  ))}
                </select>
                <FieldError id="categoryId" message={errors.categoryId} />
              </div>
              <div>
                <label className="field-label" htmlFor="description">
                  Deskripsi kondisi
                </label>
                <textarea
                  id="description"
                  className="input min-h-36"
                  value={form.description}
                  maxLength={LISTING_LIMITS.description.max}
                  placeholder="Ceritakan kondisi, kelengkapan, dan minus barang. Contoh: lensa bersih, ada lecet halus di body, termasuk charger dan tas."
                  onChange={(event) => set("description", event.target.value)}
                  {...invalid("description", errors.description)}
                />
                <p className="help">
                  {form.description.trim().length}/{LISTING_LIMITS.description.max} karakter
                </p>
                <FieldError id="description" message={errors.description} />
              </div>
              <div>
                <label className="field-label" htmlFor="itemValue">
                  Nilai barang perkiraan
                </label>
                <MoneyInput
                  id="itemValue"
                  value={form.itemValue}
                  onChange={(value) => set("itemValue", value)}
                  {...invalid("itemValue", errors.itemValue)}
                />
                <p className="help">
                  Harga barang serupa saat ini. Dipakai untuk menentukan rentang deposit.
                </p>
                <FieldError id="itemValue" message={errors.itemValue} />
              </div>
            </div>
          )}
          {step === 2 && (
            <div className="form-stack">
              <h2 className="text-xl">Harga dan durasi</h2>
              <div>
                <label className="field-label" htmlFor="pricePerDay">
                  Harga sewa per hari
                </label>
                <MoneyInput
                  id="pricePerDay"
                  value={form.pricePerDay}
                  onChange={(value) => set("pricePerDay", value)}
                  {...invalid("pricePerDay", errors.pricePerDay)}
                />
                <FieldError id="pricePerDay" message={errors.pricePerDay} />
              </div>
              <div>
                <label className="field-label" htmlFor="deposit">
                  Deposit
                </label>
                <MoneyInput
                  id="deposit"
                  value={form.deposit}
                  onChange={(value) => set("deposit", value)}
                  {...invalid("deposit", errors.deposit)}
                />
                {range && range.min <= range.max ? (
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                    <span>
                      Rentang: {rupiah(range.min)}–{rupiah(range.max)}
                    </span>
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      onClick={() => set("deposit", range.min)}
                    >
                      Pakai minimal
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      onClick={() => set("deposit", range.max)}
                    >
                      Pakai maksimal
                    </Button>
                  </div>
                ) : (
                  <p className="help">
                    Isi nilai barang di langkah Detail untuk melihat rentang deposit.
                  </p>
                )}
                <FieldError id="deposit" message={errors.deposit} />
                <p className="help">
                  Deposit dikembalikan ke penyewa setelah barang kembali dalam kondisi baik.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {(["minDays", "maxDays"] as const).map((key) => (
                  <div key={key} className="min-w-0">
                    <label className="field-label" htmlFor={key}>
                      {key === "minDays" ? "Durasi minimal" : "Durasi maksimal"}
                    </label>
                    <div className="relative">
                      <Input
                        id={key}
                        type="number"
                        inputMode="numeric"
                        min={LISTING_LIMITS.days.min}
                        max={LISTING_LIMITS.days.max}
                        className="pr-14"
                        value={form[key]}
                        onChange={(event) => set(key, Number(event.target.value) || 0)}
                        {...invalid(key, errors[key])}
                      />
                      <span className="pointer-events-none absolute top-1/2 right-4 -translate-y-1/2 text-sm text-muted-foreground">
                        hari
                      </span>
                    </div>
                    <FieldError id={key} message={errors[key]} />
                  </div>
                ))}
              </div>
              <div className="rounded-2xl bg-[var(--color-navy)] p-5 text-white">
                <p className="text-sm text-white/75">Perkiraan pendapatan bersih</p>
                <p className="tabular mt-1 text-3xl font-extrabold text-accent">
                  {net === null ? "—" : rupiah(net)}
                </p>
                <p className="mt-2 text-xs leading-5 text-white/75">
                  Untuk sewa {form.minDays || 1} hari setelah komisi{" "}
                  {rules.commission_rate_bp / 100}%. Denda keterlambatan (jika ada) masuk ke pemilik
                  tanpa komisi.
                </p>
              </div>
            </div>
          )}
          {step === 3 && (
            <fieldset id="pickupPointIds" tabIndex={-1}>
              <legend className="text-xl font-extrabold">Titik serah terima</legend>
              <p className="mt-2 mb-5 text-sm leading-6 text-muted-foreground">
                Pilih titik di {data.campus?.name || "kampusmu"} tempat kamu siap bertemu penyewa.
                Jam mengikuti jam operasional titik (WIB).
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                {data.pickupPoints.map((point) => {
                  const checked = form.pickupPointIds.includes(point.id);
                  return (
                    <label
                      key={point.id}
                      className={cn(
                        "flex cursor-pointer items-start gap-3 rounded-2xl border p-4",
                        checked
                          ? "border-primary bg-secondary"
                          : "border-border hover:border-primary",
                      )}
                    >
                      <input
                        type="checkbox"
                        className="mt-1 size-4 shrink-0 accent-primary"
                        checked={checked}
                        onChange={() =>
                          set(
                            "pickupPointIds",
                            checked
                              ? form.pickupPointIds.filter((id) => id !== point.id)
                              : [...form.pickupPointIds, point.id],
                          )
                        }
                      />
                      <span className="min-w-0">
                        <span className="block text-sm font-bold">{point.name}</span>
                        {point.description && (
                          <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                            {point.description}
                          </span>
                        )}
                        <span className="mt-2 flex items-start gap-1 text-xs text-muted-foreground">
                          <Clock3 size={13} className="mt-0.5 shrink-0" aria-hidden />
                          {point.hoursSummary.join(" · ")}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>
              <FieldError id="pickupPointIds" message={errors.pickupPointIds} />
            </fieldset>
          )}
          {step === 4 && (
            <div>
              <h2 className="text-xl">Pratinjau</h2>
              <p className="mt-2 mb-5 text-sm text-muted-foreground">
                Periksa lagi sebelum dikirim. Begini listingmu terlihat di pencarian.
              </p>
              <div className="mx-auto mb-6 max-w-64 lg:hidden">{preview}</div>
              <ul className="mb-5 flex gap-2 overflow-x-auto pb-1" aria-label="Foto">
                {photos.map((photo, index) =>
                  photo.preview ? (
                    <li key={photo.key} className="shrink-0">
                      <Image
                        unoptimized
                        src={photo.preview}
                        alt={`Foto ${index + 1}`}
                        width={96}
                        height={72}
                        className="aspect-[4/3] w-24 rounded-xl object-cover"
                      />
                    </li>
                  ) : null,
                )}
              </ul>
              <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
                {[
                  ["Judul", form.title],
                  ["Kategori", category?.name || "—"],
                  ["Nilai barang", form.itemValue ? rupiah(form.itemValue) : "—"],
                  ["Harga per hari", form.pricePerDay ? rupiah(form.pricePerDay) : "—"],
                  ["Deposit", form.deposit ? rupiah(form.deposit) : "—"],
                  ["Durasi", `${form.minDays}–${form.maxDays} hari`],
                  ["Titik serah terima", chosenPoints.map((point) => point.name).join(", ") || "—"],
                ].map(([label, value]) => (
                  <div key={label} className="min-w-0">
                    <dt className="text-xs text-muted-foreground">{label}</dt>
                    <dd className="mt-0.5 font-semibold break-words">{value}</dd>
                  </div>
                ))}
              </dl>
              <h3 className="mt-6 mb-2 text-sm">Deskripsi kondisi</h3>
              <p className="text-sm leading-6 whitespace-pre-line text-muted-foreground">
                {form.description}
              </p>
              {form.pricePerDay && form.deposit ? (
                <CostSummary
                  pricePerDay={form.pricePerDay}
                  days={form.minDays}
                  deposit={form.deposit}
                  className="mt-6 rounded-xl bg-[var(--color-accent-soft)] p-4"
                />
              ) : null}
              <p className="notice mt-5 flex items-start gap-2">
                <UserRound size={17} className="mt-0.5 shrink-0" aria-hidden />
                {!edit
                  ? `Admin meninjau listing sebelum tampil, dengan target ${rules.listing_sla_hours} jam.`
                  : edit.status === "menunggu_review"
                    ? "Listing ini masih menunggu review. Perubahanmu ikut diperiksa admin."
                    : edit.status === "ditolak"
                      ? `Listing dikirim ulang untuk ditinjau admin, dengan target ${rules.listing_sla_hours} jam.`
                      : reviewAgain
                        ? `Perubahan judul, foto, atau kategori ditinjau ulang admin (target ${rules.listing_sla_hours} jam) sebelum listing tampil lagi.`
                        : "Perubahan harga, deposit, durasi, dan titik langsung berlaku tanpa review."}
              </p>
            </div>
          )}
          {submitError && (
            <p className="notice notice-error mt-5" role="alert">
              {submitError}
            </p>
          )}
          <div className="mt-7 flex items-center justify-between gap-3 border-t border-border pt-5">
            {step > 0 ? (
              <Button variant="outline" onClick={() => show(step - 1)} disabled={busy}>
                <ArrowLeft size={16} />
                Kembali
              </Button>
            ) : (
              <span />
            )}
            {step < STEPS.length - 1 ? (
              <Button onClick={nextStep}>
                {step === STEPS.length - 2 ? "Lihat pratinjau" : "Lanjut"}
                <ArrowRight size={16} />
              </Button>
            ) : (
              <Button onClick={() => void submit()} disabled={busy}>
                {busy && <LoaderCircle size={16} className="animate-spin" />}
                {busy ? "Mengirim…" : edit ? "Simpan perubahan" : "Kirim untuk ditinjau"}
              </Button>
            )}
          </div>
        </Card>
        <aside
          className="hidden min-w-0 lg:sticky lg:top-24 lg:block lg:self-start"
          aria-label="Pratinjau kartu"
        >
          <p className="mb-2 text-xs font-bold tracking-widest text-muted-foreground uppercase">
            Pratinjau kartu
          </p>
          {edit && (
            <div className="mb-3">
              <ItemStatusChip status={edit.status} />
            </div>
          )}
          {preview}
        </aside>
      </div>
    </div>
  );
}
