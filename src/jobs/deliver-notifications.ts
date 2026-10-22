import { InlineKeyboard } from "grammy";
import { and, asc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import type { Database } from "@/src/db";
import {
  deliveryThrottles,
  notificationDeliveries as deliveries,
  notifications,
  users,
} from "@/src/db/schema";
import { telegramApi } from "@/src/services/telegram-api";
import { appUrl } from "@/src/lib/env";
import { setTimeout as delay } from "node:timers/promises";

export async function deliverNotifications(
  db: Database,
  options: { maxDurationMs?: number; deliveryIds?: string[] } = {},
) {
  if (!process.env.TELEGRAM_BOT_TOKEN)
    return { attempted: 0, sent: 0, skipped: "TELEGRAM_NOT_CONFIGURED" };
  if (options.deliveryIds?.length === 0) return { attempted: 0, sent: 0 };
  let attempted = 0,
    sent = 0;
  const deadline = Date.now() + (options.maxDurationMs ?? 8000);
  for (let i = 0; i < 30 && Date.now() < deadline; i++) {
    const claim = await db.transaction(async (tx) => {
      const now = new Date();
      const [delivery] = await tx
        .select()
        .from(deliveries)
        .where(
          and(
            eq(deliveries.status, "antre"),
            options.deliveryIds ? inArray(deliveries.id, options.deliveryIds) : undefined,
            lte(deliveries.nextAttemptAt, sql`now()`),
            or(isNull(deliveries.claimedUntil), lte(deliveries.claimedUntil, now)),
          ),
        )
        .orderBy(asc(deliveries.nextAttemptAt), asc(deliveries.createdAt), asc(deliveries.id))
        .limit(1)
        .for("update", { skipLocked: true });
      if (!delivery) return null;
      const [row] = await tx
        .select({ notification: notifications, user: users })
        .from(notifications)
        .innerJoin(users, eq(users.id, notifications.userId))
        .where(eq(notifications.id, delivery.notificationId));
      const chatId = delivery.chatId ?? row.user.telegramChatId;
      if (!chatId || (!delivery.chatId && row.user.telegramBlockedAt)) {
        await tx
          .update(deliveries)
          .set({ status: "gagal", lastError: "TELEGRAM_UNAVAILABLE", claimedUntil: null })
          .where(eq(deliveries.id, delivery.id));
        return { skipped: true as const };
      }
      await tx.execute(sql`SELECT pg_advisory_xact_lock(7391804)`);
      const keys = ["global", `chat:${chatId}`];
      for (const key of keys)
        await tx.insert(deliveryThrottles).values({ key, nextAt: now }).onConflictDoNothing();
      const limits = await tx
        .select()
        .from(deliveryThrottles)
        .where(or(eq(deliveryThrottles.key, keys[0]), eq(deliveryThrottles.key, keys[1])))
        .for("update");
      const permit = Math.max(now.getTime(), ...limits.map((l) => l.nextAt.getTime()));
      if (permit > now.getTime()) {
        await tx
          .update(deliveries)
          .set({ nextAttemptAt: new Date(permit) })
          .where(eq(deliveries.id, delivery.id));
        return { skipped: true as const };
      }
      await tx
        .update(deliveryThrottles)
        .set({ nextAt: new Date(now.getTime() + 35) })
        .where(eq(deliveryThrottles.key, "global"));
      await tx
        .update(deliveryThrottles)
        .set({ nextAt: new Date(now.getTime() + (chatId < 0 ? 3000 : 1000)) })
        .where(eq(deliveryThrottles.key, keys[1]));
      await tx
        .update(deliveries)
        .set({ attempts: delivery.attempts + 1, claimedUntil: new Date(now.getTime() + 60000) })
        .where(eq(deliveries.id, delivery.id));
      return { skipped: false as const, delivery, row, chatId };
    });
    if (!claim) {
      // Wait outside the transaction for short rate-limit delays, not long retry backoffs.
      const [pending] = await db
        .select({ nextAttemptAt: deliveries.nextAttemptAt })
        .from(deliveries)
        .where(
          and(
            eq(deliveries.status, "antre"),
            options.deliveryIds ? inArray(deliveries.id, options.deliveryIds) : undefined,
            or(isNull(deliveries.claimedUntil), lte(deliveries.claimedUntil, new Date())),
          ),
        )
        .orderBy(asc(deliveries.nextAttemptAt))
        .limit(1);
      if (!pending) break;
      const wait = pending.nextAttemptAt.getTime() - Date.now() + 5;
      if (wait <= 0 || wait > 3010 || Date.now() + wait >= deadline) break;
      await delay(wait);
      continue;
    }
    if (claim.skipped) continue;
    attempted++;
    const { delivery, row, chatId } = claim;
    try {
      const link = new URL(
        row.notification.link.startsWith("/") && !row.notification.link.startsWith("//")
          ? row.notification.link
          : "/notifikasi",
        appUrl(),
      ).toString();
      const timeoutSeconds = Math.max(0.001, Math.min(8, (deadline - Date.now()) / 1000));
      const message = await telegramApi(timeoutSeconds).sendMessage(
        chatId,
        `${row.notification.title}\n\n${row.notification.body}`,
        { reply_markup: new InlineKeyboard().url("Buka di SewaMates", link) },
      );
      await db
        .update(deliveries)
        .set({
          status: "terkirim",
          claimedUntil: null,
          lastError: null,
          telegramMessageId: message.message_id,
        })
        .where(eq(deliveries.id, delivery.id));
      sent++;
    } catch (error) {
      const issue = error as { error_code?: number; parameters?: { retry_after?: number } };
      const blocked = issue.error_code === 403,
        attempts = delivery.attempts + 1;
      if (blocked && !delivery.chatId)
        await db
          .update(users)
          .set({ telegramBlockedAt: new Date() })
          .where(eq(users.id, row.user.id));
      const seconds = Math.max(
        issue.parameters?.retry_after || 0,
        Math.min(3600, 2 ** attempts * 5),
      );
      await db
        .update(deliveries)
        .set({
          status: blocked || attempts >= 5 ? "gagal" : "antre",
          claimedUntil: null,
          lastError: issue.error_code ? `TELEGRAM_${issue.error_code}` : "DELIVERY_FAILED",
          nextAttemptAt: new Date(Date.now() + seconds * 1000),
        })
        .where(eq(deliveries.id, delivery.id));
    }
  }
  return { attempted, sent };
}

// One database event owns one delivery, including bounded retries; no periodic worker is needed.
export async function deliverNotificationEvent(
  db: Database,
  deliveryId: string,
  options: { maxDurationMs?: number } = {},
) {
  const deadline = Date.now() + (options.maxDurationMs ?? 240000);
  while (Date.now() < deadline) {
    const [delivery] = await db.select().from(deliveries).where(eq(deliveries.id, deliveryId));
    if (!delivery || delivery.status !== "antre")
      return { status: delivery?.status ?? "not_found" };
    if (delivery.claimedUntil && delivery.claimedUntil > new Date()) return { status: "claimed" };
    const wait = Math.max(0, delivery.nextAttemptAt.getTime() - Date.now());
    if (Date.now() + wait + 10 >= deadline) break;
    if (wait) await delay(wait + 5);
    const result = await deliverNotifications(db, {
      deliveryIds: [deliveryId],
      maxDurationMs: Math.min(8000, deadline - Date.now()),
    });
    if (result.skipped) return { status: result.skipped };
  }
  return { status: "pending_retry" };
}
