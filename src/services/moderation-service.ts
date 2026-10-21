import { and, asc, desc, eq, sql } from "drizzle-orm";
import type { Database, Executor } from "@/src/db";
import {
  adminAuditLogs,
  campuses,
  categories,
  itemPhotos,
  itemPickupPoints,
  items,
  notifications,
  pickupPoints,
  users,
  type User,
} from "@/src/db/schema";
import { mutation } from "@/src/db/mutation";
import { summarizeHours } from "@/src/domain/pickup-points";
import { depositAllowed, depositRange } from "@/src/domain/pricing";
import { assert } from "@/src/lib/errors";
import { publicItemUrl } from "@/src/lib/storage";
import { itemDecisionInput } from "@/src/lib/validation";
import { requireAdmin } from "./admin-service";
import { coverThumb } from "./item-service";
import { getSettings } from "./settings-service";

export async function moderationQueue(db: Executor, actor: User) {
  requireAdmin(actor);
  const rules = await getSettings(db);
  const rows = await db
    .select({
      id: items.id,
      title: items.title,
      submittedAt: items.submittedAt,
      ownerName: users.name,
      categoryName: categories.name,
      // A previous decision means this is an edit or a resubmission.
      reviewedBefore: sql<boolean>`${items.reviewedAt} IS NOT NULL`,
      overdue: sql<boolean>`${items.submittedAt} < ${new Date(Date.now() - rules.listing_sla_hours * 3600000)}`,
      thumbPath: coverThumb,
    })
    .from(items)
    .innerJoin(users, eq(users.id, items.ownerId))
    .innerJoin(categories, eq(categories.id, items.categoryId))
    .where(eq(items.status, "menunggu_review"))
    .orderBy(asc(items.submittedAt))
    .limit(100);
  return rows.map(({ thumbPath, ...row }) => ({
    ...row,
    thumbUrl: publicItemUrl(thumbPath),
    slaHours: rules.listing_sla_hours,
  }));
}
export async function moderationDetail(db: Executor, actor: User, id: string) {
  requireAdmin(actor);
  const [row] = await db
    .select({
      item: items,
      category: { name: categories.name, active: categories.active },
      campusName: campuses.name,
      owner: {
        id: users.id,
        name: users.name,
        verificationStatus: users.verificationStatus,
        accountStatus: users.accountStatus,
        createdAt: users.createdAt,
      },
    })
    .from(items)
    .innerJoin(users, eq(users.id, items.ownerId))
    .innerJoin(categories, eq(categories.id, items.categoryId))
    .innerJoin(campuses, eq(campuses.id, items.campusId))
    .where(eq(items.id, id));
  assert(row, "NOT_FOUND", "Listing tidak ditemukan.", 404);
  const photos = await db
    .select()
    .from(itemPhotos)
    .where(eq(itemPhotos.itemId, id))
    .orderBy(asc(itemPhotos.sort));
  const points = await db
    .select({ name: pickupPoints.name, active: pickupPoints.active, hours: pickupPoints.hours })
    .from(itemPickupPoints)
    .innerJoin(pickupPoints, eq(pickupPoints.id, itemPickupPoints.pickupPointId))
    .where(eq(itemPickupPoints.itemId, id))
    .orderBy(asc(pickupPoints.name));
  const history = await db
    .select({
      action: adminAuditLogs.action,
      adminName: users.name,
      meta: adminAuditLogs.meta,
      createdAt: adminAuditLogs.createdAt,
    })
    .from(adminAuditLogs)
    .innerJoin(users, eq(users.id, adminAuditLogs.adminId))
    .where(and(eq(adminAuditLogs.targetType, "items"), eq(adminAuditLogs.targetId, id)))
    .orderBy(desc(adminAuditLogs.createdAt))
    .limit(20);
  const { item } = row,
    rules = await getSettings(db);
  return {
    id: item.id,
    version: item.version,
    status: item.status,
    title: item.title,
    description: item.description,
    itemValue: item.itemValue,
    pricePerDay: item.pricePerDay,
    deposit: item.deposit,
    minDays: item.minDays,
    maxDays: item.maxDays,
    submittedAt: item.submittedAt,
    rejectReason: item.rejectReason,
    category: row.category,
    campusName: row.campusName,
    owner: { ...row.owner, isSelf: row.owner.id === actor.id },
    depositRange: depositRange(item.itemValue, rules),
    depositValid: depositAllowed(item.deposit, item.itemValue, rules),
    photos: photos.map((photo) => ({
      url: publicItemUrl(photo.path),
      thumbUrl: publicItemUrl(photo.thumbPath),
    })),
    pickupPoints: points.map(({ hours, ...point }) => ({
      ...point,
      hoursSummary: summarizeHours(hours),
    })),
    history: history.map((entry) => ({
      action: entry.action,
      adminName: entry.adminName,
      reason: typeof entry.meta.reason === "string" ? entry.meta.reason : null,
      createdAt: entry.createdAt,
    })),
  };
}
export async function decideItem(
  db: Database,
  actor: User,
  id: string,
  raw: unknown,
  key?: string,
) {
  requireAdmin(actor);
  const input = itemDecisionInput.parse(raw);
  return mutation(db, actor.id, `item-review:${id}`, key, input, async (tx) => {
    const [item] = await tx.select().from(items).where(eq(items.id, id)).for("update");
    assert(item, "NOT_FOUND", "Listing tidak ditemukan.", 404);
    assert(
      item.ownerId !== actor.id,
      "SELF_REVIEW_FORBIDDEN",
      "Minta admin lain meninjau listing milikmu.",
      403,
    );
    assert(
      item.status === "menunggu_review",
      "ALREADY_REVIEWED",
      "Listing ini sudah diproses admin lain atau ditarik pemiliknya.",
      409,
    );
    assert(
      item.version === input.version,
      "ITEM_CHANGED",
      "Pemilik baru saja mengubah listing ini. Muat ulang sebelum memutuskan.",
      409,
    );
    const approved = input.decision === "disetujui",
      now = new Date();
    await tx
      .update(items)
      .set({
        status: approved ? "aktif" : "ditolak",
        rejectReason: approved ? null : input.reason,
        reviewedBy: actor.id,
        reviewedAt: now,
        // Re-approval after an edit keeps the original publish time for "Baru ditambahkan".
        ...(approved && !item.publishedAt ? { publishedAt: now } : {}),
      })
      .where(eq(items.id, id));
    await tx.insert(adminAuditLogs).values({
      adminId: actor.id,
      action: approved ? "item_disetujui" : "item_ditolak",
      targetType: "items",
      targetId: id,
      meta: { reason: input.reason || null, version: item.version, title: item.title },
    });
    await tx.insert(notifications).values({
      userId: item.ownerId,
      type: "listing_decided",
      title: approved ? "Listing kamu sudah tayang!" : "Listing perlu diperbaiki",
      body: approved
        ? `“${item.title}” sekarang bisa ditemukan teman kampus.`
        : `“${item.title}”: ${input.reason}`,
      link: approved ? `/barang/${id}` : `/barang/${id}/ubah`,
    });
    return { id, status: approved ? ("aktif" as const) : ("ditolak" as const) };
  });
}
