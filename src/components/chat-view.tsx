"use client";
import Link from "next/link";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { api } from "@/src/lib/client-api";
import { useLiveApi, type Wire } from "@/src/lib/live-api";
import type { conversationList, conversationMessages } from "@/src/services/chat-service";
import { cn, dateWib } from "@/src/lib/utils";
import { uploadPrivateFile } from "@/src/lib/private-upload";
import { Card } from "./ui/card";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
type Room = Wire<Awaited<ReturnType<typeof conversationMessages>>>;
export function ChatView({ selectedId, userId }: { selectedId?: string; userId: string }) {
  const query = useLiveApi<Wire<Awaited<ReturnType<typeof conversationList>>>>(
    "/api/conversations",
    5000,
  );
  return (
    <div className="page-container py-6 lg:py-10">
      <h1 className="text-3xl">Chat</h1>
      <div className="mt-6 grid min-w-0 gap-5 lg:grid-cols-[300px_minmax(0,1fr)]">
        <section
          className={cn("min-w-0", selectedId && "hidden lg:block")}
          aria-label="Daftar percakapan"
        >
          {query.error && (
            <p className="notice notice-error" role="alert">
              {query.error}
            </p>
          )}
          {!query.data && !query.error && (
            <div className="skeleton h-64" role="status" aria-label="Memuat percakapan" />
          )}
          {query.data?.length === 0 && (
            <Card>
              <h2 className="text-xl">Belum ada percakapan</h2>
              <p className="mt-3 text-sm text-muted-foreground">
                Buka barang yang kamu perlukan, lalu sapa pemiliknya.
              </p>
              <Button asChild className="mt-4">
                <Link href="/cari">Cari barang</Link>
              </Button>
            </Card>
          )}
          <ul className="space-y-3">
            {query.data?.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/chat/${c.id}`}
                  className={cn(
                    "block rounded-2xl border bg-card p-4",
                    selectedId === c.id ? "border-primary" : "border-border",
                  )}
                >
                  <div className="flex justify-between gap-2">
                    <h2 className="truncate text-base">{c.partnerName}</h2>
                    {c.unread > 0 && (
                      <span
                        className="rounded-full bg-primary px-2 py-1 text-xs font-bold text-white"
                        aria-label={`${c.unread} belum dibaca`}
                      >
                        {c.unread}
                      </span>
                    )}
                  </div>
                  <div className="mt-2 flex min-w-0 items-center gap-2">
                    {c.thumbnail && (
                      <Image
                        src={c.thumbnail}
                        unoptimized
                        width={40}
                        height={40}
                        alt=""
                        className="size-10 shrink-0 rounded-lg object-cover"
                      />
                    )}
                    <p className="truncate text-xs font-semibold text-primary">{c.itemTitle}</p>
                  </div>
                  <p className="mt-2 truncate text-sm text-muted-foreground">
                    {c.preview || "Mulai percakapan"}
                  </p>
                  <time
                    dateTime={c.lastMessageAt}
                    className="mt-2 block text-xs text-muted-foreground"
                  >
                    {dateWib(c.lastMessageAt)}
                  </time>
                </Link>
              </li>
            ))}
          </ul>
        </section>
        <section className="min-w-0" aria-label="Ruang chat">
          {selectedId ? (
            <ChatRoom key={selectedId} id={selectedId} userId={userId} />
          ) : (
            <Card className="hidden min-h-80 items-center justify-center lg:flex">
              <p className="text-muted-foreground">Pilih percakapan untuk mulai menyapa.</p>
            </Card>
          )}
        </section>
      </div>
    </div>
  );
}
function ChatRoom({ id, userId }: { id: string; userId: string }) {
  const query = useLiveApi<Room>(`/api/conversations/${id}/messages`),
    [text, setText] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [older, setOlder] = useState<Room["messages"]>([]),
    [cursor, setCursor] = useState<string | null | undefined>(undefined),
    [loadingOlder, setLoadingOlder] = useState(false),
    [reportId, setReportId] = useState(""),
    [reason, setReason] = useState(""),
    [reported, setReported] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null),
    read = useRef("");
  const log = useRef<HTMLDivElement>(null),
    follow = useRef(true);
  const last = query.data?.messages.at(-1)?.id;
  useEffect(() => {
    const mark = () => {
      if (!last || document.hidden || read.current === last) return;
      read.current = last;
      void api(`/api/conversations/${id}/read`, {
        method: "POST",
        body: JSON.stringify({ lastMessageId: last }),
      }).catch(() => {
        read.current = "";
      });
    };
    mark();
    document.addEventListener("visibilitychange", mark);
    return () => document.removeEventListener("visibilitychange", mark);
  }, [last, id]);
  useEffect(() => {
    if (log.current && follow.current) log.current.scrollTop = log.current.scrollHeight;
  }, [last]);
  async function send(file?: File) {
    if (busy || (!file && !text.trim())) return;
    setBusy(true);
    setError("");
    try {
      const payload = file
        ? { imagePath: await uploadPrivateFile(file, "chat_image") }
        : { body: text.trim() };
      await api(`/api/conversations/${id}/messages`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      if (!file) setText("");
      if (fileInput.current) fileInput.current.value = "";
      await query.refresh();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function loadOlder() {
    if (!query.data) return;
    const next = cursor === undefined ? query.data.nextCursor : cursor;
    if (!next) return;
    setLoadingOlder(true);
    try {
      const page = await api<Room>(`/api/conversations/${id}/messages?cursor=${next}`);
      setOlder((current) => [...page.messages, ...current]);
      setCursor(page.nextCursor);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setLoadingOlder(false);
    }
  }
  async function toggleBlock() {
    if (
      !query.data ||
      !window.confirm(
        query.data.selfBlocked
          ? "Buka blokir pengguna ini?"
          : "Blokir pengguna ini? Pesan dan pengajuan baru di antara kalian akan ditolak.",
      )
    )
      return;
    try {
      await api(`/api/users/${query.data.partner.id}/block`, {
        method: query.data.selfBlocked ? "DELETE" : "POST",
        body: "{}",
      });
      await query.refresh();
    } catch (error) {
      setError((error as Error).message);
    }
  }
  if (!query.data)
    return query.error ? (
      <p className="notice notice-error" role="alert">
        {query.error}
      </p>
    ) : (
      <div className="skeleton h-96" role="status" aria-label="Memuat pesan" />
    );
  const data = query.data,
    merged = [...new Map([...older, ...data.messages].map((m) => [m.id, m])).values()].sort(
      (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
    );
  const otherRead =
    data.conversation.ownerId === userId
      ? data.conversation.renterLastReadAt
      : data.conversation.ownerLastReadAt;
  return (
    <Card className="min-w-0 p-4 sm:p-6">
      <Link className="text-sm font-bold text-primary lg:hidden" href="/chat">
        ← Daftar chat
      </Link>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-xl break-words">{data.partner.name}</h2>
          <Link
            className="mt-1 block text-sm font-semibold text-primary"
            href={`/barang/${data.item.id}`}
          >
            {data.item.title}
          </Link>
        </div>
        <Button size="sm" variant="outline" onClick={() => void toggleBlock()}>
          {data.selfBlocked ? "Buka blokir" : "Blokir"}
        </Button>
      </div>
      <div
        ref={log}
        onScroll={(e) => {
          const el = e.currentTarget;
          follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
        className="my-4 max-h-[55vh] min-h-64 space-y-3 overflow-y-auto rounded-xl bg-background p-3"
        role="log"
        aria-label="Pesan percakapan"
        aria-live="polite"
      >
        {(cursor === undefined ? data.nextCursor : cursor) && (
          <Button
            size="sm"
            variant="outline"
            disabled={loadingOlder}
            onClick={() => void loadOlder()}
          >
            Pesan sebelumnya
          </Button>
        )}
        {merged.length === 0 && (
          <p className="py-12 text-center text-sm text-muted-foreground">
            Sapa pemilik dan tanyakan kebutuhanmu.
          </p>
        )}
        {merged.map((m) => (
          <div
            key={m.id}
            className={cn(
              "flex",
              m.type === "system"
                ? "justify-center"
                : m.senderId === userId
                  ? "justify-end"
                  : "justify-start",
            )}
          >
            <div
              className={cn(
                "max-w-[90%] min-w-0 rounded-2xl p-3",
                m.type === "system"
                  ? "bg-muted text-center text-xs text-muted-foreground"
                  : m.senderId === userId
                    ? "bg-secondary"
                    : "border border-border bg-card",
              )}
            >
              {m.imageUrl && (
                <a href={m.imageUrl} target="_blank" rel="noreferrer">
                  <Image
                    src={m.imageUrl}
                    unoptimized
                    width={280}
                    height={210}
                    alt="Gambar dalam percakapan"
                    className="h-auto max-w-full rounded-xl"
                  />
                </a>
              )}
              {m.text && (
                <p className="text-sm break-words whitespace-pre-wrap [overflow-wrap:anywhere]">
                  {m.text}
                </p>
              )}
              {m.redacted && (
                <p className="mt-2 text-xs font-bold text-destructive">
                  Demi keamanan, lakukan transaksi lewat SewaMates.
                </p>
              )}
              <p className="mt-2 text-[11px] text-muted-foreground">
                {dateWib(m.createdAt)}
                {m.senderId === userId
                  ? otherRead && Date.parse(otherRead) >= Date.parse(m.createdAt)
                    ? " · Dibaca"
                    : " · Terkirim"
                  : ""}
              </p>
              {m.senderId && m.senderId !== userId && (
                <button
                  className="mt-1 min-h-8 text-xs font-semibold text-primary"
                  onClick={() => {
                    setReportId(m.id);
                    setReported(false);
                  }}
                >
                  Laporkan pesan
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
      {data.blocked ? (
        <p className="notice">Pesan tidak dapat dikirim karena salah satu pihak memblokir akun.</p>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
          className="space-y-3"
        >
          <label className="sr-only" htmlFor="chat-message">
            Pesan
          </label>
          <textarea
            id="chat-message"
            className="input min-h-24"
            placeholder="Tulis pesan…"
            maxLength={2000}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void send();
              }
            }}
          />
          <div className="flex flex-wrap justify-between gap-2">
            <input
              ref={fileInput}
              type="file"
              className="sr-only"
              accept="image/jpeg,image/png,image/webp"
              aria-label="Pilih gambar chat"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void send(file);
              }}
            />
            <Button
              variant="outline"
              type="button"
              disabled={busy}
              onClick={() => fileInput.current?.click()}
            >
              Kirim gambar
            </Button>
            <Button type="submit" disabled={busy || !text.trim()}>
              {busy ? "Mengirim…" : "Kirim pesan"}
            </Button>
          </div>
          <p className="help">Enter untuk mengirim; Shift+Enter untuk baris baru.</p>
        </form>
      )}
      {(error || query.error) && (
        <p className="notice notice-error mt-3" role="alert">
          {error || query.error}
        </p>
      )}
      {reportId && (
        <form
          className="form-stack mt-5 border-t border-border pt-5"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await api("/api/reports", {
                method: "POST",
                body: JSON.stringify({ messageId: reportId, reason }),
              });
              setReportId("");
              setReason("");
              setReported(true);
            } catch (error) {
              setError((error as Error).message);
            }
          }}
        >
          <label className="field-label" htmlFor="chat-report">
            Alasan melaporkan pesan
          </label>
          <Input
            id="chat-report"
            required
            minLength={5}
            maxLength={1000}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <div className="flex gap-2">
            <Button type="submit">Kirim laporan</Button>
            <Button type="button" variant="outline" onClick={() => setReportId("")}>
              Batal
            </Button>
          </div>
        </form>
      )}
      {reported && (
        <p className="notice mt-4" role="status">
          Laporan sudah diterima untuk ditinjau admin.
        </p>
      )}
    </Card>
  );
}
