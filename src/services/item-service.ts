import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { Database, Executor } from "@/src/db";
import {
  availabilityBlocks,
  campuses,
  categories,
  itemPhotos,
  itemPickupPoints,
  items,
  rentals,
  notifications,
  payoutAccounts,
  pickupPoints,
  users,
  type User,
} from "@/src/db/schema";
import { mutation } from "@/src/db/mutation";
import {
  addDays,
  blockedDays,
  monthKey,
  monthRange,
  periodDates,
  shiftMonth,
  wibDateKey,
  wibDayRange,
  type Period,
} from "@/src/domain/availability";
import {
  needsReview,
  ownerTransition,
  statusAfterEdit,
  type OwnerAction,
} from "@/src/domain/listing";
import { campusLabel } from "@/src/domain/campuses";
import { summarizeHours } from "@/src/domain/pickup-points";
import { depositRange } from "@/src/domain/pricing";
import type { Settings } from "@/src/domain/settings";
import { assert } from "@/src/lib/errors";
import {
  assertItemPhotoPaths,
  claimUploads,
  publicItemUrl,
  verifyItemPhotos,
} from "@/src/lib/storage";
import { rupiah } from "@/src/lib/utils";
import { blockInput, itemInput, type ItemInput } from "@/src/lib/validation";
import { activeCategories, activePickupPoints } from "./catalog-service";
import { requireActive, requireOnboarded, requireVerified } from "./profile-service";
import { getSettings } from "./settings-service";
import { notifyAdmins } from "./notification-service";

// Search and detail share one definition of "publicly listed" (F5): requires users and categories joins.
// Correlated subqueries name "items"."id" literally: Drizzle drops table qualifiers from
// selected SQL in single-table queries, which would bind the inner table's id instead.
export const publiclyListed = and(
  eq(items.status, "aktif"),
  eq(users.accountStatus, "aktif"),
  eq(categories.active, true),
  sql`EXISTS (SELECT 1 FROM item_pickup_points ip JOIN pickup_points p ON p.id = ip.pickup_point_id WHERE ip.item_id = "items"."id" AND p.active)`,
);
export const coverThumb = sql<
  string | null
>`(SELECT thumb_path FROM item_photos WHERE item_id = "items"."id" ORDER BY sort LIMIT 1)`;
const toDate = (value: unknown) => (value instanceof Date ? value : new Date(String(value)));
const periodBounds = {
  start: sql<Date>`lower(${availabilityBlocks.period})`.mapWith(toDate),
  end: sql<Date>`upper(${availabilityBlocks.period})`.mapWith(toDate),
};
const rangeSql = (period: Period) =>
  sql`tstzrange(${period.start.toISOString()}::timestamptz, ${period.end.toISOString()}::timestamptz, '[)')`;
const isStaff = (viewer?: User | null) =>
  Boolean(viewer && viewer.role !== "user" && viewer.accountStatus === "aktif");

