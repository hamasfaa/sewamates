import { and, asc, eq, sql } from "drizzle-orm";
import type { Database, Executor } from "@/src/db";
import {
  adminAuditLogs,
  campuses,
  categories,
  itemPickupPoints,
  items,
  pickupPoints,
  type User,
} from "@/src/db/schema";
import { mutation } from "@/src/db/mutation";
import { summarizeHours } from "@/src/domain/pickup-points";
import { AppError, assert, isUniqueViolation } from "@/src/lib/errors";
import {
  categoryInput,
  categoryPatch,
  pickupPointInput,
  pickupPointPatch,
} from "@/src/lib/validation";
import { requireSuperAdmin } from "./admin-service";

export async function activeCategories(db: Executor) {
  return db
    .select({ id: categories.id, name: categories.name })
    .from(categories)
    .where(eq(categories.active, true))
    .orderBy(asc(categories.name));
}
const pointFields = {
  id: pickupPoints.id,
  name: pickupPoints.name,
  description: pickupPoints.description,
  hours: pickupPoints.hours,
};
export async function activePickupPoints(db: Executor, campusId: string) {
  const rows = await db
    .select(pointFields)
    .from(pickupPoints)
    .where(and(eq(pickupPoints.campusId, campusId), eq(pickupPoints.active, true)))
    .orderBy(asc(pickupPoints.name));
  return rows.map((row) => ({ ...row, hoursSummary: summarizeHours(row.hours) }));
}

async function audit(
  tx: Executor,
  actor: User,
  action: string,
  targetType: string,
  targetId: string,
  meta: Record<string, unknown>,
) {
  await tx.insert(adminAuditLogs).values({ adminId: actor.id, action, targetType, targetId, meta });
}
async function uniqueName<T>(work: () => Promise<T>, message: string) {
  try {
    return await work();
  } catch (error) {
    if (isUniqueViolation(error)) throw new AppError("DUPLICATE_NAME", message, 409);
    throw error;
  }
}
const changed = <T extends object>(before: T, patch: Partial<T>) =>
  Object.fromEntries(Object.keys(patch).map((key) => [key, before[key as keyof T]]));

export async function adminCategories(db: Executor, actor: User) {
  requireSuperAdmin(actor);
  return db
    .select({
      id: categories.id,
      name: categories.name,
      active: categories.active,
      itemCount: sql<number>`(SELECT count(*)::int FROM items WHERE items.category_id = "categories"."id")`,
    })
    .from(categories)
    .orderBy(asc(categories.name));
}
export async function createCategory(db: Database, actor: User, raw: unknown, key?: string) {
  requireSuperAdmin(actor);
  const input = categoryInput.parse(raw);
  return mutation(db, actor.id, "category:create", key, input, async (tx) => {
    const [row] = await uniqueName(
      () => tx.insert(categories).values(input).returning(),
      "Kategori dengan nama itu sudah ada.",
    );
    await audit(tx, actor, "category_created", "categories", row.id, {
      name: row.name,
      active: row.active,
    });
    return row;
  });
}
export async function updateCategory(
  db: Database,
  actor: User,
  id: string,
  raw: unknown,
  key?: string,
) {
  requireSuperAdmin(actor);
  const input = categoryPatch.parse(raw);
  return mutation(db, actor.id, `category:update:${id}`, key, input, async (tx) => {
    const [before] = await tx.select().from(categories).where(eq(categories.id, id)).for("update");
    assert(before, "NOT_FOUND", "Kategori tidak ditemukan.", 404);
    const [row] = await uniqueName(
      () => tx.update(categories).set(input).where(eq(categories.id, id)).returning(),
      "Kategori dengan nama itu sudah ada.",
    );
    await audit(tx, actor, "category_updated", "categories", id, {
      before: changed(before, input),
      after: input,
    });
    return row;
  });
}
export async function deleteCategory(db: Database, actor: User, id: string, key?: string) {
  requireSuperAdmin(actor);
  return mutation(db, actor.id, `category:delete:${id}`, key, { id }, async (tx) => {
    const [row] = await tx.select().from(categories).where(eq(categories.id, id)).for("update");
    assert(row, "NOT_FOUND", "Kategori tidak ditemukan.", 404);
    const [used] = await tx
      .select({ id: items.id })
      .from(items)
      .where(eq(items.categoryId, id))
      .limit(1);
    assert(
      !used,
      "CATEGORY_IN_USE",
      "Kategori sudah dipakai listing. Nonaktifkan saja agar tidak ditawarkan lagi.",
      409,
    );
    await tx.delete(categories).where(eq(categories.id, id));
    await audit(tx, actor, "category_deleted", "categories", id, { name: row.name });
    return { id };
  });
}

