"use client";
import Link from "next/link";
import Form from "next/form";
import { usePathname } from "next/navigation";
import {
  Bell,
  Home,
  Search,
  Plus,
  ArrowLeftRight,
  UserRound,
  MessageCircle,
  ArrowUpRight,
  ShieldCheck,
} from "lucide-react";
import { useEffect } from "react";
import { NOTIFICATION_POLL_MS, useLiveApi } from "@/src/lib/live-api";
import { cn } from "@/src/lib/utils";
import { Button } from "./ui/button";
const nav = [
  { href: "/", label: "Beranda", icon: Home },
  { href: "/cari", label: "Cari", icon: Search },
  { href: "/sewakan", label: "Sewakan", icon: Plus },
  { href: "/transaksi", label: "Transaksi", icon: ArrowLeftRight },
  { href: "/profil", label: "Profil", icon: UserRound },
];
export function Wordmark() {
  return (
    <span className="inline-flex items-baseline text-2xl font-extrabold tracking-[-.06em] text-[var(--color-navy)]">
      Sewa<span className="text-primary">Mates</span>
      <span className="brand-dot" />
    </span>
  );
}
export function AppShell({
  children,
  user,
  botUsername,
}: {
  children: React.ReactNode;
  user: { name: string; role: string; telegramBlocked: boolean } | null;
  botUsername?: string;
}) {
  const pathname = usePathname(),
    notifications = useLiveApi<{ unread: number }>(
      user ? "/api/notifications" : null,
      NOTIFICATION_POLL_MS,
    ),
    unread = notifications.data?.unread ?? 0;
  // "/" focuses the visible search box (03 §2.1), unless the user is already typing.
  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (event.key !== "/" || event.ctrlKey || event.metaKey || event.altKey) return;
      if (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
        return;
      const box = [...document.querySelectorAll<HTMLInputElement>('input[name="q"]')].find(
        (input) => input.offsetParent !== null,
      );
      if (!box) return;
      event.preventDefault();
      box.focus();
    };
    document.addEventListener("keydown", focusSearch);
    return () => document.removeEventListener("keydown", focusSearch);
  }, []);
  const isAdmin = pathname.startsWith("/admin");
  return (
    <>
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:z-50 focus:rounded-xl focus:bg-card focus:p-4"
      >
        Lewati ke konten utama
      </a>
      <header className="sticky top-0 z-30 border-b border-border bg-card/95 backdrop-blur-md">
        <div className="page-container flex h-19 items-center justify-between gap-5">
          <Link href="/" aria-label="SewaMates, beranda">
            <Wordmark />
          </Link>
          <Form action="/cari" role="search" className="relative hidden min-w-0 flex-1 xl:block">
            <Search
              size={18}
              className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <input
              type="search"
              name="q"
              aria-label="Cari barang"
              aria-keyshortcuts="/"
              maxLength={100}
              placeholder="Mau pinjam apa hari ini?"
              className="min-h-11 w-full rounded-full border border-border bg-background pr-4 pl-11 text-sm outline-none focus:border-primary"
            />
          </Form>
          <nav aria-label="Navigasi utama" className="hidden items-center gap-1 lg:flex">
            <Link
              className={cn(
                "rounded-full px-4 py-3 text-sm font-bold",
                pathname === "/"
                  ? "text-primary bg-secondary"
                  : "text-muted-foreground hover:text-primary",
              )}
              href="/"
            >
              Beranda
            </Link>
            <Link
              className="rounded-full px-4 py-3 text-sm font-bold text-muted-foreground hover:text-primary"
              href="/transaksi"
            >
              Transaksi
            </Link>
          </nav>
          <div className="flex items-center gap-1 sm:gap-2">
            <Button variant="ghost" size="icon" className="hidden lg:inline-flex xl:hidden" asChild>
              <Link href="/cari" aria-label="Cari barang">
                <Search size={21} />
              </Link>
            </Button>
            <Button variant="ghost" size="icon" asChild>
              <Link href="/chat" aria-label="Chat">
                <MessageCircle size={21} />
              </Link>
            </Button>
            <Button variant="ghost" size="icon" asChild>
              <Link
                href="/notifikasi"
                aria-label={`Notifikasi${unread ? `, ${unread} belum dibaca` : ""}`}
                className="relative"
              >
                <Bell size={21} />
                {unread > 0 && (
                  <span className="absolute top-1 right-0 rounded-full bg-destructive px-1.5 text-[10px] leading-4 text-white">
                    {unread > 99 ? "99+" : unread}
                  </span>
                )}
              </Link>
            </Button>
            <Button variant="accent" className="hidden lg:inline-flex" asChild>
              <Link href="/sewakan">
                <Plus size={18} />
                Sewakan
              </Link>
            </Button>
            <Button variant="outline" className="hidden lg:inline-flex" asChild>
              <Link href={user ? "/profil" : "/masuk"}>
                {user ? <UserRound size={18} /> : null}
                {user ? user.name.split(" ")[0] || "Profil" : "Masuk"}
              </Link>
            </Button>
          </div>
        </div>
      </header>
      {user?.telegramBlocked && (
        <div className="bg-[var(--color-warning-bg)] px-5 py-3 text-center text-sm text-[var(--color-warning)]">
          Notifikasi Telegram mati.{" "}
          <a
            className="font-bold underline"
            href={`https://t.me/${botUsername || ""}`}
            target="_blank"
            rel="noreferrer"
          >
            Buka bot & tekan Start
          </a>
          <span className="ml-2">atau masuk lagi lewat Telegram.</span>
        </div>
      )}
      <main
        id="main-content"
        className={cn("min-h-[calc(100vh-76px)] pb-28 lg:pb-0", isAdmin && "bg-background")}
      >
        {children}
      </main>
      {!isAdmin && (
        <footer className="hidden border-t border-border bg-card py-7 lg:block">
          <div className="page-container flex items-center justify-between gap-4 text-sm text-muted-foreground">
            <div className="flex items-center gap-2">
              <ShieldCheck size={17} />
              Biar barang terpakai, kantong tetap santai.
            </div>
            <div className="flex items-center gap-6">
              <Link href="/ketentuan">Ketentuan</Link>
              <Link href="/privasi">Privasi</Link>
              <Link href="/masuk" className="inline-flex items-center gap-1">
                Kenalan dulu
                <ArrowUpRight size={14} />
              </Link>
            </div>
          </div>
        </footer>
      )}
      <nav
        aria-label="Navigasi seluler"
        className="fixed right-0 bottom-0 left-0 z-40 border-t border-border bg-card px-2 pb-[max(env(safe-area-inset-bottom),8px)] pt-2 lg:hidden"
      >
        <div className="mx-auto flex max-w-lg items-end justify-between">
          {nav.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              aria-current={pathname === href ? "page" : undefined}
              className={cn(
                "flex min-h-14 w-1/5 flex-col items-center justify-center gap-1 text-xs font-semibold",
                pathname === href ? "text-primary" : "text-muted-foreground",
              )}
            >
              <span
                className={cn(
                  "flex h-8 w-12 items-center justify-center rounded-full",
                  href === "/sewakan"
                    ? "-mt-5 h-12 w-12 border-4 border-card bg-accent text-accent-foreground shadow-md"
                    : pathname === href
                      ? "bg-secondary"
                      : "",
                )}
              >
                <Icon size={href === "/sewakan" ? 25 : 21} />
              </span>
              {label}
            </Link>
          ))}
        </div>
      </nav>
    </>
  );
}