function listingRules(rules: Settings) {
  return {
    deposit_min_bp: rules.deposit_min_bp,
    deposit_max_bp: rules.deposit_max_bp,
    deposit_cap: rules.deposit_cap,
    commission_rate_bp: rules.commission_rate_bp,
    listing_sla_hours: rules.listing_sla_hours,
  };
}
async function eligibility(db: Executor, user: User) {
  const [payout] = await db
    .select({ id: payoutAccounts.id })
    .from(payoutAccounts)
    .where(eq(payoutAccounts.userId, user.id));
  const [campus] = user.campusId
    ? await db
        .select({ id: campuses.id, name: campuses.name, isActive: campuses.isActive })
        .from(campuses)
        .where(eq(campuses.id, user.campusId))
    : [];
  return {
    active: user.accountStatus === "aktif",
    onboarded: Boolean(user.name && user.termsAcceptedAt && user.campusId),
    verified: user.verificationStatus === "terverifikasi",
    payout: Boolean(payout),
    campusActive: Boolean(campus?.isActive),
  };
}
async function campusSummary(db: Executor, id: string) {
  const [campus] = await db
    .select({ id: campuses.id, name: campuses.name, domains: campuses.domains })
    .from(campuses)
    .where(eq(campuses.id, id));
  return campus ? { id: campus.id, name: campus.name, label: campusLabel(campus) } : null;
}
export async function listingOptions(db: Executor, user: User) {
  const campus = user.campusId ? await campusSummary(db, user.campusId) : null;
  return {
    eligibility: await eligibility(db, user),
    campus,
    categories: await activeCategories(db),
    pickupPoints: campus ? await activePickupPoints(db, campus.id) : [],
    rules: listingRules(await getSettings(db)),
  };
}
async function ownedItem(db: Executor, userId: string, id: string, lock = false) {
  const query = db.select().from(items).where(eq(items.id, id));
  const [item] = lock ? await query.for("update") : await query;
  assert(item && item.ownerId === userId, "NOT_FOUND", "Listing tidak ditemukan.", 404);
  return item;
}
export async function itemForEdit(db: Executor, user: User, id: string) {
  const item = await ownedItem(db, user.id, id);
  assert(
    item.status !== "diarsipkan",
    "ITEM_ARCHIVED",
    "Listing yang diarsipkan tidak bisa diubah.",
    409,
  );
  const photos = await db
    .select()
    .from(itemPhotos)
    .where(eq(itemPhotos.itemId, id))
    .orderBy(asc(itemPhotos.sort));
  const links = await db
    .select({ id: itemPickupPoints.pickupPointId })
    .from(itemPickupPoints)
    .where(eq(itemPickupPoints.itemId, id));
  const [category] = await db.select().from(categories).where(eq(categories.id, item.categoryId));
  const campus = await campusSummary(db, item.campusId);
  const options = await activeCategories(db);
  return {
    item: {
      id: item.id,
      status: item.status,
      rejectReason: item.rejectReason,
      version: item.version,
      title: item.title,
      categoryId: item.categoryId,
      categoryActive: category.active,
      description: item.description,
      itemValue: item.itemValue,
      pricePerDay: item.pricePerDay,
      deposit: item.deposit,
      minDays: item.minDays,
      maxDays: item.maxDays,
      pickupPointIds: links.map((link) => link.id),
      photos: photos.map((photo) => ({
        path: photo.path,
        thumbPath: photo.thumbPath,
        url: publicItemUrl(photo.path),
        thumbUrl: publicItemUrl(photo.thumbPath),
      })),
    },
    eligibility: await eligibility(db, user),
    campus,
    // A deactivated category stays selectable for its existing listings only.
    categories: category.active
      ? options
      : [...options, { id: category.id, name: `${category.name} (tidak tersedia lagi)` }],
    pickupPoints: await activePickupPoints(db, item.campusId),
    rules: listingRules(await getSettings(db)),
  };
}

async function validateListing(
  tx: Executor,
  input: ItemInput,
  campusId: string,
  rules: Settings,
  currentCategoryId?: string,
) {
  // Share locks keep a category or point from being deleted while this listing references it.
  const [category] = await tx
    .select()
    .from(categories)
    .where(eq(categories.id, input.categoryId))
    .for("share");
  assert(
    category && (category.active || category.id === currentCategoryId),
    "INVALID_CATEGORY",
    "Pilih kategori yang tersedia.",
    422,
  );
  const points = await tx
    .select({ id: pickupPoints.id })
    .from(pickupPoints)
    .where(
      and(
        inArray(pickupPoints.id, input.pickupPointIds),
        eq(pickupPoints.campusId, campusId),
        eq(pickupPoints.active, true),
      ),
    )
    .for("share");
  assert(
    points.length === input.pickupPointIds.length,
    "INVALID_PICKUP_POINT",
    "Pilih titik serah terima yang aktif di kampus listing.",
    422,
  );
  const range = depositRange(input.itemValue, rules);
  assert(
    range.min <= range.max,
    "INVALID_DEPOSIT",
    "Nilai barang terlalu kecil untuk menentukan deposit. Periksa kembali nilai barang.",
    422,
  );
  assert(
    input.deposit >= range.min && input.deposit <= range.max,
    "INVALID_DEPOSIT",
    `Deposit untuk nilai barang ini harus antara ${rupiah(range.min)} dan ${rupiah(range.max)}.`,
    422,
  );
}
const photoFiles = (photos: ItemInput["photos"]) =>
  photos.flatMap((photo) => [photo.path, photo.thumbPath]);

