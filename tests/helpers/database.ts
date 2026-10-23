import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { drizzle as drizzleLite } from "drizzle-orm/pglite";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { readdir, readFile } from "node:fs/promises";
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { Database } from "@/src/db";
import * as schema from "@/src/db/schema";
import { DEFAULT_SETTINGS } from "@/src/domain/settings";

export async function testDatabase() {
  let db: Database, close: () => Promise<void>, execRaw: (source: string) => Promise<unknown>;
  if (process.env.TEST_DATABASE_URL) {
    if (new URL(process.env.TEST_DATABASE_URL).pathname !== "/sewamates_test")
      throw new Error("Tes PostgreSQL hanya boleh memakai database bernama sewamates_test.");
    const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 8 });
    db = drizzle(pool, { schema });
    close = () => pool.end();
    execRaw = (source) => pool.query(source);
    await execRaw("DROP SCHEMA public CASCADE; CREATE SCHEMA public");
  } else {
    const lite = new PGlite({ extensions: { btree_gist } });
    // Drizzle's PostgreSQL query and transaction APIs are shared by both drivers.
    db = drizzleLite(lite, { schema }) as unknown as Database;
    close = () => lite.close();
    execRaw = (source) => lite.exec(source);
  }
  await execRaw(
    "DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF; IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF; END $$; GRANT USAGE ON SCHEMA public TO authenticated, anon;",
  );
  for (const name of (await readdir("supabase/migrations"))
    .filter((file) => file.endsWith(".sql"))
    .sort())
    await execRaw(await readFile(`supabase/migrations/${name}`, "utf8"));
  return { db, close };
}
export const campusId = "00000000-0000-4000-8000-000000000001";
let sequence = 0;
export async function resetDatabase(db: Database) {
  await db.execute(
    sql`TRUNCATE campuses, users, identity_verifications, payout_accounts, sessions, login_requests, action_confirmations, telegram_updates, settings, admin_audit_logs, notifications, upload_tickets, idempotency_keys, categories, pickup_points, items, item_photos, item_pickup_points, availability_blocks, platform_accounts, delivery_throttles, sent_alerts CASCADE`,
  );
  await db.insert(schema.campuses).values({ id: campusId, name: "Kampus Surabaya" });
  await db
    .insert(schema.settings)
    .values(Object.entries(DEFAULT_SETTINGS).map(([key, value]) => ({ key, value })));
}
export async function user(db: Database, patch: Partial<typeof schema.users.$inferInsert> = {}) {
  const id = ++sequence;
  const [row] = await db
    .insert(schema.users)
    .values({
      id: randomUUID(),
      phone: `+62812345${String(id).padStart(5, "0")}`,
      name: "Teman Kampus",
      campusId,
      termsAcceptedAt: new Date(),
      termsVersion: "test",
      telegramUserId: id + 100000,
      telegramChatId: id + 100000,
      ...patch,
    })
    .returning();
  return row;
}
