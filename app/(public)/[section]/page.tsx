import Link from "next/link";
import { notFound } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { Card } from "@/src/components/ui/card";
import { Button } from "@/src/components/ui/button";
export default async function Page({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  if (["ketentuan", "privasi"].includes(section))
    return (
      <div className="page-container max-w-3xl py-10">
        <Card>
          <ShieldCheck className="mb-5 text-primary" size={30} />
          <h1 className="text-2xl">
            {section === "ketentuan" ? "Ketentuan uji coba" : "Privasi saat uji coba"}
          </h1>
          <p className="notice mt-6">
            Draf untuk lingkungan pengembangan dan uji coba. Dokumen final perlu disahkan pengelola
            sebelum layanan dibuka untuk umum.
          </p>
          <div className="mt-6 space-y-4 text-sm leading-7 text-muted-foreground">
            {section === "ketentuan" ? (
              <>
                <p>
                  SewaMates disiapkan sebagai layanan sewa barang antar mahasiswa, dengan serah
                  terima langsung di titik kampus dan pemeriksaan identitas oleh admin.
                </p>
                <p>
                  Gunakan nama dan nomor HP milikmu sendiri. Jangan mengirim foto identitas milik
                  orang lain. Akun Telegram diperlukan untuk login dan konfirmasi perubahan
                  rekening.
                </p>
                <p>
                  Listing barang ditinjau admin sebelum tampil. Pasang hanya barang milikmu sendiri
                  dengan foto dan deskripsi kondisi yang jujur.
                </p>
                <p>
                  Dalam tahap uji coba ini, gunakan data pengujian. Transaksi sewa dan pembayaran
                  belum dibuka.
                </p>
              </>
            ) : (
              <>
                <p>
                  Data yang dipakai pada tahap ini meliputi nomor HP, ID Telegram, nama, kampus,
                  foto profil, dokumen verifikasi, rekening pencairan, transaksi, bukti transfer,
                  pesan chat, dan sesi perangkat.
                </p>
                <p>
                  Nomor HP tidak ditampilkan di profil publik. Foto identitas hanya diakses admin
                  melalui tautan sementara untuk pemeriksaan. Nomor rekening disimpan terenkripsi
                  dan ditampilkan tersamarkan.
                </p>
                <p>
                  Foto listing tampil publik setelah disetujui admin. Foto dikecilkan di perangkatmu
                  dan metadata seperti lokasi dihapus sebelum diunggah.
                </p>
                <p>
                  SewaMates menyimpan cookie sesi untuk menjaga login. Kamu dapat melihat dan
                  mencabut sesi dari pengaturan akun. Foto identitas tidak boleh dibagikan melalui
                  chat bot.
                </p>
              </>
            )}
          </div>
          <Button variant="outline" className="mt-7" asChild>
            <Link href="/profil">Kembali ke akun</Link>
          </Button>
        </Card>
      </div>
    );
  notFound();
}