export async function createItem(db: Database, user: User, raw: unknown, key?: string) {
  const input = itemInput.parse(raw);
  const paths = photoFiles(input.photos);
  // Cheap checks before downloading photos; the transaction re-checks the locked row.
  requireActive(user);
  requireVerified(user);
  assertItemPhotoPaths(user.id, paths);
  await verifyItemPhotos(paths);
  return mutation(db, user.id, "item:create", key, input, async (tx) => {
    const [owner] = await tx.select().from(users).where(eq(users.id, user.id)).for("update");
    requireActive(owner);
    requireOnboarded(owner);
    requireVerified(owner);
    const status = await eligibility(tx, owner);
    assert(
      status.payout,
      "PAYOUT_REQUIRED",
      "Lengkapi rekening pencairan sebelum menerbitkan listing.",
      409,
    );
    assert(
      status.campusActive,
      "INVALID_CAMPUS",
      "Kampusmu sudah tidak tersedia. Perbarui kampus di profil.",
      409,
    );
    const rules = await getSettings(tx);
    await validateListing(tx, input, owner.campusId!, rules);
    await claimUploads(tx, owner.id, "item_photo", paths);
    const { photos, pickupPointIds, ...fields } = input;
    const [item] = await tx
      .insert(items)
      .values({ ...fields, ownerId: owner.id, campusId: owner.campusId! })
      .returning({ id: items.id, status: items.status });
    await tx
      .insert(itemPhotos)
      .values(photos.map((photo, sort) => ({ itemId: item.id, ...photo, sort })));
    await tx
      .insert(itemPickupPoints)
      .values(pickupPointIds.map((pickupPointId) => ({ itemId: item.id, pickupPointId })));
    await notifyAdmins(
      tx,
      "Listing perlu ditinjau",
      `Listing “${fields.title}” menunggu moderasi.`,
      "/admin/listing",
    );
    await tx.insert(notifications).values({
      userId: owner.id,
      type: "listing_submitted",
      title: "Listing sedang ditinjau",
      body: `Admin akan memeriksa “${fields.title}” sebelum tampil di pencarian, dengan target ${rules.listing_sla_hours} jam.`,
      link: "/profil/listing",
    });
    return item;
  });
}
export async function updateItem(db: Database, user: User, id: string, raw: unknown, key?: string) {
  const input = itemInput.parse(raw);
  await ownedItem(db, user.id, id);
  const stored = await db
    .select({ path: itemPhotos.path, thumbPath: itemPhotos.thumbPath })
    .from(itemPhotos)
    .where(eq(itemPhotos.itemId, id));
  const known = new Set(stored.flatMap((photo) => [photo.path, photo.thumbPath]));
  const fresh = photoFiles(input.photos).filter((path) => !known.has(path));
  assertItemPhotoPaths(user.id, fresh);
  await verifyItemPhotos(fresh);
  return mutation(db, user.id, `item:update:${id}`, key, input, async (tx) => {
    const item = await ownedItem(tx, user.id, id, true);
    const [owner] = await tx.select().from(users).where(eq(users.id, user.id));
    requireActive(owner);
    requireVerified(owner);
    const before = await tx
      .select()
      .from(itemPhotos)
      .where(eq(itemPhotos.itemId, id))
      .orderBy(asc(itemPhotos.sort));
    const thumbs = new Map(before.map((photo) => [photo.path, photo.thumbPath]));
    assert(
      input.photos.every(
        (photo) => !thumbs.has(photo.path) || thumbs.get(photo.path) === photo.thumbPath,
      ),
      "INVALID_UPLOAD",
      "Foto tidak valid. Muat ulang halaman lalu coba lagi.",
      422,
    );
    const status = statusAfterEdit(
      item.status,
      needsReview(
        { title: item.title, categoryId: item.categoryId, photoPaths: [...thumbs.keys()] },
        {
          title: input.title,
          categoryId: input.categoryId,
          photoPaths: input.photos.map((photo) => photo.path),
        },
      ),
    );
    assert(status, "ITEM_ARCHIVED", "Listing yang diarsipkan tidak bisa diubah.", 409);
    const rules = await getSettings(tx);
    await validateListing(tx, input, item.campusId, rules, item.categoryId);
    await claimUploads(
      tx,
      user.id,
      "item_photo",
      photoFiles(input.photos.filter((photo) => !thumbs.has(photo.path))),
    );
    const resubmitted = status === "menunggu_review" && item.status !== "menunggu_review";
    const { photos, pickupPointIds, ...fields } = input;
    await tx
      .update(items)
      .set({
        ...fields,
        status,
        version: item.version + 1,
        ...(resubmitted ? { submittedAt: new Date(), rejectReason: null } : {}),
      })
      .where(eq(items.id, id));
    await tx.delete(itemPhotos).where(eq(itemPhotos.itemId, id));
    await tx
      .insert(itemPhotos)
      .values(photos.map((photo, sort) => ({ itemId: id, ...photo, sort })));
    await tx.delete(itemPickupPoints).where(eq(itemPickupPoints.itemId, id));
    await tx
      .insert(itemPickupPoints)
      .values(pickupPointIds.map((pickupPointId) => ({ itemId: id, pickupPointId })));
    if (resubmitted) {
      await notifyAdmins(
        tx,
        "Listing perlu ditinjau ulang",
        `Perubahan “${fields.title}” menunggu moderasi.`,
        "/admin/listing",
      );
      await tx.insert(notifications).values({
        userId: user.id,
        type: "listing_submitted",
        title: "Listing dikirim untuk ditinjau ulang",
        body: `Perubahan “${fields.title}” akan diperiksa admin sebelum tampil lagi.`,
        link: "/profil/listing",
      });
    }
    return { id, status, reviewRequired: status === "menunggu_review" };
  });
}
const transitionErrors: Record<OwnerAction, string> = {
  pause: "Hanya listing aktif yang bisa dijeda.",
  resume: "Hanya listing yang sedang dijeda yang bisa diaktifkan lagi.",
  archive: "Listing ini sudah diarsipkan.",
};
export async function changeItemStatus(
  db: Database,
  user: User,
  id: string,
  action: OwnerAction,
  key?: string,
) {
  return mutation(db, user.id, `item:${action}:${id}`, key, { action }, async (tx) => {
    const item = await ownedItem(tx, user.id, id, true);
    if (action === "resume") {
      const [owner] = await tx.select().from(users).where(eq(users.id, user.id));
      requireActive(owner);
    }
    const next = ownerTransition(item.status, action);
    assert(next, "INVALID_STATUS", transitionErrors[action], 409);
    if (action === "archive") {
      const [active] = await tx
        .select({ id: rentals.id })
        .from(rentals)
        .where(
          and(
            eq(rentals.itemId, id),
            sql`${rentals.status} NOT IN ('SELESAI','DITOLAK','KADALUARSA','DIBATALKAN')`,
          ),
        )
        .limit(1);
      assert(
        !active,
        "ACTIVE_RENTAL",
        "Listing masih memiliki transaksi aktif dan belum bisa diarsipkan.",
        409,
      );
    }
    await tx
      .update(items)
      .set({ status: next, version: item.version + 1 })
      .where(eq(items.id, id));
    return { id, status: next };
  });
}

