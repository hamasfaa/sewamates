import "server-only";
import { z } from "zod";
import type { Update } from "grammy/types";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { getDb } from "@/src/db";
import { actionConfirmations, notifications, sessions, users } from "@/src/db/schema";
import { listCampuses } from "@/src/services/campus-service";
import { requireActor } from "./auth";
import { assert, AppError } from "./errors";
import { integrationsReady, required } from "./env";
import { randomToken, safeEqual } from "./crypto";
import { body, checkOrigin, clientIp, endpoint, json } from "./http";
import { uploadInput } from "./validation";
import { signUpload } from "./storage";
import {
  startLogin,
  consumeLogin,
  BROWSER_COOKIE,
  SESSION_COOKIE,
  cookieOptions,
  revokeSession,
} from "@/src/services/auth-service";
import {
  myProfile,
  updateProfile,
  submitVerification,
  requestPayoutChange,
  activeSessions,
} from "@/src/services/profile-service";
import { getSettings, changeSettings } from "@/src/services/settings-service";
import {
  verificationQueue,
  verificationDetail,
  decideVerification,
  auditLogs,
  adminSummary,
} from "@/src/services/admin-service";
import { processTelegramUpdate } from "@/src/services/telegram-service";
import { expireLoginRequests } from "@/src/jobs/expire-login-requests";
import { cookies } from "next/headers";
const uuid = (value: string) => z.uuid().parse(value);

