import { sql } from "drizzle-orm";
import type { Executor } from "@/src/db";
// Acquire before item/rental locks. New obligations cannot race suspension or deletion.
export async function lockAccountActivity(tx: Executor, ids: string[]) {
  for (const id of [...new Set(ids)].sort())
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`account-activity:${id}`}))`);
}
