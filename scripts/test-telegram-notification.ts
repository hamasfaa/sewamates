import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { normalizePhone } from "../src/lib/validation";

const phoneArg = process.argv.indexOf("--phone");
if (phoneArg < 0 || !process.argv[phoneArg + 1])
  throw new Error("Gunakan npm run telegram:test -- --phone <nomor akun yang mengizinkan tes>.");
const phone = normalizePhone(process.argv[phoneArg + 1]);
const code = `UJI-TG-${randomUUID().slice(0, 8).toUpperCase()}`;
const pool = new Pool({
  connectionString: process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL,
  max: 1,
});
try {
  const client = await pool.connect();
  let deliveryId: string;
  try {
    await client.query("BEGIN");
    const actor = (
      await client.query(
        `SELECT id,telegram_chat_id,telegram_blocked_at FROM users
      WHERE phone=$1 AND account_status='aktif'`,
        [phone],
      )
    ).rows[0];
    if (!actor?.telegram_chat_id || actor.telegram_blocked_at)
      throw new Error("TEST_TELEGRAM_UNAVAILABLE");
    const notification = (
      await client.query(
        `INSERT INTO notifications(user_id,type,title,body,link)
      VALUES($1,'telegram_test','Tes notifikasi SewaMates',$2,'/notifikasi') RETURNING id`,
        [actor.id, `Event uji berhasil diproses.\nKode uji: ${code}`],
      )
    ).rows[0];
    const delivery = (
      await client.query(
        `INSERT INTO notification_deliveries(notification_id)
      VALUES($1) RETURNING id`,
        [notification.id],
      )
    ).rows[0];
    deliveryId = delivery.id;
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  // Deliberately never call a sender: only the database event may initiate the delivery.
  const deadline = Date.now() + 45000;
  let delivered = false;
  while (Date.now() < deadline) {
    const row = (
      await pool.query(
        `SELECT status,attempts,last_error,dispatch_request_id,telegram_message_id
      FROM notification_deliveries WHERE id=$1`,
        [deliveryId],
      )
    ).rows[0];
    if (row.status === "terkirim") {
      console.log(JSON.stringify({ code, deliveryId, ...row }));
      delivered = true;
      break;
    }
    if (row.status === "gagal" || row.last_error?.startsWith("WEBHOOK_")) {
      console.log(JSON.stringify({ code, deliveryId, ...row }));
      throw new Error("TEST_DELIVERY_FAILED");
    }
    await delay(1000);
  }
  if (!delivered) {
    console.log(JSON.stringify({ code, deliveryId, status: "pending" }));
    throw new Error("TEST_DELIVERY_NOT_CONFIRMED");
  }
} catch (error) {
  const issue = error as Error & { code?: string };
  console.error(
    JSON.stringify({
      code: issue.message.startsWith("TEST_") ? issue.message : issue.code || "TEST_FAILED",
    }),
  );
  process.exitCode = 1;
} finally {
  await pool.end();
}
