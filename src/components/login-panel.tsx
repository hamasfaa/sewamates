"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import QRCode from "qrcode";
import {
  ArrowRight,
  Check,
  Clock3,
  ExternalLink,
  LoaderCircle,
  Send,
  ShieldCheck,
} from "lucide-react";
import { api } from "@/src/lib/client-api";
import { telegramLoginLinks } from "@/src/lib/telegram-links";
import { Button } from "./ui/button";
type LoginRequest = { id: string; matchCode: string; deepLink: string; expiresAt: string };
type Login = LoginRequest & ReturnType<typeof telegramLoginLinks>;
export function LoginPanel() {
  const router = useRouter(),
    [login, setLogin] = useState<Login | null>(null),
    [qr, setQr] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [expired, setExpired] = useState(false),
    [seconds, setSeconds] = useState(0);
  async function begin() {
    setBusy(true);
    setError("");
    setExpired(false);
    setLogin(null);
    setQr("");
    try {
      const value = await api<LoginRequest>("/api/auth/telegram/start", { method: "POST" });
      setLogin({ ...value, ...telegramLoginLinks(value.deepLink) });
      setSeconds(Math.max(0, Math.ceil((Date.parse(value.expiresAt) - Date.now()) / 1000)));
      setQr(
        await QRCode.toDataURL(value.deepLink, {
          width: 208,
          margin: 1,
          color: { dark: "#0B1F4D", light: "#FFFFFF" },
        }),
      );
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (!login || expired) return;
    let cancelled = false,
      timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const result = await api<{ status: string; redirect?: string }>(
          `/api/auth/telegram/status/${login.id}`,
        );
        if (cancelled) return;
        if (result.status === "authenticated") {
          router.replace(result.redirect || "/profil");
          router.refresh();
          return;
        }
        if (["kedaluwarsa", "dipakai"].includes(result.status)) {
          setExpired(true);
          return;
        }
      } catch (error) {
        if (!cancelled) setError((error as Error).message);
      }
      if (!cancelled) timer = setTimeout(poll, 2000);
    };
    timer = setTimeout(poll, 2000);
    const countdown = setInterval(() => {
      const remaining = Math.max(0, Math.ceil((Date.parse(login.expiresAt) - Date.now()) / 1000));
      setSeconds(remaining);
      if (!remaining) setExpired(true);
    }, 1000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      clearInterval(countdown);
    };
  }, [login, expired, router]);
  return (
    <div>
      {error && (
        <p className="notice notice-error mb-5" role="alert">
          {error}
        </p>
      )}
      {!login || expired ? (
        <>
          <Button className="w-full" size="lg" onClick={begin} disabled={busy}>
            {busy ? <LoaderCircle size={19} className="animate-spin" /> : <Send size={19} />}
            {busy ? "Menyiapkan login…" : expired ? "Coba login lagi" : "Masuk dengan Telegram"}
            <ArrowRight size={17} />
          </Button>
          {expired && (
            <p className="mt-4 text-center text-sm text-[var(--color-warning)]">
              Permintaan sudah kedaluwarsa atau telah dipakai. Mulai lagi dengan angka baru.
            </p>
          )}
        </>
      ) : (
        <div>
          <div className="rounded-2xl border border-border bg-background p-5 text-center">
            <p className="text-sm text-muted-foreground">Pilih angka ini di bot Telegram</p>
            <p className="tabular my-3 text-6xl font-extrabold tracking-widest text-primary">
              {login.matchCode}
            </p>
            <p
              className="tabular flex items-center justify-center gap-1.5 text-xs text-muted-foreground"
              aria-live="off"
            >
              <Clock3 size={13} />
              Berlaku {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}
            </p>
          </div>
          <Button asChild className="mt-5 w-full" size="lg">
            <a href={login.appLink}>
              <Send size={18} />
              Buka aplikasi Telegram
              <ExternalLink size={16} />
            </a>
          </Button>
          <p className="mt-3 text-center text-sm leading-6 text-muted-foreground">
            Izinkan browser membuka Telegram, lalu tekan <strong>Start / Mulai</strong> di bot. Jika
            aplikasinya belum terpasang, gunakan Telegram Web.
          </p>
          <Button asChild variant="outline" className="mt-3 w-full">
            <a href={login.webLink} target="_blank" rel="noreferrer">
              Buka Telegram Web
              <ExternalLink size={16} />
            </a>
          </Button>
          <div className="my-6 hidden items-center gap-4 rounded-xl border border-border p-3 lg:flex">
            {qr && (
              <Image
                alt="Pindai QR untuk membuka bot login di HP"
                src={qr}
                width={110}
                height={110}
                unoptimized
              />
            )}
            <p className="text-sm text-muted-foreground">
              <strong className="text-foreground">Lebih nyaman dari HP?</strong>
              <br />
              Pindai QR ini, lalu pilih angka yang sama. Browser ini akan masuk otomatis.
            </p>
          </div>
          <p
            className="my-5 flex items-center justify-center gap-2 text-sm text-primary"
            role="status"
          >
            <LoaderCircle size={16} className="animate-spin" />
            Menunggu konfirmasi Telegram…
          </p>
        </div>
      )}
      <ol className="mt-7 space-y-3 text-sm text-muted-foreground">
        {[
          "Buka Telegram, lalu tekan Start / Mulai",
          "Bagikan nomor HP milikmu (sekali saja)",
          "Pilih angka yang sama dengan browser",
        ].map((text, i) => (
          <li key={text} className="flex items-center gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-bold text-primary">
              {i + 1}
            </span>
            {text}
          </li>
        ))}
      </ol>
      <p className="mt-7 flex items-start gap-2 border-t border-border pt-5 text-xs leading-5 text-muted-foreground">
        <ShieldCheck size={17} className="shrink-0 text-primary" />
        Tanpa password. Nomor HP tidak ditampilkan ke pengguna lain.{" "}
        <Check size={14} className="hidden" />
      </p>
    </div>
  );
}
