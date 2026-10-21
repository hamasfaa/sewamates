import type { Metadata } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import { headers } from "next/headers";
import { currentSession } from "@/src/lib/auth";
import { AppShell } from "@/src/components/app-shell";
import "./globals.css";
const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
  variable: "--font-jakarta",
});
export const metadata: Metadata = {
  title: { default: "SewaMates — Pinjam barang, tambah pengalaman", template: "%s · SewaMates" },
  description:
    "Sewa-menyewa barang antar mahasiswa. Bertemu di kampus, identitas terverifikasi, dan dana ditahan aman sampai barang kembali.",
};
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  await headers(); // A fresh CSP nonce is required on every HTML response.
  const session = await currentSession();
  return (
    <html lang="id">
      <body className={`${jakarta.variable} antialiased`}>
        <AppShell
          botUsername={process.env.TELEGRAM_BOT_USERNAME}
          user={
            session
              ? {
                  name: session.user.name,
                  role: session.user.role,
                  telegramBlocked: Boolean(session.user.telegramBlockedAt),
                }
              : null
          }
        >
          {children}
        </AppShell>
      </body>
    </html>
  );
}