export const dispatch = endpoint(async (request) => {
  const url = new URL(request.url),
    path = url.pathname.replace(/^\/api\//, "").replace(/\/$/, ""),
    method = request.method;
  const parts = path.split("/");
  const isWebhook = path === "telegram/webhook",
    isJob = path.startsWith("internal/jobs/");
  if (!["GET", "HEAD"].includes(method) && !isWebhook && !isJob) {
    checkOrigin(request);
    const key = request.headers.get("Idempotency-Key");
    if (key)
      z.string()
        .min(8)
        .max(128)
        .regex(/^[\w-]+$/)
        .parse(key);
  }
  if (path === "health" && method === "GET") return json({ status: "ok", version: "0.1.0" });
  if (isWebhook && method === "POST") {
    assert(
      safeEqual(
        request.headers.get("x-telegram-bot-api-secret-token") || "",
        required("TELEGRAM_WEBHOOK_SECRET"),
      ),
      "FORBIDDEN",
      "Webhook tidak terotorisasi.",
      403,
    );
    const raw = await body(request);
    const update = z.object({ update_id: z.number().int().nonnegative() }).passthrough().parse(raw);
    await processTelegramUpdate(getDb(), update as Update);
    return json({ ok: true });
  }
  if (isJob && method === "POST") {
    assert(
      safeEqual(
        request.headers.get("authorization") || "",
        `Bearer ${required("INTERNAL_JOB_SECRET")}`,
      ),
      "FORBIDDEN",
      "Job tidak terotorisasi.",
      403,
    );
    if (parts[2] !== "expire-login-requests")
      throw new AppError("NOT_FOUND", "Job tidak ditemukan.", 404);
    return json(await expireLoginRequests(getDb()));
  }
  if (path === "auth/telegram/start" && method === "POST") {
    assert(
      integrationsReady(),
      "SETUP_REQUIRED",
      "Layanan login belum diaktifkan. Hubungi pengelola SewaMates.",
      503,
    );
    const jar = await cookies(),
      existing = jar.get(BROWSER_COOKIE)?.value;
    const nonce = existing && /^[\w-]{43}$/.test(existing) ? existing : randomToken();
    const login = await startLogin(getDb(), nonce, clientIp(request));
    const username = required("TELEGRAM_BOT_USERNAME");
    assert(
      /^[a-zA-Z0-9_]{5,32}$/.test(username),
      "SETUP_REQUIRED",
      "Nama bot Telegram belum dikonfigurasi dengan benar.",
      503,
    );
    const response = json(
      {
        id: login.id,
        matchCode: login.matchCode,
        expiresAt: login.expiresAt,
        deepLink: `https://t.me/${username}?start=${login.token}`,
      },
      201,
    );
    response.cookies.set(BROWSER_COOKIE, nonce, { ...cookieOptions, maxAge: 30 * 86400 });
    return response;
  }
  if (/^auth\/telegram\/status\/[^/]+$/.test(path) && method === "GET") {
    const jar = await cookies(),
      nonce = jar.get(BROWSER_COOKIE)?.value;
    assert(
      nonce && /^[\w-]{43}$/.test(nonce),
      "NOT_FOUND",
      "Mulai login dari browser ini terlebih dahulu.",
      404,
    );
    const result = await consumeLogin(
      getDb(),
      uuid(parts[3]),
      nonce,
      request.headers.get("user-agent") || "",
      clientIp(request),
    );
    const response = json({
      status: result.status,
      ...(result.status === "authenticated"
        ? { redirect: result.onboarding ? "/daftar" : "/profil" }
        : {}),
    });
    if (result.status === "authenticated")
      response.cookies.set(SESSION_COOKIE, result.token, {
        ...cookieOptions,
        expires: result.expiresAt,
      });
    return response;
  }
  if (path === "campuses" && method === "GET")
    return json(await listCampuses(getDb(), url.searchParams.get("q") || ""));
  if (/^users\/[^/]+$/.test(path) && method === "GET") {
    const [user] = await getDb()
      .select({
        id: users.id,
        name: users.name,
        avatarUrl: users.avatarUrl,
        verificationStatus: users.verificationStatus,
        ratingAvg: users.ratingAvg,
        ratingCount: users.ratingCount,
        completedCount: users.completedCount,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(and(eq(users.id, uuid(parts[1])), eq(users.accountStatus, "aktif")));
    assert(user, "NOT_FOUND", "Profil tidak ditemukan.", 404);
    return json(user);
  }
  // All remaining routes require a live server-side session, including every admin endpoint.
  const actor = await requireActor(
    parts[0] === "admin"
      ? parts[1] === "settings"
        ? ["super_admin"]
        : ["admin", "super_admin"]
      : undefined,
  );
  const db = getDb();
  const idempotencyKey = request.headers.get("Idempotency-Key") || undefined;
  if (path === "auth/logout" && method === "POST") {
    await db
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(eq(sessions.id, actor.session.id));
    const response = json({ ok: true });
    response.cookies.set(SESSION_COOKIE, "", { ...cookieOptions, maxAge: 0 });
    return response;
  }
  if (path === "me" && method === "GET") return json(await myProfile(db, actor.user));
  if (path === "me" && method === "PATCH")
    return json(await updateProfile(db, actor.user, await body(request), idempotencyKey));
  if (path === "me/verification" && method === "POST")
    return json(await submitVerification(db, actor.user, await body(request), idempotencyKey), 201);
  if (path === "me/payout-account" && method === "PUT")
    return json(
      await requestPayoutChange(db, actor.user, await body(request), idempotencyKey),
      202,
    );
  if (path === "me/sessions" && method === "GET")
    return json(await activeSessions(db, actor.user.id, actor.session.id));
  if (/^me\/sessions\/[^/]+$/.test(path) && method === "DELETE") {
    const id = uuid(parts[2]);
    await revokeSession(db, actor.user.id, id);
    const response = json({ ok: true });
    if (id === actor.session.id)
      response.cookies.set(SESSION_COOKIE, "", { ...cookieOptions, maxAge: 0 });
    return response;
  }
  if (/^me\/confirmations\/[^/]+$/.test(path) && method === "GET") {
    const [confirmation] = await db
      .select({
        id: actionConfirmations.id,
        status: actionConfirmations.status,
        expiresAt: actionConfirmations.expiresAt,
      })
      .from(actionConfirmations)
      .where(
        and(
          eq(actionConfirmations.id, uuid(parts[2])),
          eq(actionConfirmations.userId, actor.user.id),
        ),
      );
    assert(confirmation, "NOT_FOUND", "Konfirmasi tidak ditemukan.", 404);
    return json({
      ...confirmation,
      status:
        confirmation.status === "menunggu" && confirmation.expiresAt <= new Date()
          ? "kedaluwarsa"
          : confirmation.status,
    });
  }
  if (path === "uploads/sign" && method === "POST") {
    assert(
      actor.user.accountStatus === "aktif",
      "ACCOUNT_RESTRICTED",
      "Akun sedang dibatasi.",
      403,
    );
    return json(await signUpload(db, actor.user.id, uploadInput.parse(await body(request))), 201);
  }
  if (path === "notifications" && method === "GET") {
    const rows = await db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, actor.user.id))
      .orderBy(desc(notifications.createdAt))
      .limit(50);
    const [{ unread }] = await db
      .select({ unread: sql<number>`count(*)::int` })
      .from(notifications)
      .where(and(eq(notifications.userId, actor.user.id), isNull(notifications.readAt)));
    return json({ notifications: rows, unread });
  }
  if (path === "notifications/read" && method === "POST") {
    const input = z
      .object({ ids: z.array(z.uuid()).min(1).max(50) })
      .strict()
      .parse(await body(request));
    await db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(notifications.userId, actor.user.id),
          inArray(notifications.id, input.ids),
          isNull(notifications.readAt),
        ),
      );
    return json({ ok: true });
  }
  if (path === "admin/summary" && method === "GET") return json(await adminSummary(db, actor.user));
  if (path === "admin/verifications" && method === "GET")
    return json(await verificationQueue(db, actor.user));
  if (/^admin\/verifications\/[^/]+$/.test(path) && method === "GET")
    return json(await verificationDetail(db, actor.user, uuid(parts[2])));
  if (/^admin\/verifications\/[^/]+\/decision$/.test(path) && method === "POST")
    return json(
      await decideVerification(db, actor.user, uuid(parts[2]), await body(request), idempotencyKey),
    );
  if (path === "admin/audit-logs" && method === "GET")
    return json(
      await auditLogs(db, actor.user, {
        adminId: url.searchParams.has("admin") ? uuid(url.searchParams.get("admin")!) : undefined,
        action: url.searchParams.has("action")
          ? z.string().max(80).parse(url.searchParams.get("action"))
          : undefined,
      }),
    );
  if (path === "admin/settings" && method === "GET") return json(await getSettings(db));
  if (path === "admin/settings" && method === "PUT")
    return json(
      await changeSettings(
        db,
        actor.user,
        z.record(z.string(), z.unknown()).parse(await body(request)),
        idempotencyKey,
      ),
    );
  throw new AppError("NOT_FOUND", "Endpoint tidak ditemukan.", 404);
});
