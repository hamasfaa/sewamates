import Link from "next/link";
import Form from "next/form";
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
  HeartHandshake,
  Search,
  PackagePlus,
  TrendingUp,
} from "lucide-react";
import { getDb } from "@/src/db";
import { currentSession } from "@/src/lib/auth";
import { homeFeed, type ItemCardData } from "@/src/services/search-service";
import { Button } from "@/src/components/ui/button";
import { Card } from "@/src/components/ui/card";
import { ItemCard } from "@/src/components/item-card";
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
// Horizontal on phones (03 §3), a 3–4 column grid from 1024 px (03 §2.1).
function Shelf({
  id,
  title,
  icon: Icon,
  href,
  items,
}: {
  id: string;
  title: string;
  icon: typeof Sparkles;
  href: string;
  items: ItemCardData[];
}) {
  return (
    <section className="mt-10" aria-labelledby={id}>
      <div className="mb-4 flex items-end justify-between gap-4">
        <h2 id={id} className="flex items-center gap-2 text-xl sm:text-2xl">
          <Icon size={22} className="text-primary" aria-hidden />
          {title}
        </h2>
        <Link
          href={href}
          className="inline-flex min-h-11 items-center gap-1 text-sm font-bold text-primary"
        >
          Lihat semua
          <ArrowRight size={15} />
        </Link>
      </div>
      <ul className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2 [scrollbar-width:none] sm:gap-4 lg:mx-0 lg:grid lg:grid-cols-3 lg:overflow-visible lg:px-0 xl:grid-cols-4">
        {items.map((item) => (
          <li key={item.id} className="flex w-[44%] shrink-0 snap-start sm:w-[31%] lg:w-auto">
            <ItemCard item={item} className="w-full" />
          </li>
        ))}
      </ul>
    </section>
  );
}
export default async function HomePage() {
  const session = await currentSession();
  // The landing page still renders before the database is configured (README).
  const feed = process.env.DATABASE_URL ? await homeFeed(getDb()) : null;
  const ready = session?.user.verificationStatus === "terverifikasi";
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
          <Form action="/cari" role="search" className="mt-6 flex max-w-md gap-2">
            <div className="relative min-w-0 flex-1">
              <Search
                size={18}
                className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <input
                type="search"
                name="q"
                aria-label="Cari barang"
                maxLength={100}
                placeholder="Kamera, tenda, buku…"
                className="min-h-12 w-full rounded-full border-0 bg-white pr-4 pl-11 text-sm text-foreground outline-none focus:ring-4 focus:ring-[var(--color-sky)]"
              />
            </div>
            <Button type="submit" variant="accent" className="min-h-12 shrink-0">
              Cari
            </Button>
          </Form>
          <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-3">
            {session ? (
              <Button
                asChild
                variant="outline"
                className="border-white/30 bg-white/10 text-white hover:bg-white/20"
              >
                <Link href="/sewakan">
                  <PackagePlus size={18} />
                  Sewakan barang
                </Link>
              </Button>
            ) : (
              <Button asChild variant="accent" size="lg">
                <Link href="/masuk">
                  Yuk, kenalan dulu
                  <ArrowRight size={18} />
                </Link>
              </Button>
            )}
            <span className="flex items-center gap-2 text-xs text-white/75">
              <ShieldCheck size={15} />
              Identitas terverifikasi. Transaksi lebih tenang.
            </span>
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
      {feed && feed.categories.length > 0 && (
        <nav
          aria-label="Kategori"
          className="-mx-4 mt-6 overflow-x-auto px-4 [scrollbar-width:none] lg:mx-0 lg:px-0"
        >
          <ul className="flex gap-2 pb-1 lg:flex-wrap">
            <li>
              <Link
                href="/cari"
                className="inline-flex min-h-11 items-center rounded-full bg-primary px-4 text-sm font-bold whitespace-nowrap text-primary-foreground"
              >
                Semua barang
              </Link>
            </li>
            {feed.categories.map((category) => (
              <li key={category.id}>
                <Link
                  href={`/cari?category=${category.id}`}
                  className="inline-flex min-h-11 items-center rounded-full border border-border bg-card px-4 text-sm font-bold whitespace-nowrap hover:border-primary hover:text-primary"
                >
                  {category.name}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}
      {feed && feed.newest.length > 0 && (
        <Shelf
          id="baru"
          title="Baru ditambahkan"
          icon={Sparkles}
          href="/cari?sort=terbaru"
          items={feed.newest}
        />
      )}
      {feed && feed.popular.length > 0 && (
        <Shelf
          id="populer"
          title="Paling sering disewa"
          icon={TrendingUp}
          href="/cari"
          items={feed.popular}
        />
      )}
      {feed && feed.newest.length === 0 && (
        <section className="mt-10 rounded-2xl border border-dashed border-border bg-card px-6 py-12 text-center">
          <PackagePlus size={40} className="mx-auto mb-4 text-primary" />
          <h2 className="text-xl">Belum ada barang</h2>
          <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
            Jadi yang pertama! Sewakan barang yang jarang dipakai ke teman satu kampus.
          </p>
          <Button asChild variant="accent" className="mt-5">
            <Link href="/sewakan">Sewakan barang pertamamu</Link>
          </Button>
        </section>
      )}
      <div className="my-7 mt-10 grid gap-4 sm:grid-cols-3">
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
      {!ready && (
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
      )}
      <section className="my-10 flex flex-col gap-5 rounded-2xl bg-[var(--color-navy)] p-6 text-white sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-4">
          <HeartHandshake className="mt-1 shrink-0 text-accent" size={29} />
          <div>
            <h2 className="text-lg">Barang menganggur? Bisa jadi cerita baru.</h2>
            <p className="mt-2 text-sm text-white/75">
              Pasang barangmu, admin meninjaunya, lalu teman kampus bisa langsung menemukannya.
            </p>
          </div>
        </div>
        <Button asChild variant="accent" className="shrink-0">
          <Link href="/sewakan">
            <PackagePlus size={18} />
            Sewakan barang
          </Link>
        </Button>
      </section>
    </div>
  );
}
