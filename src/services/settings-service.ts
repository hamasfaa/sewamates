import type { Database, Executor } from "@/src/db";
import { settings, adminAuditLogs } from "@/src/db/schema";
import { DEFAULT_SETTINGS, settingsSchema, type Settings } from "@/src/domain/settings";
import { assert } from "@/src/lib/errors";
import type { User } from "@/src/db/schema";
import { mutation } from "@/src/db/mutation";
export async function getSettings(db: Executor): Promise<Settings> {
  const rows = await db.select().from(settings);
  return settingsSchema.parse({
    ...DEFAULT_SETTINGS,
    ...Object.fromEntries(rows.map((row) => [row.key, row.value])),
  });
}
export async function changeSettings(
  db: Database,
  actor: User,
  patch: Record<string, unknown>,
  key?: string,
) {
  assert(
    actor.role === "super_admin",
    "FORBIDDEN",
    "Hanya super admin yang dapat mengubah pengaturan.",
    403,
  );
  assert(Object.keys(patch).length > 0, "EMPTY_INPUT", "Pilih pengaturan yang akan diubah.");
  return mutation(db, actor.id, "settings", key, patch, async (tx) => {
    await tx.select().from(settings).for("update");
    const before = await getSettings(tx),
      next = settingsSchema.parse({ ...before, ...patch });
    for (const key of Object.keys(patch) as (keyof Settings)[]) {
      await tx
        .insert(settings)
        .values({ key, value: next[key], updatedBy: actor.id })
        .onConflictDoUpdate({
          target: settings.key,
          set: { value: next[key], updatedBy: actor.id },
        });
    }
    await tx
      .insert(adminAuditLogs)
      .values({
        adminId: actor.id,
        action: "settings_updated",
        targetType: "settings",
        targetId: "global",
        meta: {
          before: Object.fromEntries(
            Object.keys(patch).map((key) => [key, before[key as keyof Settings]]),
          ),
          after: patch,
        },
      });
    return next;
  });
}
