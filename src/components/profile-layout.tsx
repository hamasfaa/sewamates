"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  UserRound,
  BadgeCheck,
  Wallet,
  MonitorSmartphone,
  Package,
  Shield,
  LogOut,
  ChevronRight,
} from "lucide-react";
import { useState } from "react";
import { api } from "@/src/lib/client-api";
import { cn } from "@/src/lib/utils";
import { Button } from "./ui/button";
export function ProfileLayout({ children, admin }: { children: React.ReactNode; admin: boolean }) {
  const path = usePathname(),
    router = useRouter(),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function logout() {
    setBusy(true);
    try {
      await api("/api/auth/logout", { method: "POST", body: "{}" });
      router.replace("/masuk");
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <div className="page-container py-7 lg:py-10">
      <p className="mb-2 text-xs font-bold tracking-widest text-primary uppercase">
        Akun SewaMates
      </p>
      <h1 className="mb-5 text-2xl sm:mb-7 sm:text-3xl">Profil & pengaturan</h1>
      <div className="grid min-w-0 grid-cols-1 gap-5 lg:grid-cols-[255px_minmax(0,1fr)] lg:gap-6">
        <aside className="min-w-0">
          <nav
            aria-label="Menu profil"
            className="grid grid-cols-2 gap-2 rounded-2xl border border-border bg-card p-2 md:grid-cols-3 lg:flex lg:flex-col lg:p-3"
          >
            {[
              { href: "/profil", label: "Profil saya", icon: UserRound },
              { href: "/profil/verifikasi", label: "Verifikasi identitas", icon: BadgeCheck },
              { href: "/profil/rekening", label: "Rekening pencairan", icon: Wallet },
              { href: "/profil/listing", label: "Listing saya", icon: Package },
              { href: "/profil/sesi", label: "Perangkat & sesi", icon: MonitorSmartphone },
              { href: "/profil/privasi", label: "Privasi akun", icon: Shield },
              ...(admin ? [{ href: "/admin", label: "Panel admin", icon: Shield }] : []),
            ].map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                aria-current={path === href ? "page" : undefined}
                className={cn(
                  "flex min-h-12 min-w-0 items-center gap-2 rounded-xl px-3 py-3 text-sm font-semibold",
                  path === href
                    ? "bg-secondary text-primary"
                    : "text-muted-foreground hover:bg-background",
                )}
              >
                <Icon size={19} className="shrink-0" />
                <span className="min-w-0 break-words">{label}</span>
                <ChevronRight className="ml-auto hidden shrink-0 lg:block" size={15} />
              </Link>
            ))}
            <Button
              onClick={logout}
              disabled={busy}
              variant="ghost"
              className="min-w-0 justify-start rounded-xl px-3 text-destructive"
            >
              <LogOut size={18} />
              {busy ? "Keluar…" : "Keluar"}
            </Button>
          </nav>
          {error && (
            <p className="notice notice-error mt-3" role="alert">
              {error}
            </p>
          )}
        </aside>
        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}
