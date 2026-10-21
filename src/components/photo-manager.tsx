"use client";
import { useEffect, useId, useRef } from "react";
import Image from "next/image";
import {
  ArrowLeft,
  ArrowRight,
  ImagePlus,
  LoaderCircle,
  RotateCcw,
  Star,
  Trash2,
} from "lucide-react";
import { api } from "@/src/lib/client-api";
import { checkImageFile, encodeImage, loadImage } from "@/src/lib/image";
import { LISTING_LIMITS } from "@/src/domain/listing";
import { cn } from "@/src/lib/utils";

export type PhotoSlot = {
  key: string;
  status: "uploading" | "done" | "error";
  preview: string | null;
  path?: string;
  thumbPath?: string;
  // Public thumbnail URL; unlike blob previews it survives a reload of the saved draft.
  thumbUrl?: string | null;
  uploadedAt?: number;
  error?: string;
  file?: File;
};
type Update = (updater: (slots: PhotoSlot[]) => PhotoSlot[]) => void;
const MAX = LISTING_LIMITS.photos.max;

async function upload(blob: Blob) {
  const ticket = await api<{ path: string; signedUrl: string; publicUrl?: string | null }>(
    "/api/uploads/sign",
    {
      method: "POST",
      body: JSON.stringify({ purpose: "item_photo", contentType: blob.type, size: blob.size }),
    },
  );
  const response = await fetch(ticket.signedUrl, {
    method: "PUT",
    headers: { "Content-Type": blob.type },
    body: blob,
  });
  if (!response.ok) throw new Error("Foto belum terunggah. Cek koneksi, lalu coba lagi.");
  return ticket;
}
// Full photo (1600 px) and card thumbnail (480 px) are uploaded separately (03 §9).
async function process(key: string, file: File, update: Update) {
  const patch = (value: Partial<PhotoSlot>) =>
    update((slots) => slots.map((slot) => (slot.key === key ? { ...slot, ...value } : slot)));
  try {
    checkImageFile(file);
    const image = await loadImage(file);
    const [full, thumb] = [
      await encodeImage(image, 1600, "image/webp", 0.82),
      await encodeImage(image, 480, "image/webp", 0.75),
    ];
    patch({ preview: URL.createObjectURL(thumb) });
    const main = await upload(full),
      small = await upload(thumb);
    patch({
      status: "done",
      path: main.path,
      thumbPath: small.path,
      thumbUrl: small.publicUrl ?? null,
      uploadedAt: Date.now(),
      error: undefined,
    });
  } catch (error) {
    patch({ status: "error", error: (error as Error).message });
  }
}

