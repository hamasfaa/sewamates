import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { readFile } from "node:fs/promises";
import type { Database } from "@/src/db";
import * as s from "@/src/db/schema";
import { resetDatabase, testDatabase, user } from "./helpers/database";
import { notificationWebhook } from "@/src/lib/notification-webhook";
import { deliverNotificationEvent, deliverNotifications } from "@/src/jobs/deliver-notifications";
import { notify } from "@/src/services/notification-service";

const mocks = vi.hoisted(() => ({
  after: vi.fn(),
  sendMessage: vi.fn(),
  captureException: vi.fn(),
}));
vi.mock("next/server", async (original) => ({
  ...(await original<typeof import("next/server")>()),
  after: mocks.after,
}));
vi.mock("@sentry/nextjs", () => ({ captureException: mocks.captureException }));
vi.mock("@/src/services/telegram-api", () => ({ telegramApi: () => mocks }));
vi.mock("@/src/db", async (original) => ({
  ...(await original<typeof import("@/src/db")>()),
  getDb: () => db,
}));
let db: Database, close: () => Promise<void>, execRaw: (source: string) => Promise<unknown>;

beforeAll(async () => {
  ({ db, close, execRaw } = await testDatabase());
  // Local SQL stubs record the HTTP request transactionally, without making network calls.
  await db.execute(sql`CREATE SCHEMA vault`);
  await db.execute(sql`CREATE TABLE vault.decrypted_secrets(name text, decrypted_secret text)`);
  await db.execute(sql`CREATE SCHEMA net`);
  await db.execute(
    sql`CREATE TABLE net.requests(id bigserial PRIMARY KEY, url text, headers jsonb, body jsonb)`,
  );
  await db.execute(sql`CREATE FUNCTION net.http_post(url text, body jsonb DEFAULT '{}'::jsonb, params jsonb DEFAULT '{}'::jsonb,
      headers jsonb DEFAULT '{}'::jsonb, timeout_milliseconds integer DEFAULT 1000) RETURNS bigint
    LANGUAGE plpgsql AS $$ DECLARE request_id bigint; BEGIN
      IF url='https://fail.test' THEN RAISE EXCEPTION 'network configuration secret'; END IF;
      INSERT INTO net.requests(url,headers,body) VALUES(url,headers,body) RETURNING id INTO request_id;
      RETURN request_id; END $$;`);
});
afterAll(async () => {
  await db.execute(sql`DROP SCHEMA IF EXISTS vault CASCADE`);
  await db.execute(sql`DROP SCHEMA IF EXISTS net CASCADE`);
  await close?.();
});
beforeEach(async () => {
  await resetDatabase(db);
  await db.execute(sql`TRUNCATE net.requests, vault.decrypted_secrets`);
  vi.clearAllMocks();
  process.env.TELEGRAM_BOT_TOKEN = "test-only";
  process.env.INTERNAL_JOB_SECRET = "test-webhook-secret";
  mocks.sendMessage.mockResolvedValue({ message_id: 123 });
  await db.execute(sql`INSERT INTO vault.decrypted_secrets VALUES
    ('sewamates_notification_url','https://app.test/api/internal/notifications/deliver'),
    ('sewamates_notification_secret','test-webhook-secret')`);
});

async function event() {
  const actor = await user(db);
  const n = await notify(db, actor.id, "payment_decided", "Pembaruan", "Pengujian", "/transaksi");
  const [delivery] = await db
    .select()
    .from(s.notificationDeliveries)
    .where(eq(s.notificationDeliveries.notificationId, n.id));
  return { actor, n, delivery };
}
function request(deliveryId: string, token = "test-webhook-secret") {
  return new Request("https://app.test/api/internal/notifications/deliver", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ deliveryId }),
  });
}

