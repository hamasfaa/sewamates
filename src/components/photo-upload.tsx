"use client";
import { useEffect, useId, useRef, useState } from "react";
import Image from "next/image";
import { ImagePlus, LoaderCircle, CheckCircle2 } from "lucide-react";
import { api } from "@/src/lib/client-api";
import { compressImage } from "@/src/lib/image";
export function PhotoUpload({
  purpose,
  label,
  onUploaded,
}: {
  purpose: "identity_card" | "identity_selfie" | "avatar";
  label: string;
  onUploaded: (path: string) => void;
}) {
  const id = useId(),
    input = useRef<HTMLInputElement>(null),
    [preview, setPreview] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [done, setDone] = useState(false);
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );
  async function upload(file?: File) {
    if (!file || busy) return;
    setBusy(true);
    setDone(false);
    setError("");
    onUploaded("");
    try {
      const blob = await compressImage(file);
      setPreview(URL.createObjectURL(blob));
      const ticket = await api<{ path: string; signedUrl: string }>("/api/uploads/sign", {
        method: "POST",
        body: JSON.stringify({ purpose, contentType: "image/jpeg", size: blob.size }),
      });
      const response = await fetch(ticket.signedUrl, {
        method: "PUT",
        headers: { "Content-Type": "image/jpeg" },
        body: blob,
      });
      if (!response.ok) throw new Error("Foto belum terunggah. Cek koneksi, lalu pilih foto lagi.");
      onUploaded(ticket.path);
      setDone(true);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }
  return (
    <div>
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <input
        ref={input}
        id={id}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="sr-only"
        disabled={busy}
        onChange={(e) => void upload(e.target.files?.[0])}
      />
      <button
        type="button"
        disabled={busy}
        aria-describedby={`${id}-help`}
        onClick={() => input.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          void upload(e.dataTransfer.files[0]);
        }}
        className="flex min-h-44 w-full flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-border bg-background p-5 text-sm text-muted-foreground hover:border-primary"
      >
        {preview ? (
          <Image
            src={preview}
            unoptimized
            alt={`Pratinjau ${label.toLowerCase()}`}
            width={240}
            height={160}
            className="max-h-40 rounded-lg object-contain"
          />
        ) : (
          <ImagePlus size={30} className="text-primary" />
        )}
        <span className="flex items-center gap-2 font-semibold">
          {busy ? (
            <>
              <LoaderCircle size={18} className="animate-spin" />
              Memproses dan mengunggah…
            </>
          ) : done ? (
            <>
              <CheckCircle2 size={18} className="text-[var(--color-success)]" />
              Terunggah · Klik untuk ganti
            </>
          ) : (
            "Pilih foto atau tarik ke sini"
          )}
        </span>
      </button>
      <p id={`${id}-help`} className="help">
        JPEG, PNG, atau WebP · maks. 5 MB. Foto dikecilkan otomatis.
      </p>
      {error && (
        <p className="notice notice-error mt-3" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
