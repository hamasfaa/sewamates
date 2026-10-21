"use client";
import { MonitorSmartphone, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, useApi } from "@/src/lib/client-api";
import { dateWib } from "@/src/lib/utils";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
export function SessionsList() {
  const router = useRouter(),
    query =
      useApi<
        { id: string; userAgent: string; lastSeenAt: string; expiresAt: string; current: boolean }[]
      >("/api/me/sessions"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState("");
  async function revoke(id: string, current: boolean) {
    setBusy(id);
    try {
      await api(`/api/me/sessions/${id}`, { method: "DELETE" });
      if (current) {
        router.replace("/masuk");
        router.refresh();
      } else query.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  return (
    <Card className="min-w-0 p-4 sm:p-6">
      <h2 className="text-2xl">Perangkat & sesi</h2>
      <p className="mt-3 mb-6 text-sm text-muted-foreground">
        Keluar dari perangkat yang sudah tidak kamu pakai atau tidak dikenali.
      </p>
      {(error || query.error) && (
        <p className="notice notice-error mb-5" role="alert">
          {error || query.error}
        </p>
      )}
      {query.loading && <div className="skeleton h-32" role="status" aria-label="Memuat sesi" />}
      <div className="divide-y divide-border">
        {query.data?.map((row) => (
          <article
            key={row.id}
            className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-3 py-5 sm:grid-cols-[auto_minmax(0,1fr)_auto]"
          >
            <MonitorSmartphone size={23} className="shrink-0 text-primary" />
            <div className="min-w-0 flex-1">
              <h3 className="text-sm">
                {row.userAgent?.includes("Mobile") ? "Browser di HP" : "Browser di komputer"}
                {row.current ? " · Perangkat ini" : ""}
              </h3>
              <p className="mt-2 break-all text-xs text-muted-foreground">
                {row.userAgent || "Perangkat tidak diketahui"}
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                Aktif terakhir {dateWib(row.lastSeenAt)}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Berlaku sampai {dateWib(row.expiresAt)}
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="col-span-2 w-full sm:col-span-1 sm:w-auto"
              disabled={Boolean(busy)}
              onClick={() => void revoke(row.id, row.current)}
            >
              {busy === row.id ? "Mencabut…" : "Cabut sesi"}
            </Button>
          </article>
        ))}
      </div>
      <p className="mt-5 flex items-center gap-2 text-xs text-muted-foreground">
        <ShieldCheck size={16} />
        Sesi admin dibatasi maksimal 12 jam.
      </p>
    </Card>
  );
}