describe("webhook Telegram dari event database", () => {
  it("cleans an already-applied browser delivery schema while preserving Telegram and in-app events", async () => {
    const actor = await user(db);
    const [session] = await db
      .insert(s.sessions)
      .values({
        userId: actor.id,
        tokenHash: "cleanup-session",
        expiresAt: new Date(Date.now() + 3600000),
      })
      .returning();
    const previous = await readFile("supabase/migrations/0011_sprint_5_trust_admin.sql", "utf8");
    const cleanup = await readFile("supabase/migrations/0012_remove_web_push.sql", "utf8");
    const tableStart = previous.indexOf("CREATE TABLE push_subscriptions");
    const tableEnd = previous.indexOf("DO $$ DECLARE", tableStart);
    const functionsStart = previous.indexOf(
      "CREATE OR REPLACE FUNCTION public.dispatch_telegram_delivery",
    );
    const functionsEnd = previous.indexOf(
      "CREATE TRIGGER notification_sprint5_outbox",
      functionsStart,
    );
    try {
      await execRaw(
        "ALTER TABLE notification_deliveries DROP CONSTRAINT notification_deliveries_telegram_only; ALTER TABLE users ADD COLUMN push_chat boolean NOT NULL DEFAULT true",
      );
      await execRaw(previous.slice(tableStart, tableEnd));
      await execRaw(
        previous
          .slice(functionsStart, functionsEnd)
          .replace(
            "CREATE FUNCTION enqueue_sprint5_notifications",
            "CREATE OR REPLACE FUNCTION enqueue_sprint5_notifications",
          ),
      );
      await db.execute(
        sql`INSERT INTO push_subscriptions(user_id,session_id,endpoint,p256dh,auth) VALUES(${actor.id},${session.id},'https://fcm.googleapis.com/fcm/send/test','dummy','dummy')`,
      );
      const n = await notify(
        db,
        actor.id,
        "dispute_decided",
        "Putusan",
        "Uji migrasi",
        "/transaksi",
      );
      const rows = await db
        .select()
        .from(s.notificationDeliveries)
        .where(eq(s.notificationDeliveries.notificationId, n.id));
      expect(rows.map((r) => r.channel).sort()).toEqual(["push", "telegram"]);
      const telegram = rows.find((r) => r.channel === "telegram")!;
      const browser = rows.find((r) => r.channel === "push")!;
      await db.execute(
        sql`INSERT INTO push_receipts(delivery_id,subscription_id) SELECT ${browser.id}::uuid,id FROM push_subscriptions WHERE user_id=${actor.id}`,
      );
      await execRaw(cleanup);
      expect(
        (
          await db.execute(
            sql`SELECT to_regclass('public.push_subscriptions') AS subscriptions, to_regclass('public.push_receipts') AS receipts, EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='users' AND column_name='push_chat') AS preference`,
          )
        ).rows[0],
      ).toEqual({ subscriptions: null, receipts: null, preference: false });
      expect(await db.select().from(s.notifications)).toHaveLength(1);
      expect(await db.select().from(s.notificationDeliveries)).toEqual([telegram]);
      await deliverNotificationEvent(db, telegram.id);
      expect(mocks.sendMessage).toHaveBeenCalledTimes(1);
      expect(mocks.sendMessage.mock.calls[0][0]).toBe(actor.telegramChatId);
    } finally {
      await execRaw(cleanup);
    }
  });
  it.each([
    "handover_arrived",
    "handover_completed",
    "return_completed",
    "return_check_confirmed",
    "review_ending",
    "payout_scheduled",
    "dispute_evidence",
    "dispute_responded",
    "dispute_decided",
    "account_suspended",
    "account_reactivated",
    "account_counterparty_suspended",
  ])(
    "event transaksi %s mengantrekan webhook dan mengirim ke penerima yang tertaut",
    async (type) => {
      const actor = await user(db);
      const notification = await notify(
        db,
        actor.id,
        type,
        "Pembaruan transaksi",
        "Event pengujian",
        "/transaksi",
      );
      const [delivery] = await db
        .select()
        .from(s.notificationDeliveries)
        .where(eq(s.notificationDeliveries.notificationId, notification.id));
      expect(delivery).toMatchObject({ status: "antre", chatId: null });
      expect(delivery.dispatchRequestId).not.toBeNull();
      expect((await db.execute(sql`SELECT body FROM net.requests`)).rows).toEqual([
        { body: { deliveryId: delivery.id } },
      ]);
      expect((await notificationWebhook(request(delivery.id))).status).toBe(202);
      await mocks.after.mock.calls[0][0]();
      expect(mocks.sendMessage).toHaveBeenCalledTimes(1);
      expect(mocks.sendMessage.mock.calls[0][0]).toBe(actor.telegramChatId);
      await deliverNotificationEvent(db, delivery.id);
      expect(mocks.sendMessage).toHaveBeenCalledTimes(1);
    },
  );
  it.each(["chat_message", "admin_task"])("%s tidak membuat DM Telegram otomatis", async (type) => {
    const actor = await user(db);
    await notify(db, actor.id, type, "Pembaruan", "In-app", "/notifikasi");
    expect(await db.select().from(s.notificationDeliveries)).toHaveLength(0);
    expect((await db.execute(sql`SELECT * FROM net.requests`)).rows).toHaveLength(0);
  });
  it("insert event langsung mencatat webhook dengan satu deliveryId, tanpa cron atau request aplikasi", async () => {
    const f = await event();
    const result = await db.execute<{ id: string; body: { deliveryId: string }; url: string }>(
      sql`SELECT id,body,url FROM net.requests`,
    );
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].body).toEqual({ deliveryId: f.delivery.id });
    expect(result.rows[0].url).toBe("https://app.test/api/internal/notifications/deliver");
    expect(f.delivery.dispatchRequestId).toBe(Number(result.rows[0].id));
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });
  it("rollback membatalkan notifikasi, outbox, dan HTTP request sekaligus", async () => {
    const actor = await user(db);
    await expect(
      db.transaction(async (tx) => {
        await notify(tx, actor.id, "payment_decided", "Pembaruan", "Rollback", "/profil");
        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");
    expect(await db.select().from(s.notificationDeliveries)).toHaveLength(0);
    expect((await db.execute(sql`SELECT * FROM net.requests`)).rows).toHaveLength(0);
  });
  it("konfigurasi webhook yang hilang tidak menggagalkan aksi bisnis", async () => {
    await db.execute(sql`TRUNCATE vault.decrypted_secrets`);
    const f = await event();
    expect(f.delivery.status).toBe("antre");
    expect(f.delivery.lastError).toBe("WEBHOOK_NOT_CONFIGURED");
  });
  it("gagal mengantrekan HTTP tetap menyimpan event tanpa membocorkan secret", async () => {
    await db.execute(
      sql`UPDATE vault.decrypted_secrets SET decrypted_secret='https://fail.test' WHERE name='sewamates_notification_url'`,
    );
    const f = await event();
    expect(f.delivery.lastError).toBe("WEBHOOK_DISPATCH_FAILED");
    expect(f.delivery.status).toBe("antre");
  });
  it("webhook hanya mengirim ke delivery yang diminta dan tidak menguras antrean pengguna lain", async () => {
    const first = await event(),
      second = await event();
    const response = await notificationWebhook(request(second.delivery.id));
    expect(response.status).toBe(202);
    expect(mocks.sendMessage).not.toHaveBeenCalled();
    await mocks.after.mock.calls[0][0]();
    expect(mocks.sendMessage).toHaveBeenCalledTimes(1);
    expect(mocks.sendMessage.mock.calls[0][0]).toBe(second.actor.telegramChatId);
    const rows = await db.select().from(s.notificationDeliveries);
    expect(rows.find((d) => d.id === first.delivery.id)?.status).toBe("antre");
    expect(rows.find((d) => d.id === second.delivery.id)?.telegramMessageId).toBe(123);
  });
  it("callback duplikat tidak mengirim ulang pesan yang sudah terkirim", async () => {
    const f = await event();
    await Promise.all([
      deliverNotificationEvent(db, f.delivery.id),
      deliverNotificationEvent(db, f.delivery.id),
    ]);
    await deliverNotificationEvent(db, f.delivery.id);
    expect(mocks.sendMessage).toHaveBeenCalledTimes(1);
  });
  it("autorisasi salah dan payload tidak valid tidak memicu worker", async () => {
    expect((await notificationWebhook(request(crypto.randomUUID(), "wrong"))).status).toBe(403);
    expect((await notificationWebhook(request("invalid"))).status).toBe(422);
    expect(mocks.after).not.toHaveBeenCalled();
  });
  it("batas callback menghormati retry_after tanpa menunggu tanpa batas", async () => {
    const f = await event();
    await db
      .update(s.notificationDeliveries)
      .set({ nextAttemptAt: new Date(Date.now() + 120000) })
      .where(eq(s.notificationDeliveries.id, f.delivery.id));
    expect(await deliverNotificationEvent(db, f.delivery.id, { maxDurationMs: 50 })).toEqual({
      status: "pending_retry",
    });
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });
  it("retry yang sudah waktunya dikirim lagi tanpa memanggil cron", async () => {
    const f = await event();
    mocks.sendMessage.mockRejectedValueOnce({ error_code: 429, parameters: { retry_after: 120 } });
    await deliverNotifications(db, { deliveryIds: [f.delivery.id] });
    await db
      .update(s.notificationDeliveries)
      .set({ nextAttemptAt: new Date(Date.now() - 1) })
      .where(eq(s.notificationDeliveries.id, f.delivery.id));
    expect(await deliverNotificationEvent(db, f.delivery.id)).toEqual({ status: "terkirim" });
    expect(mocks.sendMessage).toHaveBeenCalledTimes(2);
  });
  it("daftar target kosong tidak mengirim pesan ke siapa pun", async () => {
    await event();
    expect((await deliverNotifications(db, { deliveryIds: [] })).sent).toBe(0);
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });
});
