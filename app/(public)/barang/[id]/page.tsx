import { cache } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import { z } from "zod";
import {
  BadgeCheck,
  CalendarClock,
  ChevronRight,
  Clock3,
  MapPin,
  MessageSquareText,
  Star,
  UserRound,
} from "lucide-react";
import { getDb } from "@/src/db";
import { currentSession } from "@/src/lib/auth";
import { dateOnlyWib, rupiah } from "@/src/lib/utils";
import { wibDateKey } from "@/src/domain/availability";
import { itemDetail, unavailableDays } from "@/src/services/item-service";
import { ItemGallery } from "@/src/components/item-gallery";
import {
  AvailabilityCalendar,
  MobileRentBar,
  RentCard,
  type ViewerState,
} from "@/src/components/item-detail-panels";
import { Card } from "@/src/components/ui/card";
import { ItemStatusChip, VerificationChip } from "@/src/components/ui/status-chip";

const load = cache(async (id: string) => {
  if (!z.uuid().safeParse(id).success || !process.env.DATABASE_URL) return null;
  const session = await currentSession();
  const detail = await itemDetail(getDb(), id, session?.user ?? null);
  return detail ? { detail, viewer: session?.user ?? null } : null;
});
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const data = await load((await params).id);
  if (!data) return { title: "Barang tidak ditemukan" };
  const { detail } = data;
  return {
    title: detail.title,
    description: `${rupiah(detail.pricePerDay)}/hari di ${detail.campus.name}. Sewa dari teman kampus yang terverifikasi.`,
  };
}
const ownerNotes: Record<string, string> = {
  menunggu_review: "Listing ini sedang ditinjau admin dan belum tampil di pencarian.",
  ditolak: "Listing ini ditolak admin. Perbaiki lalu kirim ulang.",
  dijeda: "Listing ini sedang dijeda dan tidak tampil di pencarian.",
  diarsipkan: "Listing ini sudah diarsipkan.",
  aktif: "Listing ini belum tampil karena kategori atau titik serah terima tidak aktif lagi.",
};
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await load(id);
  if (!data) notFound();
  const { detail, viewer } = data;
  const today = wibDateKey(new Date());
  const unavailable = await unavailableDays(getDb(), id, today.slice(0, 7));
  const state: ViewerState = detail.viewer.isOwner
    ? "owner"
    : !viewer
      ? "guest"
      : viewer.verificationStatus === "terverifikasi"
        ? "verified"
        : "unverified";
  const facts = [
    { label: "Deposit", value: rupiah(detail.deposit), help: "Dikembalikan" },
    { label: "Nilai barang", value: rupiah(detail.itemValue), help: "Perkiraan pemilik" },
    {
      label: "Durasi",
      value: `${detail.minDays}–${detail.maxDays} hari`,
      help: "Minimal–maksimal",
    },
  ];
  return (
    <div className="page-container py-5 pb-44 lg:py-10 lg:pb-12">
      {!detail.publiclyVisible && (
        <div className="notice mb-5 flex flex-wrap items-center gap-3" role="status">
          <ItemStatusChip status={detail.status} />
          <span>
            {detail.viewer.isOwner
              ? ownerNotes[detail.status]
              : "Pratinjau admin: listing ini tidak tampil untuk publik."}
            {detail.rejectReason && (
              <strong className="block">Alasan: {detail.rejectReason}</strong>
            )}
          </span>
        </div>
      )}
      <nav
        aria-label="Jejak halaman"
        className="mb-4 flex items-center gap-1 text-xs text-muted-foreground"
      >
        <Link href="/" className="hover:text-primary">
          Beranda
        </Link>
        <ChevronRight size={14} aria-hidden />
        <Link href={`/cari?category=${detail.category.id}`} className="truncate hover:text-primary">
          {detail.category.name}
        </Link>
      </nav>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px] lg:gap-x-10">
        <div className="min-w-0 lg:col-start-1">
          <ItemGallery photos={detail.photos} title={detail.title} />
          <h1 className="mt-5 text-2xl sm:text-3xl">{detail.title}</h1>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
            <span className="flex items-center gap-1">
              <Star size={16} className="fill-accent text-accent" aria-hidden />
              {detail.ratingCount
                ? `${(detail.ratingAvg / 100).toFixed(1)} · ${detail.ratingCount} ulasan`
                : "Belum ada ulasan"}
            </span>
            <span className="flex items-center gap-1">
              <MapPin size={16} aria-hidden />
              {detail.campus.name}
            </span>
          </div>
          {/* Rows on phones so full amounts fit at 360 px; three boxes from 640 px. */}
          <dl className="mt-5 divide-y divide-border rounded-2xl border border-border bg-card sm:grid sm:grid-cols-3 sm:gap-3 sm:divide-y-0 sm:border-0 sm:bg-transparent">
            {facts.map((fact) => (
              <div
                key={fact.label}
                className="flex min-w-0 items-center justify-between gap-3 px-4 py-3 sm:block sm:rounded-2xl sm:border sm:border-border sm:bg-card sm:p-4"
              >
                <dt className="text-sm text-muted-foreground sm:text-xs">{fact.label}</dt>
                <dd className="tabular text-sm font-extrabold sm:mt-1 sm:text-base">
                  {fact.value}
                </dd>
                <dd className="mt-0.5 hidden text-xs text-muted-foreground sm:block">
                  {fact.help}
                </dd>
              </div>
            ))}
          </dl>
        </div>
        <aside className="min-w-0 lg:sticky lg:top-24 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:self-start">
          <RentCard
            itemId={detail.id}
            pricePerDay={detail.pricePerDay}
            deposit={detail.deposit}
            minDays={detail.minDays}
            maxDays={detail.maxDays}
            viewer={state}
          />
        </aside>
        <div className="min-w-0 space-y-6 lg:col-start-1">
          <section>
            <h2 className="mb-3 text-lg">Kondisi barang</h2>
            <p className="text-sm leading-7 whitespace-pre-line text-muted-foreground">
              {detail.description}
            </p>
          </section>
          <section>
            <h2 className="mb-3 text-lg">Titik serah terima</h2>
            <ul className="grid gap-3 sm:grid-cols-2">
              {detail.pickupPoints.map((point) => (
                <li key={point.id} className="rounded-2xl border border-border bg-card p-4">
                  <p className="flex items-center gap-2 text-sm font-bold">
                    <MapPin size={16} className="shrink-0 text-primary" aria-hidden />
                    {point.name}
                    {!point.active && (
                      <span className="text-xs font-semibold text-destructive">(nonaktif)</span>
                    )}
                  </p>
                  {point.description && (
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      {point.description}
                    </p>
                  )}
                  <p className="mt-2 flex items-start gap-1.5 text-xs text-muted-foreground">
                    <Clock3 size={14} className="mt-0.5 shrink-0" aria-hidden />
                    <span>{point.hoursSummary.join(" · ")} WIB</span>
                  </p>
                </li>
              ))}
            </ul>
          </section>
          <section>
            <h2 className="mb-1 text-lg">Kalender ketersediaan</h2>
            <p className="mb-4 flex items-center gap-1.5 text-xs text-muted-foreground">
              <CalendarClock size={14} aria-hidden />
              Tanggal yang diblokir pemilik tidak bisa dipilih saat mengajukan sewa.
            </p>
            <Card className="p-4 sm:p-5">
              <AvailabilityCalendar
                itemId={detail.id}
                today={today}
                initialUnavailable={unavailable}
              />
            </Card>
          </section>
          <section>
            <h2 className="mb-3 text-lg">Pemilik barang</h2>
            <Link
              href={`/pengguna/${detail.owner.id}`}
              className="flex items-center gap-4 rounded-2xl border border-border bg-card p-4 hover:shadow-md"
            >
              {detail.owner.avatarUrl ? (
                <Image
                  unoptimized
                  src={detail.owner.avatarUrl}
                  alt={`Foto ${detail.owner.name}`}
                  width={56}
                  height={56}
                  className="size-14 shrink-0 rounded-full object-cover"
                />
              ) : (
                <span className="flex size-14 shrink-0 items-center justify-center rounded-full bg-secondary text-primary">
                  <UserRound size={26} aria-hidden />
                </span>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate font-bold">{detail.owner.name || "Teman SewaMates"}</p>
                <div className="mt-1.5">
                  <VerificationChip status={detail.owner.verificationStatus} />
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  {detail.owner.ratingCount
                    ? `${(detail.owner.ratingAvg / 100).toFixed(1)} rating · `
                    : ""}
                  {detail.owner.completedCount} transaksi selesai · Bergabung{" "}
                  {dateOnlyWib(detail.owner.createdAt)}
                </p>
              </div>
              <ChevronRight size={18} className="shrink-0 text-muted-foreground" aria-hidden />
            </Link>
          </section>
          <section>
            <h2 className="mb-3 text-lg">Ulasan</h2>
            <div className="flex items-center gap-3 rounded-2xl border border-dashed border-border p-5 text-sm text-muted-foreground">
              <MessageSquareText size={22} className="shrink-0 text-primary" aria-hidden />
              Belum ada ulasan untuk barang ini. Ulasan muncul setelah transaksi selesai.
            </div>
          </section>
          {detail.owner.verificationStatus === "terverifikasi" && (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <BadgeCheck size={16} className="text-[var(--color-success)]" aria-hidden />
              Identitas pemilik sudah diperiksa admin SewaMates.
            </p>
          )}
        </div>
      </div>
      <MobileRentBar itemId={detail.id} pricePerDay={detail.pricePerDay} viewer={state} />
    </div>
  );
}
