import { Pool } from "pg";
import { DEFAULT_SETTINGS } from "../src/domain/settings";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "../src/db/schema";
import { importCampusSnapshot } from "../src/services/campus-service";
import snapshot from "../data/campuses/indonesia.json";
import { bootstrapSuperAdmin } from "./lib/bootstrap-super-admin";
const url = process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL;
if (!url) throw new Error("Isi DATABASE_URL sebelum menjalankan seed.");
const pool = new Pool({ connectionString: url, max: 1 }),
  client = await pool.connect();
try {
  await client.query("BEGIN");
  const db = drizzle(client, { schema });
  const count = await importCampusSnapshot(db, snapshot);
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    await client.query(
      "INSERT INTO settings(key, value) VALUES ($1, $2::jsonb) ON CONFLICT (key) DO NOTHING",
      [key, JSON.stringify(value)],
    );
  }
  if (process.env.SEED_SUPER_ADMIN_PHONE)
    await bootstrapSuperAdmin(db, process.env.SEED_SUPER_ADMIN_PHONE);
  await client.query("COMMIT");
  console.log(`Seed ${count} kampus Indonesia, settings, dan bootstrap opsional selesai.`);
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}
