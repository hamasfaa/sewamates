import { rentTotal } from "@/src/domain/pricing";
import { cn, rupiah } from "@/src/lib/utils";

// One cost breakdown for detail, request, payment, and history screens (03 §1.5, §6).
export function CostSummary({
  pricePerDay,
  days,
  deposit,
  className,
}: {
  pricePerDay: number;
  days: number;
  deposit: number;
  className?: string;
}) {
  const rent = rentTotal(pricePerDay, days);
  return (
    <div className={cn("text-sm", className)}>
      <dl className="space-y-2.5">
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">
            Sewa {rupiah(pricePerDay)} × {days} hari
          </dt>
          <dd className="tabular font-semibold">{rupiah(rent)}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">Deposit (dikembalikan)</dt>
          <dd className="tabular font-semibold">{rupiah(deposit)}</dd>
        </div>
        <div className="flex justify-between gap-3 border-t border-border pt-3 text-base font-extrabold">
          <dt>Total dibayar</dt>
          <dd className="tabular">{rupiah(rent + deposit)}</dd>
        </div>
      </dl>
      <p className="mt-2 text-xs leading-5 text-muted-foreground">
        Kode unik 3 digit ditambahkan saat pembayaran dan ikut dikembalikan bersama deposit.
      </p>
    </div>
  );
}
