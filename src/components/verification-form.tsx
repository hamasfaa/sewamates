"use client";
import { useState } from "react";
import {
  BadgeCheck,
  Clock3,
  ArrowRight,
  ArrowLeft,
  CreditCard,
  Camera,
  CircleCheck,
} from "lucide-react";
import { api, useApi } from "@/src/lib/client-api";
import type { ProfileData } from "./profile-form";
import { PhotoUpload } from "./photo-upload";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { VerificationChip } from "./ui/status-chip";
export function VerificationForm() {
  const profile = useApi<ProfileData>("/api/me"),
    [step, setStep] = useState(0),
    [type, setType] = useState<"ktm" | "ktp">("ktm"),
    [card, setCard] = useState(""),
    [selfie, setSelfie] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function submit() {
    setBusy(true);
    setError("");
    try {
      await api("/api/me/verification", {
        method: "POST",
        body: JSON.stringify({ cardType: type, cardPhotoPath: card, selfiePath: selfie }),
      });
      profile.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (profile.error)
    return (
      <p className="notice notice-error" role="alert">
        {profile.error}
      </p>
    );
  if (!profile.data)
    return (
      <div className="skeleton h-80" role="status">
        <span className="sr-only">Memuat status verifikasi…</span>
      </div>
    );
  const status = profile.data.user.verificationStatus;
  return (
    <Card className="min-w-0 p-4 sm:p-6">
      <div className="mb-6 flex flex-col items-start gap-3 sm:flex-row sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-2xl">Bikin saling percaya</h2>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            Verifikasi identitasmu sebelum mulai menyewa dan menyewakan.
          </p>
        </div>
        <VerificationChip status={status} />
      </div>
      {status === "terverifikasi" ? (
        <div className="rounded-2xl bg-[var(--color-success-bg)] p-8 text-center">
          <BadgeCheck size={45} className="mx-auto mb-4 text-[var(--color-success)]" />
          <h3 className="text-xl">Kamu sudah terverifikasi!</h3>
          <p className="mt-3 text-sm text-muted-foreground">
            Terima kasih sudah membantu menjaga komunitas tetap aman.
          </p>
        </div>
      ) : status === "menunggu" ? (
        <div className="rounded-2xl bg-[var(--color-warning-bg)] p-8 text-center">
          <Clock3 size={40} className="mx-auto mb-4 text-[var(--color-warning)]" />
          <h3 className="text-xl">Identitasmu sedang ditinjau</h3>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            Admin memeriksa kartu dan selfie kamu dengan target 24 jam. Hasilnya akan muncul di
            notifikasi.
          </p>
        </div>
      ) : (
        <>
          {status === "ditolak" && (
            <p className="notice notice-error mb-6" role="alert">
              <strong>Foto perlu diperbaiki.</strong> {profile.data.verification?.rejectReason} Kamu
              bisa mengajukan ulang.
            </p>
          )}
          <ol className="mb-7 flex gap-2" aria-label="Tahap verifikasi">
            {["Jenis kartu", "Foto kartu", "Selfie"].map((label, i) => (
              <li
                key={label}
                className="flex flex-1 flex-col gap-2 text-xs font-semibold"
                aria-current={i === step ? "step" : undefined}
              >
                <span className={`h-1 rounded-full ${i <= step ? "bg-primary" : "bg-border"}`} />
                <span className={i <= step ? "text-primary" : "text-muted-foreground"}>
                  {i + 1}. {label}
                </span>
              </li>
            ))}
          </ol>
          {step === 0 && (
            <fieldset>
              <legend className="mb-4 text-sm font-bold">
                Pilih kartu identitas yang akan kamu pakai
              </legend>
              <div className="grid gap-3 sm:grid-cols-2">
                {[
                  { value: "ktm", label: "Kartu mahasiswa", help: "KTM dari kampusmu" },
                  { value: "ktp", label: "Kartu penduduk", help: "KTP yang masih berlaku" },
                ].map((option) => (
                  <label
                    key={option.value}
                    className={`flex cursor-pointer items-start gap-3 rounded-2xl border p-5 ${type === option.value ? "border-primary bg-secondary" : "border-border"}`}
                  >
                    <input
                      type="radio"
                      name="cardType"
                      checked={type === option.value}
                      onChange={() => setType(option.value as "ktm" | "ktp")}
                      className="mt-1 size-4 accent-primary"
                    />
                    <div>
                      <CreditCard size={23} className="mb-3 text-primary" />
                      <p className="text-sm font-bold">{option.label}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{option.help}</p>
                    </div>
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          {step === 1 && (
            <>
              <div className="notice mb-4 flex items-start gap-2">
                <CircleCheck size={20} className="shrink-0" />
                Benar: kartu utuh, tulisan terbaca, dan cahaya terang. Hindari foto buram,
                terpotong, atau pantulan cahaya.
              </div>
              <PhotoUpload
                label={`Foto ${type.toUpperCase()}`}
                purpose="identity_card"
                onUploaded={setCard}
              />
            </>
          )}
          {step === 2 && (
            <>
              <div className="notice mb-4 flex items-start gap-2">
                <Camera size={20} className="shrink-0" />
                Selfie sambil memegang kartu di samping wajah. Pastikan wajah dan informasi kartu
                terlihat jelas.
              </div>
              <PhotoUpload
                label="Selfie memegang kartu"
                purpose="identity_selfie"
                onUploaded={setSelfie}
              />
            </>
          )}
          {error && (
            <p className="notice notice-error mt-5" role="alert">
              {error}
            </p>
          )}
          <div className="mt-7 flex items-center justify-between gap-3 border-t border-border pt-5">
            {step > 0 ? (
              <Button variant="outline" onClick={() => setStep((v) => v - 1)} disabled={busy}>
                <ArrowLeft size={16} />
                Kembali
              </Button>
            ) : (
              <span />
            )}
            <Button
              disabled={busy || (step === 1 && !card) || (step === 2 && (!card || !selfie))}
              onClick={() => (step === 2 ? void submit() : setStep((v) => v + 1))}
            >
              {busy
                ? "Mengirim…"
                : step === 2
                  ? status === "ditolak"
                    ? "Ajukan ulang"
                    : "Kirim verifikasi"
                  : "Lanjut"}
              <ArrowRight size={16} />
            </Button>
          </div>
        </>
      )}
      <p className="mt-6 border-t border-border pt-5 text-xs leading-5 text-muted-foreground">
        Foto identitas hanya dapat dilihat oleh admin untuk pemeriksaan. Foto tidak tampil di profil
        publik.
      </p>
    </Card>
  );
}
