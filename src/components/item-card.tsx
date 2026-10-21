import Image from "next/image";
import Link from "next/link";
import { MapPin, Package, Star } from "lucide-react";
import type { ItemCardData } from "@/src/services/search-service";
import { cn, rupiah } from "@/src/lib/utils";

// Card layout from 03 §6: 4:3 photo, two-line title, price per day, rating, pickup point.
export function ItemCard({
  item,
  className,
  preview = false,
}: {
  item: ItemCardData;
  className?: string;
  // The listing wizard shows the card before the item exists, so it must not link anywhere.
  preview?: boolean;
}) {
  const classes = cn(
    "group flex min-w-0 flex-col overflow-hidden rounded-2xl border border-border bg-card card-shadow",
    !preview && "hover:-translate-y-0.5 hover:shadow-lg",
    className,
  );
  const content = (
    <>
      <div className="relative aspect-[4/3] bg-muted">
        {item.thumbUrl ? (
          <Image
            unoptimized
            fill
            sizes="(min-width: 1024px) 25vw, 50vw"
            src={item.thumbUrl}
            alt={item.title}
            className="object-cover"
          />
        ) : (
          <span className="flex h-full items-center justify-center text-primary">
            <Package size={34} aria-hidden />
          </span>
        )}
        {item.isNew && (
          <span className="absolute top-2 left-2 rounded-full bg-accent px-2.5 py-1 text-xs font-extrabold text-accent-foreground">
            Baru
          </span>
        )}
      </div>
      <div className="flex flex-1 flex-col p-3 sm:p-4">
        <h3 className="line-clamp-2 min-h-[2.6em] text-sm leading-snug font-bold group-hover:text-primary">
          {item.title}
        </h3>
        <p className="tabular mt-2 text-base font-extrabold">
          {rupiah(item.pricePerDay)}
          <span className="text-xs font-semibold text-muted-foreground">/hari</span>
        </p>
        <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
          <Star size={13} className="shrink-0 fill-accent text-accent" aria-hidden />
          {item.ratingCount
            ? `${(item.ratingAvg / 100).toFixed(1)} (${item.ratingCount} ulasan)`
            : "Belum ada ulasan"}
        </p>
        <p className="mt-1 flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
          <MapPin size={13} className="shrink-0" aria-hidden />
          <span className="truncate">
            {[item.pointName, item.campus].filter(Boolean).join(" · ")}
          </span>
        </p>
      </div>
    </>
  );
  return preview ? (
    <div className={classes}>{content}</div>
  ) : (
    <Link href={`/barang/${item.id}`} className={classes}>
      {content}
    </Link>
  );
}
export function ItemCardSkeleton() {
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card" aria-hidden>
      <div className="skeleton aspect-[4/3] rounded-none" />
      <div className="space-y-2 p-4">
        <div className="skeleton h-4 w-4/5" />
        <div className="skeleton h-4 w-1/2" />
        <div className="skeleton h-3 w-2/3" />
      </div>
    </div>
  );
}
