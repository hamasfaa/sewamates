import Link from "next/link";
import { Button } from "@/src/components/ui/button";
export default function NotFound() {
  return (
    <div className="page-container py-20 text-center">
      <p className="mb-4 text-sm font-bold text-primary">404</p>
      <h1 className="text-3xl">Sepertinya salah jalan</h1>
      <p className="my-5 text-muted-foreground">
        Halaman yang kamu cari belum ada atau sudah dipindahkan.
      </p>
      <Button asChild>
        <Link href="/">Kembali ke beranda</Link>
      </Button>
    </div>
  );
}
