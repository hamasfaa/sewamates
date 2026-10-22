import { Pool } from "pg";

const app = new URL(process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000");
const secret = process.env.INTERNAL_JOB_SECRET;
if (app.protocol !== "https:" || app.username || app.password || !secret || secret.length < 32)
  throw new Error("Isi NEXT_PUBLIC_APP_URL HTTPS dan INTERNAL_JOB_SECRET minimal 32 karakter.");
const pool = new Pool({
  connectionString: process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL,
  max: 1,
});
const client = await pool.connect();
try {
  await client.query("BEGIN");
  await client.query("SELECT pg_advisory_xact_lock(7391805)");
  const ready = (
    await client.query(`SELECT
    to_regclass('vault.secrets') IS NOT NULL AS vault,
    to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') IS NOT NULL AS networking,
    to_regprocedure('public.dispatch_telegram_delivery(uuid)') IS NOT NULL AS webhook`)
  ).rows[0];
  if (!ready.vault || !ready.networking || !ready.webhook)
    throw new Error("Aktifkan pg_net dan Vault, lalu jalankan npm run db:migrate terlebih dahulu.");
  const endpoint = new URL("/api/internal/notifications/deliver", app).toString();
  for (const [name, value, description] of [
    ["sewamates_notification_url", endpoint, "Endpoint HTTPS pengiriman Telegram berbasis event"],
    [
      "sewamates_notification_secret",
      secret,
      "Secret webhook Telegram, sesuai INTERNAL_JOB_SECRET aplikasi",
    ],
  ]) {
    const found = (await client.query("SELECT id FROM vault.secrets WHERE name=$1", [name]))
      .rows[0];
    if (found)
      await client.query("SELECT vault.update_secret($1::uuid,$2::text,$3::text,$4::text)", [
        found.id,
        value,
        name,
        description,
      ]);
    else
      await client.query("SELECT vault.create_secret($1::text,$2::text,$3::text)", [
        value,
        name,
        description,
      ]);
  }
  await client.query("COMMIT");
  console.log(
    "Webhook Telegram terpasang. Cron Telegram tidak digunakan; secret tidak ditampilkan.",
  );
} catch (error) {
  await client.query("ROLLBACK");
  // SQL exceptions may include query parameters; keep secret values out of terminal logs.
  console.error(
    error instanceof Error && error.message.startsWith("Aktifkan")
      ? error.message
      : "Konfigurasi webhook Telegram gagal. Periksa pg_net, Vault, dan migrasi 0007.",
  );
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
