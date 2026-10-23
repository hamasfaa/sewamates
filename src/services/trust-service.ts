import { and, asc, desc, eq, gt, ilike, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database, Executor } from "@/src/db";
import {
  adminAuditLogs,
  conversations,
  items,
  messages,
  rentals,
  reports,
  reviews,
  sessions,
  strikes,
  userBlocks,
  users,
  type User,
} from "@/src/db/schema";
import { mutation } from "@/src/db/mutation";
import { assert } from "@/src/lib/errors";
import { reasonInput, reportActionInput, reportInput } from "@/src/lib/trust-validation";
import { requireAdmin, requireSuperAdmin } from "./admin-service";
import { requireActive } from "./profile-service";
import { getSettings } from "./settings-service";
import { lockRental, transitionRental } from "./rental-service";
import { notify, notifyAdmins } from "./notification-service";
import { refreshRatings } from "./review-service";
import { blockUser } from "./chat-service";
import { lockAccountActivity } from "./account-activity";

export async function suspendAccount(tx: Executor, id: string, reason: string, adminId?: string) {
  await lockAccountActivity(tx, [id]);
  const [person] = await tx.select().from(users).where(eq(users.id, id));
  assert(
    person && person.accountStatus !== "dihapus",
    "NOT_FOUND",
    "Pengguna tidak tersedia.",
    404,
  );
  if (person.accountStatus === "ditangguhkan") return { id, status: person.accountStatus };
  // Approved and paid obligations remain available, including payment and handover actions.
  const pending = await tx
    .select({ id: rentals.id })
    .from(rentals)
    .where(
      and(eq(rentals.status, "DIAJUKAN"), or(eq(rentals.ownerId, id), eq(rentals.renterId, id))),
    )
    .orderBy(asc(rentals.itemId), asc(rentals.id));
  for (const ref of pending) {
    const rental = await lockRental(tx, ref.id);
    if (rental.status !== "DIAJUKAN") continue;
    await transitionRental(
      tx,
      rental,
      rental.ownerId === id ? "DITOLAK" : "DIBATALKAN",
      { type: adminId ? "admin" : "system", id: adminId },
      { action: "account_suspended", userId: id, reason },
    );
    await notify(
      tx,
      rental.ownerId === id ? rental.renterId : rental.ownerId,
      "account_counterparty_suspended",
      "Pengajuan tidak dapat dilanjutkan",
      `${rental.publicCode}: akun pihak lain ditangguhkan.`,
      `/transaksi/${rental.id}`,
    );
  }
  await tx
    .update(users)
    .set({ accountStatus: "ditangguhkan", suspendedAt: new Date(), suspensionReason: reason })
    .where(eq(users.id, id));
  await notify(
    tx,
    id,
    "account_suspended",
    "Akun ditangguhkan",
    `${reason} Transaksi yang sudah disetujui tetap perlu diselesaikan.`,
    "/profil",
  );
  await notifyAdmins(
    tx,
    "Tinjau akun ditangguhkan",
    `${person.name}: ${reason}`,
    "/admin/pengguna",
  );
  return { id, status: "ditangguhkan" };
}
export async function manageUser(
  db: Database,
  actor: User,
  id: string,
  action: "suspend" | "reactivate" | "strike",
  raw: unknown,
  key?: string,
) {
  requireAdmin(actor);
  const input = reasonInput.parse(raw);
  assert(id !== actor.id, "SELF_REVIEW_FORBIDDEN", "Minta admin lain menangani akunmu.", 403);
  return mutation(db, actor.id, `user:${id}:${action}`, key, input, async (tx) => {
    await lockAccountActivity(tx, [id]);
    const [person] = await tx.select().from(users).where(eq(users.id, id));
    assert(
      person && person.accountStatus !== "dihapus",
      "NOT_FOUND",
      "Pengguna tidak tersedia.",
      404,
    );
    assert(
      person.role !== "super_admin" || actor.role === "super_admin",
      "FORBIDDEN",
      "Akun super admin ditangani super admin lain.",
      403,
    );
    if (action === "suspend") await suspendAccount(tx, id, input.reason, actor.id);
    else if (action === "reactivate") {
      assert(
        person.accountStatus === "ditangguhkan",
        "ACCOUNT_ACTIVE",
        "Akun tidak sedang ditangguhkan.",
        409,
      );
      await tx
        .update(users)
        .set({
          accountStatus: "aktif",
          suspendedAt: null,
          suspensionReason: null,
          strikeReviewedAt: new Date(),
        })
        .where(eq(users.id, id));
      await notify(
        tx,
        id,
        "account_reactivated",
        "Akun diaktifkan kembali",
        input.reason,
        "/profil",
      );
    } else {
      const rules = await getSettings(tx);
      await tx.insert(strikes).values({
        userId: id,
        reason: "laporan",
        givenBy: actor.id,
        expiresAt: new Date(Date.now() + rules.strike_window_days * 86400000),
      });
      await notify(tx, id, "strike_given", "Kamu mendapat strike", input.reason, "/profil");
    }
    await tx.insert(adminAuditLogs).values({
      adminId: actor.id,
      action: `user_${action}`,
      targetType: "users",
      targetId: id,
      meta: input,
    });
    return { id, action };
  });
}
export async function autoSuspend(db: Database) {
  const rules = await getSettings(db);
  const candidates = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.accountStatus, "aktif"),
        sql`(SELECT count(*) FROM strikes s WHERE s.user_id=${users.id} AND s.expires_at>now() AND (${users.strikeReviewedAt} IS NULL OR s.created_at>${users.strikeReviewedAt})) >= ${rules.strike_limit}`,
      ),
    )
    .orderBy(asc(users.id))
    .limit(100);
  let suspended = 0;
  for (const { id } of candidates)
    await db.transaction(async (tx) => {
      await lockAccountActivity(tx, [id]);
      const [person] = await tx.select().from(users).where(eq(users.id, id));
      if (person.accountStatus !== "aktif") return;
      const [{ count }] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(strikes)
        .where(
          and(
            eq(strikes.userId, id),
            gt(strikes.expiresAt, new Date()),
            person.strikeReviewedAt ? gt(strikes.createdAt, person.strikeReviewedAt) : undefined,
          ),
        );
      if (count >= rules.strike_limit) {
        await suspendAccount(tx, id, `${count} strike aktif. Menunggu peninjauan admin.`);
        suspended++;
      }
    });
  return { suspended };
}
export async function adminUsers(db: Executor, actor: User, q: string) {
  requireAdmin(actor);
  const term = z.string().trim().max(100).parse(q),
    search = `%${term.replace(/[\\%_]/g, "\\$&")}%`;
  return db
    .select({
      id: users.id,
      name: users.name,
      phone: users.phone,
      role: users.role,
      accountStatus: users.accountStatus,
      suspensionReason: users.suspensionReason,
      verificationStatus: users.verificationStatus,
      activeStrikes: sql<number>`(SELECT count(*)::int FROM strikes s WHERE s.user_id=${users.id} AND s.expires_at>now())`,
    })
    .from(users)
    .where(
      term
        ? or(
            ilike(users.name, search),
            ilike(users.phone, search),
            sql`EXISTS(SELECT 1 FROM rentals r WHERE (r.owner_id=${users.id} OR r.renter_id=${users.id}) AND r.public_code ILIKE ${search})`,
          )
        : undefined,
    )
    .orderBy(desc(users.suspendedAt), desc(users.createdAt), asc(users.id))
    .limit(100);
}
export async function adminUserDetail(db: Database, actor: User, id: string) {
  requireAdmin(actor);
  const [person] = await db
    .select({
      id: users.id,
      name: users.name,
      role: users.role,
      accountStatus: users.accountStatus,
    })
    .from(users)
    .where(eq(users.id, id));
  assert(person, "NOT_FOUND", "Pengguna tidak ditemukan.", 404);
  await db.insert(adminAuditLogs).values({
    adminId: actor.id,
    action: "user_history_viewed",
    targetType: "users",
    targetId: id,
  });
  return {
    user: person,
    strikes: await db
      .select()
      .from(strikes)
      .where(eq(strikes.userId, id))
      .orderBy(desc(strikes.createdAt))
      .limit(100),
    rentals: await db
      .select({
        id: rentals.id,
        publicCode: rentals.publicCode,
        status: rentals.status,
        amountReceived: rentals.amountReceived,
      })
      .from(rentals)
      .where(or(eq(rentals.ownerId, id), eq(rentals.renterId, id)))
      .orderBy(desc(rentals.createdAt))
      .limit(100),
  };
}
export async function changeRole(
  db: Database,
  actor: User,
  id: string,
  raw: unknown,
  key?: string,
) {
  requireSuperAdmin(actor);
  const input = z
    .object({
      role: z.enum(["user", "admin", "super_admin"]),
      reason: z.string().trim().min(10).max(500),
    })
    .strict()
    .parse(raw);
  assert(
    id !== actor.id,
    "SELF_ROLE_FORBIDDEN",
    "Perubahan role sendiri harus dilakukan super admin lain.",
    403,
  );
  return mutation(db, actor.id, `user:${id}:role`, key, input, async (tx) => {
    const [person] = await tx.select().from(users).where(eq(users.id, id)).for("update");
    assert(person?.accountStatus === "aktif", "NOT_FOUND", "Pilih pengguna aktif.", 404);
    await tx.update(users).set({ role: input.role }).where(eq(users.id, id));
    await tx.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.userId, id));
    await tx.insert(adminAuditLogs).values({
      adminId: actor.id,
      action: "user_role_changed",
      targetType: "users",
      targetId: id,
      meta: { ...input, previousRole: person.role },
    });
    return { id, role: input.role };
  });
}
async function reportTarget(db: Executor, type: string, id: string, viewer?: string) {
  if (type === "user") {
    const [r] = await db
      .select({ ownerId: users.id, text: users.name })
      .from(users)
      .where(and(eq(users.id, id), ne(users.accountStatus, "dihapus")));
    return r;
  }
  if (type === "item") {
    const [r] = await db
      .select({ ownerId: items.ownerId, text: items.title })
      .from(items)
      .where(and(eq(items.id, id), viewer ? eq(items.status, "aktif") : undefined));
    return r;
  }
  if (type === "review") {
    const [r] = await db
      .select({ ownerId: reviews.reviewerId, text: reviews.comment, rentalId: reviews.rentalId })
      .from(reviews)
      .where(
        and(
          eq(reviews.id, id),
          viewer
            ? sql`${reviews.visibleAt} IS NOT NULL AND ${reviews.hiddenAt} IS NULL`
            : undefined,
        ),
      );
    return r;
  }
  const [r] = await db
    .select({
      ownerId: messages.senderId,
      text: messages.body,
      conversationId: messages.conversationId,
    })
    .from(messages)
    .innerJoin(conversations, eq(conversations.id, messages.conversationId))
    .where(
      and(
        eq(messages.id, id),
        ne(messages.type, "system"),
        viewer
          ? or(eq(conversations.ownerId, viewer), eq(conversations.renterId, viewer))
          : undefined,
      ),
    );
  return r;
}
export async function createReport(db: Database, actor: User, raw: unknown, key?: string) {
  requireActive(actor);
  const input = reportInput.parse(raw);
  return mutation(db, actor.id, "report", key, input, async (tx) => {
    const target = await reportTarget(tx, input.targetType, input.targetId, actor.id);
    assert(target?.ownerId, "NOT_FOUND", "Konten tidak tersedia untuk dilaporkan.", 404);
    assert(
      target.ownerId !== actor.id,
      "SELF_REPORT",
      "Kamu tidak dapat melaporkan konten sendiri.",
      422,
    );
    const [pending] = await tx
      .select()
      .from(reports)
      .where(
        and(
          eq(reports.reporterId, actor.id),
          eq(reports.targetType, input.targetType),
          eq(reports.targetId, input.targetId),
          eq(reports.status, "menunggu"),
        ),
      );
    assert(!pending, "REPORT_PENDING", "Laporanmu untuk konten ini masih ditinjau.", 409);
    const [saved] = await tx
      .insert(reports)
      .values({ reporterId: actor.id, ...input })
      .returning({ id: reports.id });
    await notifyAdmins(
      tx,
      "Laporan baru",
      `Laporan ${input.targetType}: ${input.reason}`,
      "/admin/laporan",
    );
    return saved;
  });
}
export async function reportQueue(db: Executor, actor: User) {
  requireAdmin(actor);
  const rows = await db
    .select()
    .from(reports)
    .where(eq(reports.status, "menunggu"))
    .orderBy(asc(reports.createdAt))
    .limit(100);
  return Promise.all(
    rows.map(async (r) => ({ ...r, target: await reportTarget(db, r.targetType, r.targetId) })),
  );
}
export async function handleReport(
  db: Database,
  actor: User,
  id: string,
  raw: unknown,
  key?: string,
) {
  requireAdmin(actor);
  const input = reportActionInput.parse(raw);
  return mutation(db, actor.id, `report:${id}:handle`, key, input, async (tx) => {
    const [r] = await tx.select().from(reports).where(eq(reports.id, id)).for("update");
    assert(
      r?.status === "menunggu",
      "REPORT_CLOSED",
      "Laporan sudah ditangani atau tidak tersedia.",
      409,
    );
    const target = await reportTarget(tx, r.targetType, r.targetId);
    assert(
      r.reporterId !== actor.id && target?.ownerId !== actor.id,
      "SELF_REVIEW_FORBIDDEN",
      "Minta admin lain menangani laporan yang melibatkanmu.",
      403,
    );
    if (target && "rentalId" in target && typeof target.rentalId === "string") {
      const [rental] = await tx.select().from(rentals).where(eq(rentals.id, target.rentalId));
      assert(
        ![rental.ownerId, rental.renterId].includes(actor.id),
        "SELF_REVIEW_FORBIDDEN",
        "Minta admin lain menangani ulasan transaksimu.",
        403,
      );
    }
    assert(
      input.action === "abaikan" || target?.ownerId,
      "TARGET_UNAVAILABLE",
      "Target sudah tidak tersedia; laporan dapat diabaikan dengan catatan.",
      409,
    );
    if (input.action === "sembunyikan") {
      assert(
        r.targetType !== "user",
        "INVALID_ACTION",
        "Gunakan tangguhkan untuk akun pengguna.",
        422,
      );
      if (r.targetType === "item")
        await tx
          .update(items)
          .set({
            status: "ditolak",
            rejectReason: input.reason,
            reviewedBy: actor.id,
            reviewedAt: new Date(),
            version: sql`${items.version}+1`,
          })
          .where(eq(items.id, r.targetId));
      else if (r.targetType === "message")
        await tx.update(messages).set({ hiddenAt: new Date() }).where(eq(messages.id, r.targetId));
      else {
        const [review] = await tx.select().from(reviews).where(eq(reviews.id, r.targetId));
        const [reference] = await tx.select().from(rentals).where(eq(rentals.id, review.rentalId));
        await lockAccountActivity(tx, [reference.ownerId, reference.renterId]);
        await lockRental(tx, review.rentalId);
        await tx.update(reviews).set({ hiddenAt: new Date() }).where(eq(reviews.id, r.targetId));
        await refreshRatings(tx, review.rentalId);
      }
    }
    if (input.action === "strike" || input.action === "tangguhkan") {
      await lockAccountActivity(tx, [target!.ownerId!]);
      const [person] = await tx.select().from(users).where(eq(users.id, target!.ownerId!));
      assert(
        person.role !== "super_admin" || actor.role === "super_admin",
        "FORBIDDEN",
        "Akun super admin ditangani super admin lain.",
        403,
      );
      if (input.action === "tangguhkan")
        await suspendAccount(tx, person.id, input.reason, actor.id);
      else {
        const rules = await getSettings(tx);
        await tx.insert(strikes).values({
          userId: person.id,
          reason: "laporan",
          reportId: id,
          givenBy: actor.id,
          expiresAt: new Date(Date.now() + rules.strike_window_days * 86400000),
        });
        await notify(
          tx,
          person.id,
          "strike_given",
          "Laporan terbukti: strike diberikan",
          input.reason,
          "/profil",
        );
      }
    }
    await tx
      .update(reports)
      .set({
        status: "ditangani",
        actionTaken: input.action,
        handledBy: actor.id,
        handledAt: new Date(),
        decisionNote: input.reason,
      })
      .where(eq(reports.id, id));
    await tx.insert(adminAuditLogs).values({
      adminId: actor.id,
      action: "report_handled",
      targetType: "reports",
      targetId: id,
      meta: input,
    });
    await notify(
      tx,
      r.reporterId,
      "report_handled",
      "Laporanmu sudah ditangani",
      input.reason,
      "/notifikasi",
    );
    return { id, status: "ditangani" };
  });
}
export async function myBlocks(db: Executor, actor: User) {
  return db
    .select({ id: users.id, name: users.name })
    .from(userBlocks)
    .innerJoin(users, eq(users.id, userBlocks.blockedId))
    .where(eq(userBlocks.blockerId, actor.id));
}
export { blockUser };
