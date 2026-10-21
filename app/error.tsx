"use client";
import { Button } from "@/src/components/ui/button";
export default function ErrorPage({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="page-container py-20 text-center">
      <h1 className="text-2xl">Halaman belum bisa dimuat</h1>
      <p className="my-5 text-muted-foreground">
        Coba lagi sebentar. Kalau masih bermasalah, hubungi pengelola SewaMates.
      </p>
      <Button onClick={reset}>Coba lagi</Button>
    </div>
  );
}
