import Link from "next/link";
import {
  ArrowRight,
  ShieldCheck,
  MapPin,
  Sparkles,
  Camera,
  Gamepad2,
  Backpack,
  BadgeCheck,
  Wallet,
  UserRound,
  Check,
  HeartHandshake,
} from "lucide-react";
import { Button } from "@/src/components/ui/button";
import { Card } from "@/src/components/ui/card";
const steps = [
  {
    icon: UserRound,
    title: "Kenalan dulu",
    text: "Masuk lewat Telegram, lalu lengkapi profilmu.",
    href: "/profil",
    number: "01",
  },
  {
    icon: BadgeCheck,
    title: "Bikin saling percaya",
    text: "Verifikasi identitas dengan kartu mahasiswa atau KTP.",
    href: "/profil/verifikasi",
    number: "02",
  },
  {
    icon: Wallet,
    title: "Siapkan rekeningmu",
    text: "Biar pengembalian deposit dan pencairan lebih mudah.",
    href: "/profil/rekening",
    number: "03",
  },
];
export default function HomePage() {
  return (
    <div className="page-container py-6 lg:py-10">
      <div className="mb-6 flex items-center gap-2 text-sm font-medium text-muted-foreground">
        <MapPin size={17} className="text-primary" />
        Dekat kampus. Dekat kamu.
        <span className="ml-auto hidden items-center gap-1.5 text-xs md:flex">
          <span className="h-2 w-2 rounded-full bg-[var(--color-success)]" />
          Komunitas mahasiswa
        </span>
      </div>
      <section className="hero relative grid overflow-hidden rounded-[24px] px-6 py-10 text-white md:px-10 lg:min-h-[390px] lg:grid-cols-[1.2fr_1fr] lg:px-12 lg:py-12">
        <div className="relative z-10 max-w-xl">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/10 px-3 py-1.5 text-xs font-semibold">
            <Sparkles size={14} className="text-accent" />
            Lebih banyak pengalaman, lebih hemat
          </div>
          <h1 className="text-[34px] leading-[1.15] sm:text-[44px] lg:text-[50px]">
            Nggak harus punya.
            <br />
            <span className="text-accent">Pinjam juga bisa.</span>
          </h1>
          <p className="mt-5 max-w-md text-sm leading-7 text-white/80 sm:text-base">
            Dari tugas kuliah sampai rencana akhir pekan. Temukan barang yang kamu butuhkan dari
            teman satu kampus.
          </p>
          <Button asChild variant="accent" size="lg" className="mt-7">
            <Link href="/masuk">
              Yuk, kenalan dulu
              <ArrowRight size={18} />
            </Link>
          </Button>
          <div className="mt-5 flex items-center gap-2 text-xs text-white/75">
            <ShieldCheck size={15} />
            Identitas terverifikasi. Transaksi lebih tenang.
          </div>
        </div>
        <div
          className="relative mt-10 hidden min-h-64 items-center justify-center sm:flex lg:mt-0"
          aria-hidden
        >
          <div className="absolute h-66 w-66 rounded-full border border-white/10 bg-white/5" />
          <div className="absolute h-86 w-86 rounded-full border border-white/10" />
          <div className="absolute top-3 left-5 rotate-[-12deg] rounded-2xl bg-[var(--color-sky-soft)] p-6 text-primary shadow-xl">
            <Camera size={64} strokeWidth={1.4} />
            <div className="mt-2 text-center text-xs font-bold">Bikin karya</div>
          </div>
          <div className="absolute right-1 top-18 rotate-[10deg] rounded-2xl bg-accent p-6 text-accent-foreground shadow-xl">
            <Gamepad2 size={68} strokeWidth={1.4} />
            <div className="mt-2 text-center text-xs font-bold">Lepas penat</div>
          </div>
          <div className="absolute bottom-0 left-24 rotate-[-4deg] rounded-2xl bg-white p-5 text-primary shadow-xl">
            <Backpack size={58} strokeWidth={1.4} />
            <div className="mt-2 text-center text-xs font-bold">Cari cerita</div>
          </div>
          <span className="absolute top-0 right-11 text-4xl text-accent">✦</span>
          <span className="absolute bottom-6 left-3 text-2xl text-[var(--color-sky)]">✦</span>
        </div>
      </section>
      <div className="my-7 grid gap-4 sm:grid-cols-3">
        {[
          { icon: ShieldCheck, label: "Dana kamu aman", text: "Ditahan sampai barang kembali" },
          {
            icon: BadgeCheck,
            label: "Sama-sama terverifikasi",
            text: "Kenal siapa teman transaksimu",
          },
          { icon: MapPin, label: "Ketemuan di kampus", text: "Serah terima langsung, lebih dekat" },
        ].map(({ icon: Icon, label, text }) => (
          <div
            key={label}
            className="flex items-center gap-3 rounded-2xl border border-border bg-card px-4 py-4"
          >
            <span className="rounded-xl bg-secondary p-2.5 text-primary">
              <Icon size={23} />
            </span>
            <div>
              <p className="text-sm font-bold">{label}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{text}</p>
            </div>
          </div>
        ))}
      </div>
      <section className="mt-11">
        <div className="mb-6 flex items-end justify-between gap-4">
          <div>
            <p className="mb-2 text-xs font-bold tracking-[.14em] text-primary uppercase">
              Mulai dari sini
            </p>
            <h2 className="text-2xl sm:text-[28px]">Siap jadi teman pinjam?</h2>
            <p className="mt-3 text-sm text-muted-foreground">
              Tiga langkah kecil buat pengalaman sewa yang lebih nyaman.
            </p>
          </div>
          <span className="hidden rounded-full bg-accent px-4 py-2 text-xs font-bold sm:inline-flex">
            Gampang, kok!
          </span>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          {steps.map(({ icon: Icon, title, text, href, number }) => (
            <Link href={href} key={title} className="group">
              <Card className="h-full transition-shadow hover:shadow-lg">
                <div className="mb-6 flex items-center justify-between">
                  <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-secondary text-primary">
                    <Icon size={25} />
                  </span>
                  <span className="text-3xl font-extrabold text-border">{number}</span>
                </div>
                <h3 className="text-lg">{title}</h3>
                <p className="mt-3 text-sm leading-6 text-muted-foreground">{text}</p>
                <div className="mt-5 flex items-center gap-2 text-sm font-bold text-primary">
                  Mulai langkah ini
                  <ArrowRight
                    size={16}
                    className="transition-transform group-hover:translate-x-1"
                  />
                </div>
              </Card>
            </Link>
          ))}
        </div>
      </section>
      <section className="my-10 flex flex-col gap-5 rounded-2xl border border-border bg-[var(--color-sky-soft)] p-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-4">
          <HeartHandshake className="mt-1 shrink-0 text-primary" size={29} />
          <div>
            <h2 className="text-lg">Barang menganggur? Bisa jadi cerita baru.</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Etalase SewaMates sedang disiapkan. Lengkapi akunmu sambil menunggu.
            </p>
          </div>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1.5 text-sm font-bold text-primary">
          <Check size={17} />
          Lebih bijak, bareng-bareng
        </span>
      </section>
    </div>
  );
}
