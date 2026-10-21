import { and, inArray, lt } from "drizzle-orm";
import type { Database } from "@/src/db";
import {
  actionConfirmations,
  idempotencyKeys,
  loginRequests,
  telegramUpdates,
  uploadTickets,
} from "@/src/db/schema";
export async function expireLoginRequests(db: Database, now = new Date()) {
  return db.transaction(async (tx) => {
    const login = await tx
      .update(loginRequests)
      .set({ status: "kedaluwarsa" })
      .where(
        and(
          inArray(loginRequests.status, ["menunggu", "disetujui"]),
          lt(loginRequests.expiresAt, now),
        ),
      )
      .returning({ id: loginRequests.id });
    const confirmations = await tx
      .update(actionConfirmations)
      .set({ status: "kedaluwarsa" })
      .where(
        and(
          inArray(actionConfirmations.status, ["menunggu"]),
          lt(actionConfirmations.expiresAt, now),
        ),
      )
      .returning({ id: actionConfirmations.id });
    const cutoff = new Date(now.getTime() - 7 * 86400000);
    await tx.delete(loginRequests).where(lt(loginRequests.expiresAt, cutoff));
    await tx.delete(actionConfirmations).where(lt(actionConfirmations.expiresAt, cutoff));
    await tx.delete(telegramUpdates).where(lt(telegramUpdates.receivedAt, cutoff));
    await tx.delete(uploadTickets).where(lt(uploadTickets.expiresAt, cutoff));
    await tx.delete(idempotencyKeys).where(lt(idempotencyKeys.expiresAt, now));
    return { expiredLogins: login.length, expiredConfirmations: confirmations.length };
  });
}
