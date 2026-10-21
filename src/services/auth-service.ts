import { and, eq, gt, gte, isNull, or, sql } from "drizzle-orm";
import type { Database, Executor } from "@/src/db";
import { loginRequests, sessions, users, type Role } from "@/src/db/schema";
import { hash, matchCode, randomToken } from "@/src/lib/crypto";
import { assert } from "@/src/lib/errors";
import { getSettings } from "./settings-service";

export const SESSION_COOKIE = "sm_session",
  BROWSER_COOKIE = "sm_browser";
export const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
};
export function canAccess(role: Role, allowed: Role[]) {
  return allowed.includes(role);
}
export async function startLogin(db: Database, browserNonce: string, ip: string) {
  return db.transaction(async (tx) => {
    const rules = await getSettings(tx),
      nonceHash = hash(browserNonce),
      ipHash = hash(ip);
    // Serialize both counters across instances. Stable browser nonce survives failed logins.
    for (const key of [`browser:${nonceHash}`, `ip:${ipHash}`].sort())
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${key}))`);
    const [{ count }] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(loginRequests)
      .where(
        and(
          or(eq(loginRequests.browserNonceHash, nonceHash), eq(loginRequests.ipHash, ipHash)),
          gte(loginRequests.createdAt, new Date(Date.now() - rules.login_window_minutes * 60000)),
        ),
      );
    assert(
      count < rules.login_max_requests,
      "RATE_LIMITED",
      `Terlalu banyak permintaan. Coba lagi setelah ${rules.login_window_minutes} menit.`,
      429,
    );
    const token = randomToken(),
      code = matchCode(),
      expiresAt = new Date(Date.now() + rules.login_ttl_minutes * 60000);
    const [request] = await tx
      .insert(loginRequests)
      .values({
        tokenHash: hash(token),
        browserNonceHash: nonceHash,
        ipHash,
        matchCode: code,
        expiresAt,
      })
      .returning();
    return { id: request.id, token, matchCode: code, expiresAt };
  });
}
export async function consumeLogin(
  db: Database,
  id: string,
  browserNonce: string,
  userAgent: string,
  ip: string,
) {
  return db.transaction(async (tx) => {
    const [request] = await tx
      .select()
      .from(loginRequests)
      .where(and(eq(loginRequests.id, id), eq(loginRequests.browserNonceHash, hash(browserNonce))))
      .for("update");
    assert(request, "NOT_FOUND", "Login ini bukan milik browser ini. Mulai permintaan baru.", 404);
    if (request.status === "dipakai") return { status: "dipakai" as const };
    if (request.expiresAt <= new Date() || request.status === "kedaluwarsa") {
      await tx.update(loginRequests).set({ status: "kedaluwarsa" }).where(eq(loginRequests.id, id));
      return { status: "kedaluwarsa" as const };
    }
    if (request.status !== "disetujui" || !request.userId) return { status: "menunggu" as const };
    const [user] = await tx.select().from(users).where(eq(users.id, request.userId)).for("update");
    assert(
      user && user.accountStatus !== "dihapus",
      "ACCOUNT_UNAVAILABLE",
      "Akun ini sudah tidak tersedia.",
      403,
    );
    const rules = await getSettings(tx),
      token = randomToken();
    const lifetime =
      user.role === "user"
        ? rules.user_session_days * 86400000
        : rules.admin_session_hours * 3600000;
    const expiresAt = new Date(Date.now() + lifetime);
    await tx
      .insert(sessions)
      .values({
        userId: user.id,
        tokenHash: hash(token),
        userAgent: userAgent.slice(0, 512),
        ip,
        expiresAt,
      });
    await tx.update(loginRequests).set({ status: "dipakai" }).where(eq(loginRequests.id, id));
    return {
      status: "authenticated" as const,
      token,
      expiresAt,
      onboarding: !user.termsAcceptedAt || !user.name,
    };
  });
}
export async function findSession(db: Executor, token: string | undefined) {
  if (!token || !/^[\w-]{43}$/.test(token)) return null;
  const [row] = await db
    .select({ user: users, session: sessions })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(
      and(
        eq(sessions.tokenHash, hash(token)),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, new Date()),
      ),
    );
  if (!row || row.user.accountStatus === "dihapus") return null;
  if (row.user.role !== "user") {
    const rules = await getSettings(db);
    if (row.session.createdAt.getTime() + rules.admin_session_hours * 3600000 <= Date.now())
      return null;
  }
  if (Date.now() - row.session.lastSeenAt.getTime() > 300000)
    await db
      .update(sessions)
      .set({ lastSeenAt: new Date() })
      .where(eq(sessions.id, row.session.id));
  return row;
}
export async function revokeSession(db: Executor, userId: string, id: string) {
  const [row] = await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.id, id), eq(sessions.userId, userId)))
    .returning({ id: sessions.id });
  assert(row, "NOT_FOUND", "Sesi tidak ditemukan.", 404);
}