export async function adminPickupPoints(db: Executor, actor: User, campusId?: string) {
  requireSuperAdmin(actor);
  const rows = await db
    .select({
      ...pointFields,
      campusId: pickupPoints.campusId,
      campusName: campuses.name,
      active: pickupPoints.active,
      itemCount: sql<number>`(SELECT count(*)::int FROM item_pickup_points ip WHERE ip.pickup_point_id = "pickup_points"."id")`,
    })
    .from(pickupPoints)
    .innerJoin(campuses, eq(campuses.id, pickupPoints.campusId))
    .where(campusId ? eq(pickupPoints.campusId, campusId) : undefined)
    .orderBy(asc(campuses.name), asc(pickupPoints.name))
    .limit(500);
  return rows.map((row) => ({ ...row, hoursSummary: summarizeHours(row.hours) }));
}
export async function createPickupPoint(db: Database, actor: User, raw: unknown, key?: string) {
  requireSuperAdmin(actor);
  const input = pickupPointInput.parse(raw);
  return mutation(db, actor.id, "pickup-point:create", key, input, async (tx) => {
    const [campus] = await tx.select().from(campuses).where(eq(campuses.id, input.campusId));
    assert(campus?.isActive, "INVALID_CAMPUS", "Pilih kampus yang tersedia.", 422);
    const [row] = await uniqueName(
      () => tx.insert(pickupPoints).values(input).returning(),
      "Titik dengan nama itu sudah ada di kampus ini.",
    );
    await audit(tx, actor, "pickup_point_created", "pickup_points", row.id, {
      campusId: row.campusId,
      name: row.name,
      active: row.active,
    });
    return row;
  });
}
export async function updatePickupPoint(
  db: Database,
  actor: User,
  id: string,
  raw: unknown,
  key?: string,
) {
  requireSuperAdmin(actor);
  const input = pickupPointPatch.parse(raw);
  return mutation(db, actor.id, `pickup-point:update:${id}`, key, input, async (tx) => {
    const [before] = await tx
      .select()
      .from(pickupPoints)
      .where(eq(pickupPoints.id, id))
      .for("update");
    assert(before, "NOT_FOUND", "Titik serah terima tidak ditemukan.", 404);
    const [row] = await uniqueName(
      () => tx.update(pickupPoints).set(input).where(eq(pickupPoints.id, id)).returning(),
      "Titik dengan nama itu sudah ada di kampus ini.",
    );
    await audit(tx, actor, "pickup_point_updated", "pickup_points", id, {
      before: changed(before, input),
      after: input,
    });
    return row;
  });
}
export async function deletePickupPoint(db: Database, actor: User, id: string, key?: string) {
  requireSuperAdmin(actor);
  return mutation(db, actor.id, `pickup-point:delete:${id}`, key, { id }, async (tx) => {
    const [row] = await tx.select().from(pickupPoints).where(eq(pickupPoints.id, id)).for("update");
    assert(row, "NOT_FOUND", "Titik serah terima tidak ditemukan.", 404);
    const [used] = await tx
      .select({ itemId: itemPickupPoints.itemId })
      .from(itemPickupPoints)
      .where(eq(itemPickupPoints.pickupPointId, id))
      .limit(1);
    assert(
      !used,
      "PICKUP_POINT_IN_USE",
      "Titik sudah dipakai listing. Nonaktifkan saja agar tidak ditawarkan lagi.",
      409,
    );
    await tx.delete(pickupPoints).where(eq(pickupPoints.id, id));
    await audit(tx, actor, "pickup_point_deleted", "pickup_points", id, {
      campusId: row.campusId,
      name: row.name,
    });
    return { id };
  });
}
