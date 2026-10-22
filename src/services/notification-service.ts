import { and, eq, inArray } from "drizzle-orm";
import type { Executor } from "@/src/db";
import { notifications, notificationDeliveries, users } from "@/src/db/schema";

export async function notify(
  tx: Executor,
  userId: string,
  type: string,
  title: string,
  body: string,
  link: string,
) {
  const [row] = await tx
    .insert(notifications)
    .values({ userId, type, title, body, link })
    .returning();
  return row;
}
export async function notifyAdmins(tx: Executor, title: string, body: string, link: string) {
  const admins = await tx
    .select({ id: users.id })
    .from(users)
    .where(and(inArray(users.role, ["admin", "super_admin"]), eq(users.accountStatus, "aktif")));
  let first: typeof notifications.$inferSelect | undefined;
  for (const admin of admins) {
    const row = await notify(tx, admin.id, "admin_task", title, body, link);
    first ??= row;
  }
  const group = process.env.TELEGRAM_ADMIN_CHAT_ID;
  if (first && group && /^-?\d+$/.test(group))
    await tx
      .insert(notificationDeliveries)
      .values({ notificationId: first.id, chatId: Number(group) });
}
