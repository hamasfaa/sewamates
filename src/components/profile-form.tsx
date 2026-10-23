"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { UserRound, ArrowRight, LoaderCircle, ExternalLink } from "lucide-react";
import { api, useApi } from "@/src/lib/client-api";
import type { myProfile } from "@/src/services/profile-service";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Card } from "./ui/card";
import { VerificationChip } from "./ui/status-chip";
import { PhotoUpload } from "./photo-upload";
import { CampusSelect } from "./campus-select";
import type { CampusOption } from "@/src/domain/campuses";
export type ProfileData = Awaited<ReturnType<typeof myProfile>>;
export function ProfileForm({ onboarding = false }: { onboarding?: boolean }) {
  const profile = useApi<ProfileData>("/api/me"),
    campuses = useApi<CampusOption[]>("/api/campuses");
  if (profile.error || campuses.error)
    return (
      <p className="notice notice-error" role="alert">
        {profile.error || campuses.error}
      </p>
    );
  if (!profile.data || !campuses.data)
    return (
      <div className="skeleton h-80" role="status">
        <span className="sr-only">Memuat profil…</span>
      </div>
    );
  const previousCampus = profile.data.campus;
  const choices =
    previousCampus && !campuses.data.some((campus) => campus.id === previousCampus.id)
      ? [previousCampus, ...campuses.data]
      : campuses.data;
  return (
    <ProfileFields
      key={profile.data.user.id}
      profile={profile.data}
      campuses={choices}
      onboarding={onboarding}
    />
  );
}
function ProfileFields({
  profile,
  campuses,
  onboarding,
}: {
  profile: ProfileData;
  campuses: CampusOption[];
  onboarding: boolean;
}) {
  const router = useRouter(),
    [name, setName] = useState(profile.user.name),
    [campus, setCampus] = useState(profile.user.campusId || ""),
    [accepted, setAccepted] = useState(false),
    [avatar, setAvatar] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [saved, setSaved] = useState(false);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      await api("/api/me", {
        method: "PATCH",
        body: JSON.stringify({
          name,
          campusId: campus,
          ...(!profile.user.termsAcceptedAt ? { acceptTerms: accepted } : {}),
          ...(avatar ? { avatarPath: avatar } : {}),
        }),
      });
      if (onboarding) router.replace("/profil/verifikasi");
      else setSaved(true);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card className="min-w-0 p-4 sm:p-6">
      {profile.user.accountStatus === "ditangguhkan" && (
        <p className="notice notice-error mb-5" role="status">
          Akunmu ditangguhkan. {profile.user.suspensionReason} Pengajuan dan listing baru dibatasi.
          Selesaikan transaksi yang sudah disetujui melalui halaman Transaksi.
        </p>
      )}
      <div className="mb-6 flex flex-col items-start gap-3 sm:flex-row sm:justify-between">
        <div className="min-w-0">
          <span className="mb-4 inline-flex rounded-2xl bg-secondary p-3 text-primary">
            <UserRound size={25} />
          </span>
          <h2 className="text-2xl">{onboarding ? "Kenalan dulu, yuk" : "Profil saya"}</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            {onboarding
              ? "Biar teman kampus tahu dengan siapa mereka bertransaksi."
              : "Informasi dasar untuk teman transaksimu."}
          </p>
        </div>
        <VerificationChip status={profile.user.verificationStatus} />
      </div>
      <form onSubmit={submit} className="form-stack">
        <div>
          <label htmlFor="name" className="field-label">
            Nama lengkap sesuai kartu identitas
          </label>
          <Input
            id="name"
            name="name"
            autoComplete="name"
            value={name}
            minLength={3}
            maxLength={100}
            required
            onChange={(e) => setName(e.target.value)}
            disabled={profile.user.verificationStatus === "menunggu"}
          />
          <p className="help">Mengubah nama setelah terverifikasi membutuhkan verifikasi ulang.</p>
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          <div className="min-w-0">
            <label className="field-label" htmlFor="phone">
              Nomor HP terverifikasi
            </label>
            <Input id="phone" value={profile.user.phone} readOnly disabled />
            <p className="help">Hanya kamu dan admin yang bisa melihat nomor ini.</p>
          </div>
          <CampusSelect campuses={campuses} value={campus} onChange={setCampus} />
        </div>
        {!onboarding && (
          <details className="rounded-xl border border-border p-4">
            <summary className="cursor-pointer text-sm font-semibold">
              Ganti foto profil (opsional)
            </summary>
            <div className="mt-4">
              <PhotoUpload label="Foto profil" purpose="avatar" onUploaded={setAvatar} />
            </div>
          </details>
        )}
        {!profile.user.termsAcceptedAt && (
          <label className="flex items-start gap-3 rounded-xl bg-background p-4 text-sm">
            <input
              type="checkbox"
              className="mt-1 size-5 shrink-0 accent-primary"
              required
              checked={accepted}
              onChange={(e) => setAccepted(e.target.checked)}
            />
            <span>
              Saya menyetujui{" "}
              <Link
                className="font-semibold text-primary underline"
                href="/ketentuan"
                target="_blank"
              >
                ketentuan
              </Link>{" "}
              dan{" "}
              <Link
                className="font-semibold text-primary underline"
                href="/privasi"
                target="_blank"
              >
                kebijakan privasi
              </Link>{" "}
              SewaMates.
            </span>
          </label>
        )}
        {error && (
          <p className="notice notice-error" role="alert">
            {error}
          </p>
        )}
        {saved && (
          <p className="notice notice-success" role="status">
            Profil berhasil disimpan.
          </p>
        )}
        <div className="flex flex-col items-stretch gap-3 border-t border-border pt-5 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <Button disabled={busy} type="submit" className="w-full sm:w-auto">
            {busy ? <LoaderCircle size={17} className="animate-spin" /> : null}
            {onboarding ? "Lanjut verifikasi" : "Simpan profil"}
            <ArrowRight size={17} />
          </Button>
          {!onboarding && (
            <Link
              href={`/pengguna/${profile.user.id}`}
              className="inline-flex min-h-11 items-center justify-center gap-1 text-sm font-bold text-primary sm:min-h-0 sm:justify-start"
            >
              Lihat profil publik
              <ExternalLink size={14} />
            </Link>
          )}
        </div>
      </form>
    </Card>
  );
}
