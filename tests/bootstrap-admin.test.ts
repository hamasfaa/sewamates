import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { Database } from "@/src/db";
import { adminAuditLogs, sessions, users } from "@/src/db/schema";
import { bootstrapSuperAdmin } from "../scripts/lib/bootstrap-super-admin";
import { resetDatabase, testDatabase, user } from "./helpers/database";

let db: Database, close: () => Promise<void>;
beforeAll(async () => {
  ({ db, close } = await testDatabase());
});
afterAll(async () => close?.());
beforeEach(async () => resetDatabase(db));

async function session(userId: string) {
  const [row] = await db
    .insert(sessions)
    .values({
      userId,
      tokenHash: crypto.randomUUID(),
      expiresAt: new Date(Date.now() + 3600000),
    })
    .returning();
  return row;
}

describe("Bootstrap super admin", () => {
  it("menaikkan role, mencabut sesi, dan mencatat UUID admin serta target teks dalam satu transaksi", async () => {
    const actor = await user(db);
    await session(actor.id);
    await session(actor.id);
    await db.transaction((tx) => bootstrapSuperAdmin(tx, actor.phone));
    const [saved] = await db.select().from(users).where(eq(users.id, actor.id));
    expect(saved.role).toBe("super_admin");
    const rows = await db.select().from(sessions);
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.revokedAt instanceof Date)).toBe(true);
    expect(await db.select().from(adminAuditLogs)).toEqual([
      expect.objectContaining({
        adminId: actor.id,
        action: "bootstrap_super_admin",
        targetType: "users",
        targetId: actor.id,
        meta: { source: "seed", previousRole: "user" },
      }),
    ]);
  });

  it("aman diulang tanpa menggandakan audit atau mencabut sesi login baru", async () => {
    const actor = await user(db);
    await db.transaction((tx) => bootstrapSuperAdmin(tx, actor.phone));
    const fresh = await session(actor.id);
    await db.transaction((tx) => bootstrapSuperAdmin(tx, actor.phone));
    expect(await db.select().from(adminAuditLogs)).toHaveLength(1);
    const [saved] = await db.select().from(sessions).where(eq(sessions.id, fresh.id));
    expect(saved.revokedAt).toBeNull();
  });

  it.each(["missing", "unlinked", "suspended"])("menolak calon admin %s", async (condition) => {
    const actor =
      condition === "missing"
        ? null
        : await user(db, {
            ...(condition === "unlinked" ? { telegramUserId: null } : {}),
            ...(condition === "suspended" ? { accountStatus: "ditangguhkan" as const } : {}),
          });
    await expect(
      db.transaction((tx) => bootstrapSuperAdmin(tx, actor?.phone || "+6280000000000")),
    ).rejects.toThrow("Calon super admin harus login lewat Telegram terlebih dahulu");
    expect(await db.select().from(adminAuditLogs)).toHaveLength(0);
    if (actor) {
      const [saved] = await db.select().from(users).where(eq(users.id, actor.id));
      expect(saved.role).toBe("user");
    }
  });

  it("me-rollback role, sesi, dan audit bila transaksi seed gagal", async () => {
    const actor = await user(db);
    const current = await session(actor.id);
    await expect(
      db.transaction(async (tx) => {
        await bootstrapSuperAdmin(tx, actor.phone);
        throw new Error("Seed dibatalkan");
      }),
    ).rejects.toThrow("Seed dibatalkan");
    const [saved] = await db.select().from(users).where(eq(users.id, actor.id));
    const [savedSession] = await db.select().from(sessions).where(eq(sessions.id, current.id));
    expect(saved.role).toBe("user");
    expect(savedSession.revokedAt).toBeNull();
    expect(await db.select().from(adminAuditLogs)).toHaveLength(0);
  });
});