export function PhotoManager({
  photos,
  onChange,
  error,
}: {
  photos: PhotoSlot[];
  onChange: Update;
  error?: string;
}) {
  const input = useRef<HTMLInputElement>(null),
    id = useId(),
    latest = useRef(photos);
  // Blob previews belong to the caller's state (the wizard preview reuses them), so they are
  // revoked on removal here and by the owner of the state when it unmounts.
  useEffect(() => {
    latest.current = photos;
  }, [photos]);
  async function add(files: File[]) {
    const room = MAX - latest.current.length;
    const queue = files.slice(0, Math.max(room, 0)).map((file) => ({
      key: crypto.randomUUID(),
      file,
    }));
    if (!queue.length) return;
    onChange((slots) => [
      ...slots,
      ...queue.map(({ key, file }) => ({ key, file, status: "uploading" as const, preview: null })),
    ]);
    // Sequential uploads keep weak mobile connections responsive.
    for (const { key, file } of queue) await process(key, file, onChange);
    if (input.current) input.current.value = "";
  }
  function move(index: number, target: number) {
    onChange((slots) => {
      const next = [...slots];
      const [slot] = next.splice(index, 1);
      next.splice(target, 0, slot);
      return next;
    });
  }
  function remove(key: string) {
    onChange((slots) => {
      const slot = slots.find((value) => value.key === key);
      if (slot?.preview?.startsWith("blob:")) URL.revokeObjectURL(slot.preview);
      return slots.filter((value) => value.key !== key);
    });
  }
  const full = photos.length >= MAX;
  return (
    <div>
      <input
        ref={input}
        id={id}
        type="file"
        multiple
        accept="image/jpeg,image/png,image/webp"
        className="sr-only"
        onChange={(event) => void add([...(event.target.files || [])])}
      />
      <ol className="grid grid-cols-2 gap-3 sm:grid-cols-3" aria-label="Foto barang">
        {photos.map((slot, index) => (
          <li
            key={slot.key}
            className={cn(
              "relative overflow-hidden rounded-2xl border bg-background",
              slot.status === "error" ? "border-destructive" : "border-border",
            )}
          >
            <div className="relative aspect-[4/3] bg-muted">
              {slot.preview && (
                <Image
                  unoptimized
                  fill
                  sizes="200px"
                  src={slot.preview}
                  alt={`Foto ${index + 1}${index === 0 ? " (sampul)" : ""}`}
                  className="object-cover"
                />
              )}
              {slot.status === "uploading" && (
                <span className="absolute inset-0 flex items-center justify-center gap-2 bg-card/70 text-xs font-bold">
                  <LoaderCircle size={16} className="animate-spin" />
                  Mengunggah…
                </span>
              )}
              {index === 0 && (
                <span className="absolute top-2 left-2 inline-flex items-center gap-1 rounded-full bg-accent px-2 py-0.5 text-xs font-extrabold text-accent-foreground">
                  <Star size={12} aria-hidden />
                  Sampul
                </span>
              )}
            </div>
            {slot.status === "error" && (
              <p className="px-2 pt-2 text-xs text-destructive" role="alert">
                {slot.error}
              </p>
            )}
            <div className="flex items-center justify-between gap-1 p-1.5">
              <div className="flex">
                <button
                  type="button"
                  className="flex size-9 items-center justify-center rounded-full hover:bg-secondary disabled:opacity-30"
                  aria-label={`Geser foto ${index + 1} ke kiri`}
                  disabled={index === 0}
                  onClick={() => move(index, index - 1)}
                >
                  <ArrowLeft size={16} />
                </button>
                <button
                  type="button"
                  className="flex size-9 items-center justify-center rounded-full hover:bg-secondary disabled:opacity-30"
                  aria-label={`Geser foto ${index + 1} ke kanan`}
                  disabled={index === photos.length - 1}
                  onClick={() => move(index, index + 1)}
                >
                  <ArrowRight size={16} />
                </button>
              </div>
              <div className="flex">
                {slot.status === "error" && slot.file && (
                  <button
                    type="button"
                    className="flex size-9 items-center justify-center rounded-full text-primary hover:bg-secondary"
                    aria-label={`Unggah ulang foto ${index + 1}`}
                    onClick={() => {
                      onChange((slots) =>
                        slots.map((value) =>
                          value.key === slot.key ? { ...value, status: "uploading" } : value,
                        ),
                      );
                      void process(slot.key, slot.file!, onChange);
                    }}
                  >
                    <RotateCcw size={16} />
                  </button>
                )}
                <button
                  type="button"
                  className="flex size-9 items-center justify-center rounded-full text-destructive hover:bg-[var(--color-danger-bg)]"
                  aria-label={`Hapus foto ${index + 1}`}
                  onClick={() => remove(slot.key)}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          </li>
        ))}
        {!full && (
          <li>
            <button
              type="button"
              aria-describedby={`${id}-help`}
              onClick={() => input.current?.click()}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                void add([...event.dataTransfer.files]);
              }}
              className="flex aspect-[4/3] h-full min-h-32 w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-border bg-background p-3 text-center text-xs font-semibold text-muted-foreground hover:border-primary hover:text-primary"
            >
              <ImagePlus size={26} className="text-primary" />
              {photos.length ? "Tambah foto" : "Pilih foto atau tarik ke sini"}
            </button>
          </li>
        )}
      </ol>
      <p id={`${id}-help`} className="help">
        {LISTING_LIMITS.photos.min}–{MAX} foto JPEG, PNG, atau WebP (maks. 5 MB per foto). Foto
        pertama menjadi sampul, dikecilkan otomatis, dan data lokasi di dalam foto dihapus.
      </p>
      {error && (
        <p className="notice notice-error mt-3" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
