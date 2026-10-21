"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  UserRound,
  BadgeCheck,
  Wallet,
  MonitorSmartphone,
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
      <h1 className="mb-7 text-3xl">Profil & pengaturan</h1>
      <div className="grid gap-6 lg:grid-cols-[255px_1fr]">
        <aside>
          <nav
            aria-label="Menu profil"
            className="flex gap-2 overflow-x-auto rounded-2xl border border-border bg-card p-3 lg:flex-col"
          >
            {[
              { href: "/profil", label: "Profil saya", icon: UserRound },
              { href: "/profil/verifikasi", label: "Verifikasi identitas", icon: BadgeCheck },
              { href: "/profil/rekening", label: "Rekening pencairan", icon: Wallet },
              { href: "/profil/sesi", label: "Perangkat & sesi", icon: MonitorSmartphone },
              ...(admin ? [{ href: "/admin", label: "Panel admin", icon: Shield }] : []),
            ].map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                className={cn(
                  "flex min-h-12 shrink-0 items-center gap-3 rounded-xl px-3 py-3 text-sm font-semibold",
                  path === href
                    ? "bg-secondary text-primary"
                    : "text-muted-foreground hover:bg-background",
                )}
              >
                <Icon size={19} />
                {label}
                <ChevronRight className="ml-auto hidden lg:block" size={15} />
              </Link>
            ))}
            <Button
              onClick={logout}
              disabled={busy}
              variant="ghost"
              className="justify-start px-3 text-destructive"
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