export async function myItems(db: Executor, user: User) {
  const rows = await db
    .select({
      id: items.id,
      title: items.title,
      status: items.status,
      rejectReason: items.rejectReason,
      pricePerDay: items.pricePerDay,
      createdAt: items.createdAt,
      submittedAt: items.submittedAt,
      publishedAt: items.publishedAt,
      categoryName: categories.name,
      categoryActive: categories.active,
      thumbPath: coverThumb,
      activePoints: sql<number>`(SELECT count(*)::int FROM item_pickup_points ip JOIN pickup_points p ON p.id = ip.pickup_point_id WHERE ip.item_id = "items"."id" AND p.active)`,
      upcomingBlocks: sql<number>`(SELECT count(*)::int FROM availability_blocks b WHERE b.item_id = "items"."id" AND upper(b.period) > now())`,
    })
    .from(items)
    .innerJoin(categories, eq(categories.id, items.categoryId))
    .where(eq(items.ownerId, user.id))
    .orderBy(desc(items.createdAt))
    .limit(200);
  return rows.map(({ thumbPath, ...row }) => ({ ...row, thumbUrl: publicItemUrl(thumbPath) }));
}

const MAX_UPCOMING_BLOCKS = 50;
export async function itemBlocks(db: Executor, user: User, itemId: string) {
  const item = await ownedItem(db, user.id, itemId);
  const rows = await db
    .select({ id: availabilityBlocks.id, reason: availabilityBlocks.reason, ...periodBounds })
    .from(availabilityBlocks)
    .where(
      and(eq(availabilityBlocks.itemId, itemId), sql`upper(${availabilityBlocks.period}) > now()`),
    )
    .orderBy(sql`lower(${availabilityBlocks.period})`);
  return {
    item: { id: item.id, title: item.title, status: item.status },
    blocks: rows.map((row) => ({ id: row.id, reason: row.reason, ...periodDates(row) })),
  };
}
export async function addBlock(
  db: Database,
  user: User,
  itemId: string,
  raw: unknown,
  key?: string,
) {
  const input = blockInput.parse(raw);
  const today = wibDateKey(new Date());
  assert(
    input.from >= today,
    "INVALID_DATES",
    "Tanggal yang sudah lewat tidak bisa diblokir.",
    422,
  );
  assert(
    input.to <= addDays(today, 365),
    "INVALID_DATES",
    "Tanggal hanya bisa diblokir sampai satu tahun ke depan.",
    422,
  );
  const range = rangeSql(wibDayRange(input.from, input.to));
  return mutation(db, user.id, `item:block:${itemId}`, key, input, async (tx) => {
    // The item row lock serializes blocks; Sprint 3 rental holds take the same lock (04 §4.3).
    const item = await ownedItem(tx, user.id, itemId, true);
    assert(
      item.status !== "diarsipkan",
      "ITEM_ARCHIVED",
      "Listing yang diarsipkan tidak bisa diatur lagi.",
      409,
    );
    const [overlap] = await tx
      .select({ id: availabilityBlocks.id })
      .from(availabilityBlocks)
      .where(
        and(eq(availabilityBlocks.itemId, itemId), sql`${availabilityBlocks.period} && ${range}`),
      )
      .limit(1);
    assert(
      !overlap,
      "BLOCK_OVERLAP",
      "Sebagian tanggal itu sudah diblokir. Pilih rentang lain.",
      409,
    );
    const [hold] = await tx
      .select({ id: rentals.id })
      .from(rentals)
      .where(
        and(
          eq(rentals.itemId, itemId),
          inArray(rentals.status, ["DISETUJUI", "MENUNGGU_VERIFIKASI", "DIBAYAR", "BERJALAN"]),
          sql`${rentals.blockPeriod} && ${range}`,
        ),
      )
      .limit(1);
    assert(
      !hold,
      "RENTAL_OVERLAP",
      "Tanggal bertabrakan dengan transaksi yang sudah disetujui.",
      409,
    );
    const [{ upcoming }] = await tx
      .select({ upcoming: sql<number>`count(*)::int` })
      .from(availabilityBlocks)
      .where(
        and(
          eq(availabilityBlocks.itemId, itemId),
          sql`upper(${availabilityBlocks.period}) > now()`,
        ),
      );
    assert(
      upcoming < MAX_UPCOMING_BLOCKS,
      "TOO_MANY_BLOCKS",
      "Blokir tanggal sudah terlalu banyak. Gabungkan atau hapus blokir lama.",
      409,
    );
    const [block] = await tx
      .insert(availabilityBlocks)
      .values({ itemId, period: range, reason: input.reason || null })
      .returning({ id: availabilityBlocks.id });
    return { id: block.id, from: input.from, to: input.to, reason: input.reason || null };
  });
}
export async function removeBlock(db: Database, user: User, itemId: string, blockId: string) {
  return db.transaction(async (tx) => {
    await ownedItem(tx, user.id, itemId, true);
    const [removed] = await tx
      .delete(availabilityBlocks)
      .where(and(eq(availabilityBlocks.id, blockId), eq(availabilityBlocks.itemId, itemId)))
      .returning({ id: availabilityBlocks.id });
    assert(removed, "NOT_FOUND", "Blokir tanggal tidak ditemukan.", 404);
    return removed;
  });
}

