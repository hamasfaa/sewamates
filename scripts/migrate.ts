import { readdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { Pool } from "pg";

const url = process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL;
if (!url) throw new Error("Isi DIRECT_DATABASE_URL atau DATABASE_URL sebelum migrasi.");
const pool = new Pool({ connectionString: url, max: 1 });
const client = await pool.connect();
try {
  await client.query("SELECT pg_advisory_lock(7391801)");
  await client.query(
    "CREATE TABLE IF NOT EXISTS _sewamates_migrations (name text PRIMARY KEY, hash text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())",
  );
  await client.query("ALTER TABLE _sewamates_migrations ENABLE ROW LEVEL SECURITY");
  for (const name of (await readdir("supabase/migrations"))
    .filter((name) => name.endsWith(".sql"))
    .sort()) {
    const source = await readFile(`supabase/migrations/${name}`, "utf8");
    const hash = createHash("sha256").update(source).digest("hex");
    const applied = await client.query<{ hash: string }>(
      "SELECT hash FROM _sewamates_migrations WHERE name = $1",
      [name],
    );
    if (applied.rows[0]) {
      if (applied.rows[0].hash !== hash)
        throw new Error(`Migrasi ${name} sudah diterapkan dengan isi berbeda. Buat migrasi baru.`);
      continue;
    }
    await client.query("BEGIN");
    try {
      await client.query(source);
      await client.query("INSERT INTO _sewamates_migrations(name, hash) VALUES ($1, $2)", [
        name,
        hash,
      ]);
      await client.query("COMMIT");
      console.log(`Migrasi diterapkan: ${name}`);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  }
} finally {
  await client.query("SELECT pg_advisory_unlock(7391801)");
  client.release();
  await pool.end();
}
