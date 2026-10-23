import { and, eq, lt } from "drizzle-orm";
import type { Database } from "@/src/db";
import { rentals } from "@/src/db/schema";
import { lockRental, transitionRental } from "@/src/services/rental-service";
import { settleRental } from "@/src/services/settlement-service";
import { notify } from "@/src/services/notification-service";

export async function expireRentals(db: Database, kind: "requests" | "payments") {
  const state = kind === "requests" ? "DIAJUKAN" : "DISETUJUI";
  const deadline = kind === "requests" ? rentals.respondBy : rentals.payBy;
  const candidates = await db
    .select({ id: rentals.id })
    .from(rentals)
    .where(and(eq(rentals.status, state), lt(deadline, new Date())))
    .limit(100);
  let expired = 0;
  for (const { id } of candidates)
    await db.transaction(async (tx) => {
      const rental = await lockRental(tx, id),
        due = kind === "requests" ? rental.respondBy : rental.payBy;
      if (rental.status !== state || !due || due > new Date()) return;
      const next = await transitionRental(
        tx,
        rental,
        "KADALUARSA",
        { type: "system" },
        { job: `expire-${kind}` },
      );
      await settleRental(tx, next);
      await notify(
        tx,
        rental.renterId,
        "rental_expired",
        "Transaksi kedaluwarsa",
        `${rental.publicCode}: batas ${kind === "requests" ? "tanggapan pemilik" : "pembayaran"} telah lewat.`,
        `/transaksi/${rental.id}`,
      );
      if (kind === "payments")
        await notify(
          tx,
          rental.ownerId,
          "rental_expired",
          "Jadwal tersedia kembali",
          `${rental.publicCode} kedaluwarsa karena batas pembayaran berakhir.`,
          `/transaksi/${rental.id}`,
        );
      expired++;
    });
  return { expired };
}
