"use client";
import { useRef, useState } from "react";
import Image from "next/image";
import { ChevronLeft, ChevronRight, Package } from "lucide-react";
import { cn } from "@/src/lib/utils";

type Photo = { url: string | null; thumbUrl: string | null };
// Swipeable on touch (scroll snap), arrow buttons and thumbnails on larger screens.
export function ItemGallery({ photos, title }: { photos: Photo[]; title: string }) {
  const track = useRef<HTMLDivElement>(null),
    [index, setIndex] = useState(0);
  const go = (next: number) => {
    const node = track.current;
    if (!node) return;
    const target = Math.max(0, Math.min(photos.length - 1, next));
    node.scrollTo({ left: target * node.clientWidth, behavior: "smooth" });
  };
  return (
    <div>
      <div className="relative overflow-hidden rounded-2xl bg-muted">
        <div
          ref={track}
          role="region"
          aria-roledescription="galeri"
          aria-label={`Foto ${title}`}
          tabIndex={0}
          className="flex snap-x snap-mandatory overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          onScroll={(event) => {
            const node = event.currentTarget;
            setIndex(Math.round(node.scrollLeft / Math.max(node.clientWidth, 1)));
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowRight") go(index + 1);
            if (event.key === "ArrowLeft") go(index - 1);
          }}
        >
          {photos.map((photo, i) => (
            <div key={i} className="relative aspect-[4/3] w-full shrink-0 snap-center">
              {photo.url ? (
                <Image
                  unoptimized
                  fill
                  sizes="(min-width: 1024px) 60vw, 100vw"
                  src={photo.url}
                  alt={`${title} — foto ${i + 1} dari ${photos.length}`}
                  loading={i === 0 ? "eager" : "lazy"}
                  fetchPriority={i === 0 ? "high" : undefined}
                  className="object-cover"
                />
              ) : (
                <span className="flex h-full items-center justify-center text-primary">
                  <Package size={48} aria-hidden />
                </span>
              )}
            </div>
          ))}
        </div>
        {photos.length > 1 && (
          <>
            <button
              type="button"
              aria-label="Foto sebelumnya"
              disabled={index === 0}
              onClick={() => go(index - 1)}
              className="absolute top-1/2 left-3 hidden size-11 -translate-y-1/2 items-center justify-center rounded-full bg-card/90 text-foreground shadow disabled:opacity-0 sm:flex"
            >
              <ChevronLeft size={22} />
            </button>
            <button
              type="button"
              aria-label="Foto berikutnya"
              disabled={index === photos.length - 1}
              onClick={() => go(index + 1)}
              className="absolute top-1/2 right-3 hidden size-11 -translate-y-1/2 items-center justify-center rounded-full bg-card/90 text-foreground shadow disabled:opacity-0 sm:flex"
            >
              <ChevronRight size={22} />
            </button>
            <span
              className="tabular absolute right-3 bottom-3 rounded-full bg-[rgba(11,31,77,0.75)] px-3 py-1 text-xs font-bold text-white"
              aria-live="polite"
            >
              {index + 1}/{photos.length}
            </span>
          </>
        )}
      </div>
      {photos.length > 1 && (
        <div className="mt-3 hidden gap-2 overflow-x-auto pb-1 sm:flex" aria-label="Pilih foto">
          {photos.map((photo, i) => (
            <button
              key={i}
              type="button"
              onClick={() => go(i)}
              aria-label={`Lihat foto ${i + 1}`}
              aria-current={i === index}
              className={cn(
                "relative aspect-[4/3] w-20 shrink-0 overflow-hidden rounded-xl border-2 bg-muted",
                i === index ? "border-primary" : "border-transparent opacity-75 hover:opacity-100",
              )}
            >
              {photo.thumbUrl && (
                <Image
                  unoptimized
                  fill
                  sizes="80px"
                  src={photo.thumbUrl}
                  alt=""
                  className="object-cover"
                />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
