import { and, asc, desc, eq, sql } from "drizzle-orm";
import type { Database, Executor } from "@/src/db";
import {
  adminAuditLogs,
  identityVerifications,
  items,
  notifications,
  payments,
  users,
  type User,
} from "@/src/db/schema";
import { assert } from "@/src/lib/errors";
import { decisionInput } from "@/src/lib/validation";
import { identityPreview } from "@/src/lib/storage";
import { getSettings } from "./settings-service";
import { mutation } from "@/src/db/mutation";
export function requireAdmin(actor: User) {
  assert(
    (actor.role === "admin" || actor.role === "super_admin") && actor.accountStatus === "aktif",
    "FORBIDDEN",
    "Akses khusus admin.",
    403,
  );
}
export function requireSuperAdmin(actor: User) {
  assert(
    actor.role === "super_admin" && actor.accountStatus === "aktif",
    "FORBIDDEN",
    "Hanya super admin yang dapat mengubah pengaturan ini.",
    403,
  );
}
export async function verificationQueue(db: Executor, actor: User) {
  requireAdmin(actor);
  const rules = await getSettings(db);
  return db
    .select({
      id: identityVerifications.id,
      cardType: identityVerifications.cardType,
      createdAt: identityVerifications.createdAt,
      userId: users.id,
      name: users.name,
      overdue: sql<boolean>`${identityVerifications.createdAt} < ${new Date(Date.now() - rules.identity_sla_hours * 3600000)}`,
      slaHours: sql<number>`${rules.identity_sla_hours}::int`,
    })
    .from(identityVerifications)
    .innerJoin(users, eq(users.id, identityVerifications.userId))
    .where(eq(identityVerifications.status, "menunggu"))
    .orderBy(asc(identityVerifications.createdAt))
    .limit(100);
}
export async function verificationDetail(db: Database, actor: User, id: string) {
  requireAdmin(actor);
  return db.transaction(async (tx) => {
    const [entry] = await tx
      .select({ verification: identityVerifications, name: users.name, campusId: users.campusId })
      .from(identityVerifications)
      .innerJoin(users, eq(users.id, identityVerifications.userId))
      .where(eq(identityVerifications.id, id));
    assert(entry, "NOT_FOUND", "Pengajuan tidak ditemukan.", 404);
    const cardUrl = await identityPreview(entry.verification.cardPhotoPath),
      selfieUrl = await identityPreview(entry.verification.selfiePath);
    await tx.insert(adminAuditLogs).values({
      adminId: actor.id,
      action: "identity_viewed",
      targetType: "identity_verifications",
      targetId: id,
    });
    return {
      id,
      name: entry.name,
      cardType: entry.verification.cardType,
      status: entry.verification.status,
      cardUrl,
      selfieUrl,
      expiresIn: 300,
    };
  });
}
export async function decideVerification(
  db: Database,
  actor: User,
  id: string,
  raw: unknown,
  key?: string,
) {
  requireAdmin(actor);
  const input = decisionInput.parse(raw);
  return mutation(db, actor.id, `review:${id}`, key, input, async (tx) => {
    // Lock the user before the verification, matching profile submission lock order.
    const [entry] = await tx
      .select()
      .from(identityVerifications)
      .where(eq(identityVerifications.id, id));
    assert(entry, "NOT_FOUND", "Pengajuan tidak ditemukan.", 404);
    assert(
      entry.userId !== actor.id,
      "SELF_REVIEW_FORBIDDEN",
      "Minta admin lain memeriksa identitasmu.",
      403,
    );
    await tx.select().from(users).where(eq(users.id, entry.userId)).for("update");
    const [saved] = await tx
      .update(identityVerifications)
      .set({
        status: input.decision,
        rejectReason: input.decision === "ditolak" ? input.reason : null,
        reviewedBy: actor.id,
        reviewedAt: new Date(),
      })
      .where(and(eq(identityVerifications.id, id), eq(identityVerifications.status, "menunggu")))
      .returning();
    assert(saved, "ALREADY_REVIEWED", "Pengajuan ini sudah diproses oleh admin lain.", 409);
    await tx
      .update(users)
      .set({ verificationStatus: input.decision === "diterima" ? "terverifikasi" : "ditolak" })
      .where(eq(users.id, entry.userId));
    await tx.insert(adminAuditLogs).values({
      adminId: actor.id,
      action: `identity_${input.decision}`,
      targetType: "identity_verifications",
      targetId: id,
      meta: { reason: input.reason || null },
    });
    await tx.insert(notifications).values({
      userId: entry.userId,
      type: "verification_decided",
      title:
        input.decision === "diterima"
          ? "Kamu sudah terverifikasi!"
          : "Foto identitas perlu diperbaiki",
      body:
        input.decision === "diterima"
          ? "Lengkapi rekening pencairanmu untuk bersiap menyewa dan menyewakan."
          : input.reason!,
      link: "/profil/verifikasi",
    });
    return { id, status: saved.status };
  });
}
export async function adminSummary(db: Executor, actor: User) {
  requireAdmin(actor);
  const rules = await getSettings(db);
  const [result] = await db
    .select({
      pending: sql<number>`count(*)::int`,
      overdue: sql<number>`count(*) filter (where ${identityVerifications.createdAt} < ${new Date(Date.now() - rules.identity_sla_hours * 3600000)})::int`,
    })
    .from(identityVerifications)
    .where(eq(identityVerifications.status, "menunggu"));
  const [listings] = await db
    .select({
      pending: sql<number>`count(*)::int`,
      overdue: sql<number>`count(*) filter (where ${items.submittedAt} < ${new Date(Date.now() - rules.listing_sla_hours * 3600000)})::int`,
    })
    .from(items)
    .where(eq(items.status, "menunggu_review"));
  const [paymentCounts] = await db
    .select({
      pending: sql<number>`count(*)::int`,
      overdue: sql<number>`count(*) filter (where ${payments.targetAt} <= now())::int`,
    })
    .from(payments)
    .where(eq(payments.status, "menunggu"));
  return {
    ...result,
    listingsPending: listings.pending,
    listingsOverdue: listings.overdue,
    paymentsPending: paymentCounts.pending,
    paymentsOverdue: paymentCounts.overdue,
  };
}
export async function auditLogs(
  db: Executor,
  actor: User,
  filter: { adminId?: string; action?: string },
) {
  requireAdmin(actor);
  return db
    .select({
      id: adminAuditLogs.id,
      adminId: adminAuditLogs.adminId,
      adminName: users.name,
      action: adminAuditLogs.action,
      targetType: adminAuditLogs.targetType,
      targetId: adminAuditLogs.targetId,
      meta: adminAuditLogs.meta,
      createdAt: adminAuditLogs.createdAt,
    })
    .from(adminAuditLogs)
    .innerJoin(users, eq(users.id, adminAuditLogs.adminId))
    .where(
      and(
        filter.adminId ? eq(adminAuditLogs.adminId, filter.adminId) : undefined,
        filter.action ? eq(adminAuditLogs.action, filter.action) : undefined,
      ),
    )
    .orderBy(desc(adminAuditLogs.createdAt))
    .limit(100);
}
