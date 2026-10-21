"use client";
import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);
  return (
    <html lang="id">
      <body>
        <h1>SewaMates belum bisa dimuat</h1>
        <p>Coba lagi beberapa saat.</p>
        <button onClick={reset}>Coba lagi</button>
      </body>
    </html>
  );
}
