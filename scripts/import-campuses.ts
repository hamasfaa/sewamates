import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "../src/db/schema";
import { importCampusSnapshot } from "../src/services/campus-service";
import snapshot from "../data/campuses/indonesia.json";

const url = process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL;
if (!url) throw new Error("Isi DATABASE_URL sebelum mengimpor kampus.");
const pool = new Pool({ connectionString: url, max: 1 });
const client = await pool.connect();
try {
  await client.query("BEGIN");
  const count = await importCampusSnapshot(drizzle(client, { schema }), snapshot);
  await client.query("COMMIT");
  console.log(`Impor ${count} kampus Indonesia selesai. ID profil dan pengaturan tetap tersimpan.`);
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}
