import type { Executor } from "@/src/db";
import { strikes, type Rental } from "@/src/db/schema";
import { getSettings } from "./settings-service";
import { notify } from "./notification-service";

export type StrikeReason = (typeof strikes.$inferInsert)["reason"];
const REASONS: Record<StrikeReason, string> = {
  batal_setelah_dibayar: "membatalkan transaksi yang sudah dibayar",
  tidak_hadir: "tidak hadir pada jadwal serah terima",
  terlambat: "terlambat mengembalikan barang melewati toleransi",
  sengketa: "putusan sengketa",
  laporan: "laporan yang terbukti",
};
// At most one strike per user, rental and reason (A-3.11). The auto-suspend job reviews active strikes every minute.
export async function giveStrike(
  tx: Executor,
  userId: string,
  reason: StrikeReason,
  rental: Pick<Rental, "id" | "publicCode">,
  givenBy?: string,
) {
  const rules = await getSettings(tx);
  const [strike] = await tx
    .insert(strikes)
    .values({
      userId,
      reason,
      rentalId: rental.id,
      givenBy,
      expiresAt: new Date(Date.now() + rules.strike_window_days * 86400000),
    })
    .onConflictDoNothing()
    .returning();
  if (strike)
    await notify(
      tx,
      userId,
      "strike_given",
      "Kamu mendapat strike",
      `${rental.publicCode}: ${REASONS[reason]}. ${rules.strike_limit} strike dalam ${rules.strike_window_days} hari membuat akun ditinjau admin.`,
      `/transaksi/${rental.id}`,
    );
  return strike ?? null;
}
