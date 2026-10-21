import { eq, sql } from "drizzle-orm";
import type { Database, Executor } from ".";
import { idempotencyKeys } from "./schema";
import { hash } from "@/src/lib/crypto";
import { assert } from "@/src/lib/errors";
export async function mutation<T>(
  db: Database,
  userId: string,
  scope: string,
  key: string | undefined,
  input: unknown,
  work: (tx: Executor) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    const id = key ? hash(`${userId}:${scope}:${key}`) : undefined,
      requestHash = hash(JSON.stringify(input));
    if (id) {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`mutation:${id}`}))`);
      const [saved] = await tx.select().from(idempotencyKeys).where(eq(idempotencyKeys.id, id));
      if (saved && saved.expiresAt > new Date()) {
        assert(
          saved.requestHash === requestHash,
          "IDEMPOTENCY_CONFLICT",
          "Kunci permintaan sudah digunakan dengan data berbeda.",
          409,
        );
        return saved.response as T;
      }
      if (saved) await tx.delete(idempotencyKeys).where(eq(idempotencyKeys.id, id));
    }
    const result = await work(tx);
    if (id)
      await tx
        .insert(idempotencyKeys)
        .values({
          id,
          userId,
          requestHash,
          response: result,
          expiresAt: new Date(Date.now() + 7 * 86400000),
        });
    return result;
  });
}