export async function itemDetail(db: Executor, id: string, viewer?: User | null) {
  const [row] = await db
    .select({
      item: items,
      category: { id: categories.id, name: categories.name, active: categories.active },
      campus: { id: campuses.id, name: campuses.name },
      ownerStatus: users.accountStatus,
      owner: {
        id: users.id,
        name: users.name,
        avatarUrl: users.avatarUrl,
        verificationStatus: users.verificationStatus,
        ratingAvg: users.ratingAvg,
        ratingCount: users.ratingCount,
        completedCount: users.completedCount,
        createdAt: users.createdAt,
      },
    })
    .from(items)
    .innerJoin(users, eq(users.id, items.ownerId))
    .innerJoin(categories, eq(categories.id, items.categoryId))
    .innerJoin(campuses, eq(campuses.id, items.campusId))
    .where(eq(items.id, id));
  if (!row) return null;
  const points = await db
    .select({
      id: pickupPoints.id,
      name: pickupPoints.name,
      description: pickupPoints.description,
      hours: pickupPoints.hours,
      active: pickupPoints.active,
    })
    .from(itemPickupPoints)
    .innerJoin(pickupPoints, eq(pickupPoints.id, itemPickupPoints.pickupPointId))
    .where(eq(itemPickupPoints.itemId, id))
    .orderBy(asc(pickupPoints.name));
  const isOwner = viewer?.id === row.item.ownerId,
    canReview = isStaff(viewer);
  const publiclyVisible =
    row.item.status === "aktif" &&
    row.ownerStatus === "aktif" &&
    row.category.active &&
    points.some((point) => point.active);
  if (!publiclyVisible && !isOwner && !canReview) return null;
  const photos = await db
    .select()
    .from(itemPhotos)
    .where(eq(itemPhotos.itemId, id))
    .orderBy(asc(itemPhotos.sort));
  const { item, owner } = row;
  return {
    id: item.id,
    title: item.title,
    description: item.description,
    status: item.status,
    rejectReason: isOwner || canReview ? item.rejectReason : null,
    itemValue: item.itemValue,
    pricePerDay: item.pricePerDay,
    deposit: item.deposit,
    minDays: item.minDays,
    maxDays: item.maxDays,
    ratingAvg: item.ratingAvg,
    ratingCount: item.ratingCount,
    completedCount: item.completedCount,
    publishedAt: item.publishedAt,
    category: row.category,
    campus: row.campus,
    owner,
    photos: photos.map((photo) => ({
      url: publicItemUrl(photo.path),
      thumbUrl: publicItemUrl(photo.thumbPath),
    })),
    pickupPoints: points
      .filter((point) => point.active || isOwner || canReview)
      .map(({ hours, ...point }) => ({ ...point, hoursSummary: summarizeHours(hours) })),
    publiclyVisible,
    viewer: { isOwner, canReview },
  };
}
export type ItemDetail = NonNullable<Awaited<ReturnType<typeof itemDetail>>>;

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
// Days that cannot be booked: owner blocks now, plus rental holds from Sprint 3.
export async function unavailableDays(db: Executor, itemId: string, month: string) {
  const rows = await db
    .select(periodBounds)
    .from(availabilityBlocks)
    .where(
      and(
        eq(availabilityBlocks.itemId, itemId),
        sql`${availabilityBlocks.period} && ${rangeSql(monthRange(month))}`,
      ),
    );
  const holds = await db
    .select({
      start: sql<Date>`lower(${rentals.blockPeriod})`.mapWith(toDate),
      end: sql<Date>`upper(${rentals.blockPeriod})`.mapWith(toDate),
    })
    .from(rentals)
    .where(
      and(
        eq(rentals.itemId, itemId),
        inArray(rentals.status, ["DISETUJUI", "MENUNGGU_VERIFIKASI", "DIBAYAR", "BERJALAN"]),
        sql`${rentals.blockPeriod} && ${rangeSql(monthRange(month))}`,
      ),
    );
  return blockedDays([...rows, ...holds], month);
}
export async function itemAvailability(
  db: Executor,
  itemId: string,
  month: string,
  viewer?: User | null,
) {
  assert(MONTH.test(month), "INVALID_MONTH", "Pilih bulan yang valid.", 422);
  const current = monthKey(new Date());
  assert(
    month >= shiftMonth(current, -1) && month <= shiftMonth(current, 13),
    "INVALID_MONTH",
    "Kalender hanya tersedia sampai satu tahun ke depan.",
    422,
  );
  assert(await itemDetail(db, itemId, viewer), "NOT_FOUND", "Barang tidak ditemukan.", 404);
  return { month, unavailable: await unavailableDays(db, itemId, month) };
}
