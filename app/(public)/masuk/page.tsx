import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { currentSession } from "@/src/lib/auth";
import { Card } from "@/src/components/ui/card";
import { LoginPanel } from "@/src/components/login-panel";
import { HeartHandshake, ShieldCheck } from "lucide-react";
export const metadata: Metadata = { title: "Masuk" };
export default async function LoginPage() {
  const actor = await currentSession();
  if (actor) redirect(actor.user.termsAcceptedAt ? "/profil" : "/daftar");
  return (
    <div className="page-container grid min-h-[75vh] items-center gap-12 py-10 lg:grid-cols-2 lg:py-16">
      <div className="hidden max-w-lg lg:block">
        <span className="mb-6 inline-flex rounded-2xl bg-accent p-4">
          <HeartHandshake size={35} />
        </span>
        <p className="mb-4 text-sm font-bold text-primary">Teman kampus, teman pinjam.</p>
        <h1 className="text-5xl leading-[1.15]">
          Pengalaman baru
          <br />
          dimulai dari
          <br />
          <span className="text-primary">saling percaya.</span>
        </h1>
        <p className="mt-6 max-w-md leading-7 text-muted-foreground">
          Satu akun untuk menyewa, menyewakan, dan bikin barang lebih bermanfaat. Kenalan dulu, yuk.
        </p>
        <div className="mt-8 flex items-center gap-3 text-sm">
          <ShieldCheck className="text-primary" size={22} />
          Identitas aman. Komunitas nyaman.
        </div>
      </div>
      <Card className="mx-auto w-full max-w-lg p-6 sm:p-9">
        <p className="mb-2 text-xs font-bold tracking-widest text-primary uppercase">
          Selamat datang di SewaMates
        </p>
        <h2 className="text-3xl">Masuk, yuk!</h2>
        <p className="mt-3 mb-7 text-sm leading-6 text-muted-foreground">
          Pakai Telegram untuk masuk dengan aman dan menerima kabar penting tentang sewamu.
        </p>
        <LoginPanel />
        <p className="mt-5 text-center text-xs text-muted-foreground">
          Belum punya Telegram?{" "}
          <a
            href="https://telegram.org/apps"
            target="_blank"
            rel="noreferrer"
            className="font-bold text-primary underline"
          >
            Unduh di sini
          </a>
        </p>
      </Card>
    </div>
  );
}
