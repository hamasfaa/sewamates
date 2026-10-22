"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  BadgeCheck,
  PackageSearch,
  ScrollText,
  Settings2,
  Shield,
  ArrowUpRight,
  Wallet,
} from "lucide-react";
import { cn } from "@/src/lib/utils";
import { useLiveApi, type Wire } from "@/src/lib/live-api";
import type { adminSummary } from "@/src/services/admin-service";
export function AdminLayout({
  children,
  superAdmin,
}: {
  children: React.ReactNode;
  superAdmin: boolean;
}) {
  const pathname = usePathname();
  const summary = useLiveApi<Wire<Awaited<ReturnType<typeof adminSummary>>>>(
    "/api/admin/summary",
    5000,
  );
  return (
    <div className="page-container grid gap-6 py-7 lg:grid-cols-[225px_1fr] lg:py-10">
      {/* min-w-0 keeps the horizontally scrolling menu inside narrow screens. */}
      <aside className="min-w-0">
        <div className="mb-5 flex items-center gap-3 px-2">
          <span className="rounded-xl bg-primary p-2 text-white">
            <Shield size={20} />
          </span>
          <div>
            <p className="text-sm font-extrabold">Ruang admin</p>
            <p className="text-xs text-muted-foreground">
              {superAdmin ? "Super admin" : "Admin"} SewaMates
            </p>
          </div>
        </div>
        <nav aria-label="Menu admin" className="flex gap-2 overflow-x-auto lg:flex-col">
          {[
            { href: "/admin", label: "Ringkasan", icon: LayoutDashboard, count: undefined },
            {
              href: "/admin/verifikasi",
              label: "Verifikasi identitas",
              icon: BadgeCheck,
              count: summary.data?.pending,
            },
            {
              href: "/admin/listing",
              label: "Moderasi listing",
              icon: PackageSearch,
              count: summary.data?.listingsPending,
            },
            {
              href: "/admin/pembayaran",
              label: "Pembayaran",
              icon: Wallet,
              count: summary.data?.paymentsPending,
            },
            { href: "/admin/audit", label: "Audit log", icon: ScrollText, count: undefined },
            ...(superAdmin
              ? [
                  {
                    href: "/admin/pengaturan",
                    label: "Pengaturan",
                    icon: Settings2,
                    count: undefined,
                  },
                ]
              : []),
          ].map(({ href, label, icon: Icon, count }) => (
            <Link
              key={href}
              href={href}
              aria-current={pathname === href ? "page" : undefined}
              aria-label={count ? `${label}, ${count} menunggu` : label}
              className={cn(
                "flex min-h-12 shrink-0 items-center gap-3 rounded-xl px-4 text-sm font-semibold",
                pathname === href ||
                  (href === "/admin/pengaturan" && pathname.startsWith(`${href}/`))
                  ? "bg-primary text-white"
                  : "text-muted-foreground hover:bg-card",
              )}
            >
              <Icon size={18} />
              {label}
              {count !== undefined && count > 0 && (
                <span
                  aria-hidden="true"
                  className="tabular ml-auto rounded-full bg-secondary px-2 py-0.5 text-xs font-bold text-primary"
                >
                  {count}
                </span>
              )}
            </Link>
          ))}
        </nav>
        <Link
          className="mt-6 hidden items-center gap-2 px-4 text-xs text-muted-foreground lg:flex"
          href="/profil"
        >
          Kembali ke profil
          <ArrowUpRight size={14} />
        </Link>
      </aside>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
