import { and, eq, isNotNull, isNull } from "drizzle-orm";
import type { Executor } from "../../src/db";
import { adminAuditLogs, sessions, users } from "../../src/db/schema";
import { normalizePhone } from "../../src/lib/validation";

// Run within the seed transaction so role, sessions, and audit commit together.
export async function bootstrapSuperAdmin(db: Executor, rawPhone: string) {
  const phone = normalizePhone(rawPhone);
  const [account] = await db
    .select({ id: users.id, role: users.role })
    .from(users)
    .where(
      and(
        eq(users.phone, phone),
        isNotNull(users.telegramUserId),
        eq(users.accountStatus, "aktif"),
      ),
    )
    .for("update");
  if (!account)
    throw new Error(
      "Calon super admin harus login lewat Telegram terlebih dahulu. Seed tidak membuat identitas palsu.",
    );
  if (account.role === "super_admin") return;

  await db.update(users).set({ role: "super_admin" }).where(eq(users.id, account.id));
  await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.userId, account.id), isNull(sessions.revokedAt)));
  // Bind UUID admin_id and text target_id separately, even for the same value.
  await db.insert(adminAuditLogs).values({
    adminId: account.id,
    action: "bootstrap_super_admin",
    targetType: "users",
    targetId: account.id,
    meta: { source: "seed", previousRole: account.role },
  });
}
