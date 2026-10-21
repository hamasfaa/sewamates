import { z } from "zod";

// Monday first, matching how campus schedules are written. Times are WIB.
export const DAY_LABELS = ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"] as const;
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Gunakan format jam HH:MM.");
export const hoursSchema = z
  .array(
    z
      .object({ open: time, close: time })
      .strict()
      .refine((day) => day.open < day.close, "Jam tutup harus setelah jam buka.")
      .nullable(),
  )
  .length(7, "Isi jam untuk tujuh hari.")
  .refine((days) => days.some(Boolean), "Pilih minimal satu hari buka.");
export type PickupHours = z.infer<typeof hoursSchema>;
export const DEFAULT_HOURS: PickupHours = [
  ...Array.from({ length: 5 }, () => ({ open: "08:00", close: "17:00" })),
  { open: "08:00", close: "12:00" },
  null,
];

const clock = (value: string) => value.replace(":", ".");
// Groups consecutive days with the same window: ["Sen–Jum 08.00–17.00", "Sab 08.00–12.00"].
export function summarizeHours(hours: PickupHours) {
  const lines: string[] = [];
  for (let start = 0; start < hours.length;) {
    const day = hours[start];
    let end = start;
    while (
      end + 1 < hours.length &&
      hours[end + 1]?.open === day?.open &&
      hours[end + 1]?.close === day?.close
    )
      end++;
    if (day) {
      const days = start === end ? DAY_LABELS[start] : `${DAY_LABELS[start]}–${DAY_LABELS[end]}`;
      lines.push(`${days} ${clock(day.open)}–${clock(day.close)}`);
    }
    start = end + 1;
  }
  return lines;
}
