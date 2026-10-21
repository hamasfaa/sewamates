import { ChevronLeft, ChevronRight } from "lucide-react";
import { DAY_LABELS } from "@/src/domain/pickup-points";
import { monthDays } from "@/src/domain/availability";
import { cn } from "@/src/lib/utils";
import { Button } from "./ui/button";

const monthTitle = (month: string) =>
  new Intl.DateTimeFormat("id-ID", { month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(`${month}-01T00:00:00Z`),
  );
// Read-only month view (Monday first) marking unavailable WIB dates.
export function MonthCalendar({
  month,
  today,
  unavailable,
  onPrev,
  onNext,
  canPrev = true,
  canNext = true,
  busy = false,
}: {
  month: string;
  today: string;
  unavailable: string[];
  onPrev: () => void;
  onNext: () => void;
  canPrev?: boolean;
  canNext?: boolean;
  busy?: boolean;
}) {
  const days = monthDays(month),
    blocked = new Set(unavailable),
    title = monthTitle(month);
  const offset = (new Date(`${month}-01T00:00:00Z`).getUTCDay() + 6) % 7;
  return (
    <div aria-busy={busy} className="mx-auto max-w-sm">
      <div className="mb-3 flex items-center justify-between gap-2">
        <Button
          variant="ghost"
          size="icon"
          onClick={onPrev}
          disabled={!canPrev}
          aria-label="Bulan sebelumnya"
        >
          <ChevronLeft size={20} />
        </Button>
        <p className="text-sm font-bold capitalize" aria-live="polite">
          {title}
        </p>
        <Button
          variant="ghost"
          size="icon"
          onClick={onNext}
          disabled={!canNext}
          aria-label="Bulan berikutnya"
        >
          <ChevronRight size={20} />
        </Button>
      </div>
      <div
        className="grid grid-cols-7 gap-1 text-center text-xs font-semibold text-muted-foreground"
        aria-hidden
      >
        {DAY_LABELS.map((label) => (
          <span key={label} className="py-1">
            {label}
          </span>
        ))}
      </div>
      <ul
        className={cn("mt-1 grid grid-cols-7 gap-1", busy && "opacity-60")}
        aria-label={`Ketersediaan ${title}`}
      >
        {Array.from({ length: offset }, (_, i) => (
          <li key={`pad-${i}`} aria-hidden />
        ))}
        {days.map((day) => {
          const past = day < today,
            off = blocked.has(day);
          const label = `${Number(day.slice(8))} ${title}: ${past ? "sudah lewat" : off ? "tidak tersedia" : "tersedia"}`;
          return (
            <li
              key={day}
              aria-label={label}
              className={cn(
                "tabular flex aspect-square min-h-9 items-center justify-center rounded-xl text-sm font-semibold",
                past
                  ? "text-muted-foreground/50"
                  : off
                    ? "bg-[var(--color-danger-bg)] text-[var(--color-danger)] line-through"
                    : "bg-background",
                day === today && "ring-2 ring-primary",
              )}
            >
              {Number(day.slice(8))}
            </li>
          );
        })}
      </ul>
      <div className="mt-3 flex flex-wrap gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="size-3 rounded bg-background ring-1 ring-border" />
          Tersedia
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-3 rounded bg-[var(--color-danger-bg)] ring-1 ring-[var(--color-danger)]" />
          Tidak tersedia
        </span>
      </div>
    </div>
  );
}
