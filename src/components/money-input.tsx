import { cn } from "@/src/lib/utils";
import { Input } from "./ui/input";

// Rupiah field with thousand separators; the value stays an integer (or null when empty).
export function MoneyInput({
  value,
  onChange,
  className,
  ...props
}: Omit<React.ComponentProps<"input">, "value" | "onChange"> & {
  value: number | null;
  onChange: (value: number | null) => void;
}) {
  return (
    <div className="relative">
      <span
        className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-sm font-bold text-muted-foreground"
        aria-hidden
      >
        Rp
      </span>
      <Input
        {...props}
        inputMode="numeric"
        autoComplete="off"
        className={cn("tabular pl-11", className)}
        value={value === null ? "" : value.toLocaleString("id-ID")}
        onChange={(event) => {
          const digits = event.target.value.replace(/\D/g, "").slice(0, 10);
          onChange(digits ? Number(digits) : null);
        }}
      />
    </div>
  );
}
