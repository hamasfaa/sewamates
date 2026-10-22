"use client";
import { useRouter } from "next/navigation";
import { Bell, ArrowUpRight } from "lucide-react";
import { useState } from "react";
import { api } from "@/src/lib/client-api";
import { NOTIFICATION_POLL_MS, useLiveApi } from "@/src/lib/live-api";
import { dateWib } from "@/src/lib/utils";
import { Card } from "./ui/card";
import { Button } from "./ui/button";
type Notification = {
  id: string;
  title: string;
  body: string;
  link: string;
  readAt: string | null;
  createdAt: string;
};
export function NotificationsList() {
  const query = useLiveApi<{ notifications: Notification[]; unread: number }>(
      "/api/notifications",
      NOTIFICATION_POLL_MS,
    ),
    router = useRouter(),
    [error, setError] = useState("");
  async function mark(ids: string[], link?: string) {
    try {
      if (ids.length)
        await api("/api/notifications/read", { method: "POST", body: JSON.stringify({ ids }) });
      await query.refresh();
      if (link && /^\/(?!\/|\\)/.test(link)) router.push(link);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <Card>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl">Kabar buat kamu</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Pembaruan akunmu, tersimpan di satu tempat.
          </p>
        </div>
        {Boolean(query.data?.unread) && (
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              void mark(query.data!.notifications.filter((row) => !row.readAt).map((row) => row.id))
            }
          >
            Tandai sudah dibaca
          </Button>
        )}
      </div>
      {(query.error || error) && (
        <p className="notice notice-error" role="alert">
          {query.error || error}
        </p>
      )}
      {query.loading && (
        <div className="skeleton h-60" role="status" aria-label="Memuat notifikasi" />
      )}
      {query.data?.notifications.length === 0 && (
        <div className="py-14 text-center">
          <Bell size={40} className="mx-auto mb-5 text-primary" />
          <h2 className="text-lg">Belum ada kabar baru</h2>
          <p className="mt-3 text-sm text-muted-foreground">
            Hasil verifikasi dan perubahan akun akan muncul di sini.
          </p>
        </div>
      )}
      <ul className="space-y-3">
        {query.data?.notifications.map((entry) => (
          <li key={entry.id}>
            <button
              className={`flex w-full items-start gap-3 rounded-xl border p-4 text-left ${entry.readAt ? "border-border" : "border-[var(--color-sky)] bg-secondary"}`}
              onClick={() => void mark(entry.readAt ? [] : [entry.id], entry.link)}
            >
              <Bell size={19} className="mt-1 shrink-0 text-primary" />
              <div className="min-w-0 flex-1">
                <h2 className="text-sm font-bold">
                  {entry.title}
                  {!entry.readAt && (
                    <span
                      className="ml-2 inline-block size-2 rounded-full bg-primary"
                      aria-label="Belum dibaca"
                    />
                  )}
                </h2>
                <p className="mt-2 text-sm text-muted-foreground">{entry.body}</p>
                <p className="mt-3 text-xs text-muted-foreground">{dateWib(entry.createdAt)}</p>
              </div>
              <ArrowUpRight size={16} className="shrink-0 text-primary" />
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
}
