import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import type { Database } from "@/src/db";
import * as s from "@/src/db/schema";
import { DEFAULT_HOURS } from "@/src/domain/pickup-points";
import { addDays, wibDateKey } from "@/src/domain/availability";
import { canUpload } from "@/src/lib/storage";
import {
  addBlock,
  changeItemStatus,
  createItem,
  itemAvailability,
  itemBlocks,
  itemDetail,
  itemForEdit,
  listingOptions,
  myItems,
  removeBlock,
  updateItem,
} from "@/src/services/item-service";
import { decideItem, moderationDetail, moderationQueue } from "@/src/services/moderation-service";
import {
  adminCategories,
  createCategory,
  createPickupPoint,
  deleteCategory,
  deletePickupPoint,
  updateCategory,
  updatePickupPoint,
} from "@/src/services/catalog-service";
import { homeFeed, ownerListings, searchItems } from "@/src/services/search-service";
import { adminSummary } from "@/src/services/admin-service";
import { changeSettings, getSettings } from "@/src/services/settings-service";
import { DEFAULT_CATEGORIES, seedDefaultCategories } from "../scripts/lib/seed-categories";
import { campusId, resetDatabase, testDatabase, user } from "./helpers/database";

const mocks = vi.hoisted(() => ({ download: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ storage: { from: () => ({ download: mocks.download }) } }),
}));
const jfif = [255, 216, 255, 224, 0, 16, 74, 70, 73, 70, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 255, 218];
let db: Database, close: () => Promise<void>;
beforeAll(async () => {
  ({ db, close } = await testDatabase());
});
afterAll(async () => close?.());
beforeEach(async () => {
  await resetDatabase(db);
  vi.clearAllMocks();
  process.env.SUPABASE_URL = "https://storage.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test";
  mocks.download.mockResolvedValue({ data: new Blob([new Uint8Array(jfif)]), error: null });
});

async function category(name = `Kategori ${crypto.randomUUID().slice(0, 8)}`, active = true) {
  const [row] = await db.insert(s.categories).values({ name, active }).returning();
  return row;
}
async function point(campus = campusId, patch: Partial<typeof s.pickupPoints.$inferInsert> = {}) {
  const [row] = await db
    .insert(s.pickupPoints)
    .values({
      campusId: campus,
      name: `Titik ${crypto.randomUUID().slice(0, 8)}`,
      hours: DEFAULT_HOURS,
      ...patch,
    })
    .returning();
  return row;
}
async function owner(patch: Partial<typeof s.users.$inferInsert> = {}) {
  const row = await user(db, { verificationStatus: "terverifikasi", ...patch });
  await db.insert(s.payoutAccounts).values({
    userId: row.id,
    type: "bank",
    provider: "BCA",
    accountNoEnc: "v1.test.test.test",
    accountName: row.name,
  });
  return row;
}
async function photos(userId: string, count = 3) {
  const result = [];
  for (let i = 0; i < count; i++) {
    const pair = {
      path: `${userId}/item_photo/${crypto.randomUUID()}.webp`,
      thumbPath: `${userId}/item_photo/${crypto.randomUUID()}.webp`,
    };
    await db.insert(s.uploadTickets).values(
      [pair.path, pair.thumbPath].map((path) => ({
        userId,
        path,
        purpose: "item_photo" as const,
        contentType: "image/webp",
        expiresAt: new Date(Date.now() + 3600000),
      })),
    );
    result.push(pair);
  }
  return result;
}
async function draft(userId: string, patch: Record<string, unknown> = {}) {
  const [cat, spot] = [await category(), await point()];
  return {
    title: "Kamera Canon EOS 1200D",
    categoryId: cat.id,
    description: "Kondisi mulus, lengkap dengan charger, baterai cadangan, dan tas.",
    itemValue: 3_000_000,
    pricePerDay: 50_000,
    deposit: 300_000,
    minDays: 1,
    maxDays: 7,
    pickupPointIds: [spot.id],
    photos: await photos(userId),
    ...patch,
  };
}
// Inserts a published listing directly, for search scenarios that do not exercise moderation.
async function listing(
  ownerId: string,
  options: {
    categoryId?: string;
    pointId?: string;
    campus?: string;
    patch?: Partial<typeof s.items.$inferInsert>;
  } = {},
) {
  const campus = options.campus ?? campusId;
  const categoryId = options.categoryId ?? (await category()).id;
  const pointId = options.pointId ?? (await point(campus)).id;
  const [row] = await db
    .insert(s.items)
    .values({
      ownerId,
      campusId: campus,
      categoryId,
      title: "Tenda dome kapasitas empat orang",
      description: "Tenda bersih tanpa sobek, lengkap dengan pasak dan tali.",
      itemValue: 800_000,
      pricePerDay: 25_000,
      deposit: 100_000,
      minDays: 1,
      maxDays: 5,
      status: "aktif",
      publishedAt: new Date(),
      ...options.patch,
    })
    .returning();
  await db.insert(s.itemPhotos).values(
    [0, 1, 2].map((sort) => ({
      itemId: row.id,
      path: `${ownerId}/item_photo/${crypto.randomUUID()}.webp`,
      thumbPath: `${ownerId}/item_photo/${crypto.randomUUID()}.webp`,
      sort,
    })),
  );
  await db.insert(s.itemPickupPoints).values({ itemId: row.id, pickupPointId: pointId });
  return row;
}
const reload = async (id: string) => (await db.select().from(s.items).where(eq(s.items.id, id)))[0];
async function approve(id: string) {
  const admin = await user(db, { role: "admin" });
  return decideItem(db, admin, id, { decision: "disetujui", version: (await reload(id)).version });
}

describe("Membuat listing (F4, A-3.2)", () => {
  it("membuat listing menunggu review di kampus pemilik dan memakai tiket foto sekali", async () => {
    const actor = await owner(),
      input = await draft(actor.id);
    const created = await createItem(db, actor, input, "create-item-1");
    expect(created.status).toBe("menunggu_review");
    const replay = await createItem(db, actor, input, "create-item-1");
    expect(replay.id).toBe(created.id);
    expect(await db.select().from(s.items)).toHaveLength(1);
    const item = await reload(created.id);
    expect(item).toMatchObject({ campusId, ownerId: actor.id, version: 1, publishedAt: null });
    const stored = await db
      .select()
      .from(s.itemPhotos)
      .where(eq(s.itemPhotos.itemId, created.id))
      .orderBy(s.itemPhotos.sort);
    expect(stored.map((photo) => photo.path)).toEqual(input.photos.map((photo) => photo.path));
    expect((await db.select().from(s.uploadTickets)).every((ticket) => ticket.used)).toBe(true);
    expect(await db.select().from(s.notifications)).toEqual([
      expect.objectContaining({
        userId: actor.id,
        type: "listing_submitted",
        link: "/profil/listing",
      }),
    ]);
    await expect(createItem(db, actor, input)).rejects.toMatchObject({ code: "INVALID_UPLOAD" });
  });
  it("mewajibkan verifikasi, rekening pencairan, dan akun aktif", async () => {
    const unverified = await user(db);
    await expect(createItem(db, unverified, await draft(unverified.id))).rejects.toMatchObject({
      code: "VERIFICATION_REQUIRED",
      status: 403,
    });
    const noPayout = await user(db, { verificationStatus: "terverifikasi" });
    await expect(createItem(db, noPayout, await draft(noPayout.id))).rejects.toMatchObject({
      code: "PAYOUT_REQUIRED",
      status: 409,
    });
    const suspended = await owner({ accountStatus: "ditangguhkan" });
    await expect(createItem(db, suspended, await draft(suspended.id))).rejects.toMatchObject({
      code: "ACCOUNT_RESTRICTED",
    });
    expect(await db.select().from(s.items)).toHaveLength(0);
    expect(canUpload.bind(null, unverified, "avatar")).not.toThrow();
    expect(() => canUpload(unverified, "item_photo")).toThrow();
  });
  it("memvalidasi kategori aktif, titik di kampus listing, dan rentang deposit dari settings", async () => {
    const actor = await owner();
    const [otherCampus] = await db.insert(s.campuses).values({ name: "Kampus Lain" }).returning();
    const cases: [Record<string, unknown>, string][] = [
      [{ categoryId: (await category(undefined, false)).id }, "INVALID_CATEGORY"],
      [{ pickupPointIds: [(await point(otherCampus.id)).id] }, "INVALID_PICKUP_POINT"],
      [{ pickupPointIds: [(await point(campusId, { active: false })).id] }, "INVALID_PICKUP_POINT"],
      [{ deposit: 2_000_000 }, "INVALID_DEPOSIT"],
      [{ deposit: 200_000 }, "INVALID_DEPOSIT"],
    ];
    for (const [patch, code] of cases)
      await expect(createItem(db, actor, await draft(actor.id, patch))).rejects.toMatchObject({
        code,
      });
    await expect(
      createItem(db, actor, await draft(actor.id, { deposit: 200_000 })),
    ).rejects.toThrow("Rp300.000 dan Rp1.000.000");
    const superAdmin = await user(db, { role: "super_admin" });
    await changeSettings(db, superAdmin, { deposit_min_bp: 500 });
    await expect(
      createItem(db, actor, await draft(actor.id, { deposit: 200_000 })),
    ).resolves.toBeTruthy();
  });
  it("menolak foto milik orang lain, belum terunggah, atau masih bermetadata", async () => {
    const actor = await owner(),
      other = await owner();
    await expect(
      createItem(db, actor, await draft(actor.id, { photos: await photos(other.id) })),
    ).rejects.toMatchObject({ code: "INVALID_UPLOAD" });
    mocks.download.mockResolvedValueOnce({ data: null, error: new Error("not found") });
    await expect(createItem(db, actor, await draft(actor.id))).rejects.toMatchObject({
      code: "UPLOAD_MISSING",
    });
    mocks.download.mockResolvedValueOnce({
      data: new Blob([new Uint8Array([255, 216, 255, 225, 0, 8, 69, 120, 105, 102, 0, 0])]),
      error: null,
    });
    await expect(createItem(db, actor, await draft(actor.id))).rejects.toMatchObject({
      code: "PHOTO_METADATA",
    });
    expect(await db.select().from(s.items)).toHaveLength(0);
  });
  it("database menolak titik dari kampus lain dan pemindahan kampus listing", async () => {
    const actor = await owner();
    const [otherCampus] = await db.insert(s.campuses).values({ name: "Kampus Lain" }).returning();
    const item = await listing(actor.id);
    const foreign = await point(otherCampus.id);
    await expect(
      db.insert(s.itemPickupPoints).values({ itemId: item.id, pickupPointId: foreign.id }),
    ).rejects.toThrow();
    await expect(
      db.update(s.items).set({ campusId: otherCampus.id }).where(eq(s.items.id, item.id)),
    ).rejects.toThrow();
  });
  it("menyiapkan opsi wizard sesuai kampus dan kelayakan pengguna", async () => {
    const actor = await owner();
    await category("Kamera");
    await category("Terlarang", false);
    await point();
    const options = await listingOptions(db, actor);
    expect(options.eligibility).toEqual({
      active: true,
      onboarded: true,
      verified: true,
      payout: true,
      campusActive: true,
    });
    expect(options.categories.map((row) => row.name)).toEqual(["Kamera"]);
    expect(options.pickupPoints).toHaveLength(1);
    expect(options.pickupPoints[0].hoursSummary[0]).toBe("Sen–Jum 08.00–17.00");
    expect(options.rules).toMatchObject({ deposit_cap: 1_000_000, commission_rate_bp: 1000 });
  });
});

describe("Mengubah listing dan status pemilik", () => {
  it("harga dan urutan foto langsung berlaku; judul, foto baru, atau kategori ditinjau ulang", async () => {
    const actor = await owner(),
      input = await draft(actor.id);
    const { id } = await createItem(db, actor, input);
    await approve(id);
    const reordered = { ...input, photos: [...input.photos].reverse(), pricePerDay: 60_000 };
    expect(await updateItem(db, actor, id, reordered)).toMatchObject({
      status: "aktif",
      reviewRequired: false,
    });
    const afterPrice = await reload(id);
    expect(afterPrice).toMatchObject({ status: "aktif", pricePerDay: 60_000, version: 2 });
    const hourAgo = new Date(Date.now() - 3600000);
    await db.update(s.items).set({ submittedAt: hourAgo }).where(eq(s.items.id, id));
    const renamed = { ...reordered, title: "Kamera Canon EOS 1200D + lensa" };
    expect(await updateItem(db, actor, id, renamed)).toMatchObject({
      status: "menunggu_review",
      reviewRequired: true,
    });
    const afterRename = await reload(id);
    expect(afterRename.submittedAt.getTime()).toBeGreaterThan(hourAgo.getTime() + 3000000);
    expect(afterRename.publishedAt).toEqual(afterPrice.publishedAt);
    await approve(id);
    const extra = (await photos(actor.id, 1))[0];
    expect(
      await updateItem(db, actor, id, { ...renamed, photos: [...renamed.photos, extra] }),
    ).toMatchObject({ status: "menunggu_review" });
    const stored = await db.select().from(s.itemPhotos).where(eq(s.itemPhotos.itemId, id));
    expect(stored).toHaveLength(4);
  });
  it("listing yang ditolak dikirim ulang lewat perubahan apa pun", async () => {
    const actor = await owner(),
      admin = await user(db, { role: "admin" }),
      input = await draft(actor.id);
    const { id } = await createItem(db, actor, input);
    await decideItem(db, admin, id, {
      decision: "ditolak",
      reason: "Foto kurang jelas",
      version: 1,
    });
    expect((await myItems(db, actor))[0]).toMatchObject({
      status: "ditolak",
      rejectReason: "Foto kurang jelas",
    });
    await updateItem(db, actor, id, { ...input, pricePerDay: 55_000 });
    expect(await reload(id)).toMatchObject({ status: "menunggu_review", rejectReason: null });
  });
  it("pasangan foto lama tidak boleh ditukar dan pemilik lain tidak bisa mengubah", async () => {
    const actor = await owner(),
      other = await owner(),
      input = await draft(actor.id);
    const { id } = await createItem(db, actor, input);
    const swapped = input.photos.map((photo, i) => ({
      path: photo.path,
      thumbPath: input.photos[(i + 1) % 3].thumbPath,
    }));
    await expect(updateItem(db, actor, id, { ...input, photos: swapped })).rejects.toMatchObject({
      code: "INVALID_UPLOAD",
    });
    await expect(updateItem(db, other, id, input)).rejects.toMatchObject({ status: 404 });
    await expect(itemForEdit(db, other, id)).rejects.toMatchObject({ status: 404 });
    await expect(changeItemStatus(db, other, id, "archive")).rejects.toMatchObject({ status: 404 });
    await expect(
      addBlock(db, other, id, {
        from: addDays(wibDateKey(new Date()), 1),
        to: addDays(wibDateKey(new Date()), 1),
      }),
    ).rejects.toMatchObject({ status: 404 });
  });
  it("jeda, aktifkan, dan arsip mengikuti aturan; arsip bersifat final", async () => {
    const actor = await owner(),
      input = await draft(actor.id);
    const { id } = await createItem(db, actor, input);
    await expect(changeItemStatus(db, actor, id, "pause")).rejects.toMatchObject({
      code: "INVALID_STATUS",
    });
    await approve(id);
    expect(await changeItemStatus(db, actor, id, "pause")).toEqual({ id, status: "dijeda" });
    expect((await searchItems(db, {})).items).toHaveLength(0);
    expect(await changeItemStatus(db, actor, id, "resume")).toEqual({ id, status: "aktif" });
    expect((await searchItems(db, {})).items).toHaveLength(1);
    expect(await changeItemStatus(db, actor, id, "archive")).toEqual({ id, status: "diarsipkan" });
    await expect(changeItemStatus(db, actor, id, "resume")).rejects.toMatchObject({ status: 409 });
    await expect(updateItem(db, actor, id, input)).rejects.toMatchObject({ code: "ITEM_ARCHIVED" });
    await expect(itemForEdit(db, actor, id)).rejects.toMatchObject({ code: "ITEM_ARCHIVED" });
  });
});

describe("Kalender blokir", () => {
  it("memblokir tanggal mendatang, menolak tumpang tindih/masa lalu, dan dapat dihapus", async () => {
    const actor = await owner(),
      item = await listing(actor.id),
      today = wibDateKey(new Date());
    const from = addDays(today, 1),
      to = addDays(today, 3);
    const block = await addBlock(db, actor, item.id, { from, to, reason: "Dipakai sendiri" });
    await expect(
      addBlock(db, actor, item.id, { from: addDays(today, 3), to: addDays(today, 4) }),
    ).rejects.toMatchObject({ code: "BLOCK_OVERLAP" });
    await expect(
      addBlock(db, actor, item.id, { from: addDays(today, -1), to: today }),
    ).rejects.toMatchObject({ code: "INVALID_DATES" });
    await expect(
      addBlock(db, actor, item.id, { from: addDays(today, 4), to: addDays(today, 4) }),
    ).resolves.toBeTruthy();
    const { blocks } = await itemBlocks(db, actor, item.id);
    expect(blocks[0]).toEqual({ id: block.id, from, to, reason: "Dipakai sendiri" });
    const month = from.slice(0, 7);
    const availability = await itemAvailability(db, item.id, month, null);
    expect(availability.unavailable).toContain(from);
    expect(availability.unavailable.every((day) => day.startsWith(month))).toBe(true);
    const other = await owner();
    await expect(removeBlock(db, other, item.id, block.id)).rejects.toMatchObject({ status: 404 });
    await removeBlock(db, actor, item.id, block.id);
    expect((await itemBlocks(db, actor, item.id)).blocks).toHaveLength(1);
    await expect(itemAvailability(db, item.id, "2026-13", null)).rejects.toMatchObject({
      code: "INVALID_MONTH",
    });
  });
});

describe("Moderasi listing (F21)", () => {
  it("persetujuan menerbitkan listing dengan audit dan notifikasi", async () => {
    const actor = await owner(),
      admin = await user(db, { role: "admin" });
    const { id } = await createItem(db, actor, await draft(actor.id));
    expect(await adminSummary(db, admin)).toMatchObject({ listingsPending: 1, listingsOverdue: 0 });
    const [queued] = await moderationQueue(db, admin);
    expect(queued).toMatchObject({
      id,
      ownerName: actor.name,
      overdue: false,
      reviewedBefore: false,
    });
    await decideItem(db, admin, id, { decision: "disetujui", version: 1 }, "decide-1");
    await decideItem(db, admin, id, { decision: "disetujui", version: 1 }, "decide-1");
    expect(await reload(id)).toMatchObject({ status: "aktif", reviewedBy: admin.id });
    expect((await reload(id)).publishedAt).toBeInstanceOf(Date);
    expect(await db.select().from(s.adminAuditLogs)).toEqual([
      expect.objectContaining({ action: "item_disetujui", targetType: "items", targetId: id }),
    ]);
    const decided = await db
      .select()
      .from(s.notifications)
      .where(eq(s.notifications.type, "listing_decided"));
    expect(decided).toEqual([expect.objectContaining({ userId: actor.id, link: `/barang/${id}` })]);
    expect(await moderationQueue(db, admin)).toHaveLength(0);
    expect((await moderationDetail(db, admin, id)).history).toEqual([
      expect.objectContaining({ action: "item_disetujui", adminName: admin.name }),
    ]);
  });
  it("penolakan wajib beralasan; admin tidak meninjau listing sendiri; pengguna biasa ditolak", async () => {
    const actor = await owner(),
      admin = await owner({ role: "admin" });
    const { id } = await createItem(db, actor, await draft(actor.id));
    await expect(decideItem(db, admin, id, { decision: "ditolak", version: 1 })).rejects.toThrow();
    await expect(
      decideItem(db, actor, id, { decision: "disetujui", version: 1 }),
    ).rejects.toMatchObject({
      status: 403,
    });
    await expect(moderationQueue(db, actor)).rejects.toMatchObject({ status: 403 });
    const own = await createItem(db, admin, await draft(admin.id));
    await expect(
      decideItem(db, admin, own.id, { decision: "disetujui", version: 1 }),
    ).rejects.toMatchObject({ code: "SELF_REVIEW_FORBIDDEN" });
    expect((await moderationDetail(db, admin, own.id)).owner.isSelf).toBe(true);
  });
  it("keputusan atas versi lama ditolak setelah pemilik mengubah listing", async () => {
    const actor = await owner(),
      admin = await user(db, { role: "admin" }),
      input = await draft(actor.id);
    const { id } = await createItem(db, actor, input);
    await updateItem(db, actor, id, { ...input, title: "Judul baru yang menyesatkan" });
    await expect(
      decideItem(db, admin, id, { decision: "disetujui", version: 1 }),
    ).rejects.toMatchObject({ code: "ITEM_CHANGED", status: 409 });
    await expect(
      decideItem(db, admin, id, { decision: "disetujui", version: 2 }),
    ).resolves.toMatchObject({
      status: "aktif",
    });
  });
  it("dua admin yang memutuskan bersamaan hanya menghasilkan satu keputusan", async () => {
    const actor = await owner(),
      admin1 = await user(db, { role: "admin" }),
      admin2 = await user(db, { role: "admin" });
    const { id } = await createItem(db, actor, await draft(actor.id));
    const results = await Promise.allSettled([
      decideItem(db, admin1, id, { decision: "disetujui", version: 1 }),
      decideItem(db, admin2, id, { decision: "ditolak", reason: "Foto kurang jelas", version: 1 }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(await db.select().from(s.adminAuditLogs)).toHaveLength(1);
  });
  it("detail moderasi menandai deposit di luar rentang settings terbaru", async () => {
    const actor = await owner(),
      superAdmin = await user(db, { role: "super_admin" });
    const { id } = await createItem(db, actor, await draft(actor.id));
    expect((await moderationDetail(db, superAdmin, id)).depositValid).toBe(true);
    await changeSettings(db, superAdmin, { deposit_cap: 200_000 });
    const detail = await moderationDetail(db, superAdmin, id);
    expect(detail).toMatchObject({
      depositValid: false,
      depositRange: { min: 200_000, max: 200_000 },
    });
    expect(detail.photos).toHaveLength(3);
    expect(detail.photos[0].url).toMatch(
      /^https:\/\/storage\.test\/storage\/v1\/object\/public\/items-public\//,
    );
  });
});

describe("Kategori dan titik serah terima (F27)", () => {
  it("hanya super admin yang mengelola kategori, dengan audit dan nama unik", async () => {
    const admin = await user(db, { role: "admin" }),
      superAdmin = await user(db, { role: "super_admin" });
    await expect(createCategory(db, admin, { name: "Kamera" })).rejects.toMatchObject({
      status: 403,
    });
    await expect(adminCategories(db, admin)).rejects.toMatchObject({ status: 403 });
    const created = await createCategory(db, superAdmin, { name: "Kamera" });
    await expect(createCategory(db, superAdmin, { name: "kamera" })).rejects.toMatchObject({
      code: "DUPLICATE_NAME",
      status: 409,
    });
    await updateCategory(db, superAdmin, created.id, { active: false });
    const actor = await owner();
    await listing(actor.id, {
      categoryId: (await createCategory(db, superAdmin, { name: "Tenda" })).id,
    });
    const used = (await adminCategories(db, superAdmin)).find((row) => row.name === "Tenda")!;
    expect(used.itemCount).toBe(1);
    await expect(deleteCategory(db, superAdmin, used.id)).rejects.toMatchObject({
      code: "CATEGORY_IN_USE",
    });
    await deleteCategory(db, superAdmin, created.id);
    const actions = (
      await db.select().from(s.adminAuditLogs).orderBy(s.adminAuditLogs.createdAt)
    ).map((row) => row.action);
    expect(actions).toEqual([
      "category_created",
      "category_updated",
      "category_created",
      "category_deleted",
    ]);
  });
  it("titik serah terima terikat kampus aktif, jamnya divalidasi, dan tidak dihapus bila terpakai", async () => {
    const superAdmin = await user(db, { role: "super_admin" });
    const [campus] = await db.insert(s.campuses).values({ name: "Kampus Aktif" }).returning();
    await db.update(s.campuses).set({ isActive: false }).where(eq(s.campuses.id, campusId));
    await expect(
      createPickupPoint(db, superAdmin, { campusId, name: "Perpustakaan", hours: DEFAULT_HOURS }),
    ).rejects.toMatchObject({ code: "INVALID_CAMPUS" });
    const created = await createPickupPoint(db, superAdmin, {
      campusId: campus.id,
      name: "Perpustakaan Pusat",
      hours: DEFAULT_HOURS,
    });
    await expect(
      createPickupPoint(db, superAdmin, {
        campusId: campus.id,
        name: "perpustakaan pusat",
        hours: DEFAULT_HOURS,
      }),
    ).rejects.toMatchObject({ code: "DUPLICATE_NAME" });
    await expect(
      createPickupPoint(db, superAdmin, {
        campusId: campus.id,
        name: "Kantin",
        hours: Array(7).fill(null),
      }),
    ).rejects.toThrow();
    await expect(updatePickupPoint(db, superAdmin, created.id, { campusId })).rejects.toThrow();
    await updatePickupPoint(db, superAdmin, created.id, { description: "Lobi depan" });
    const actor = await owner({ campusId: campus.id });
    await listing(actor.id, { campus: campus.id, pointId: created.id });
    await expect(deletePickupPoint(db, superAdmin, created.id)).rejects.toMatchObject({
      code: "PICKUP_POINT_IN_USE",
    });
  });
  it("seed kategori hanya mengisi tabel kosong dan tidak memulihkan perubahan admin", async () => {
    expect(await seedDefaultCategories(db)).toBe(DEFAULT_CATEGORIES.length);
    await db
      .update(s.categories)
      .set({ name: "Gadget" })
      .where(eq(s.categories.name, "Elektronik & Gadget"));
    expect(await seedDefaultCategories(db)).toBe(0);
    const names = (await db.select().from(s.categories)).map((row) => row.name);
    expect(names).toContain("Gadget");
    expect(names).not.toContain("Elektronik & Gadget");
  });
});

describe("Pencarian, beranda, dan detail (F5, F6)", () => {
  it("hanya menampilkan listing aktif milik akun aktif dengan kategori dan titik aktif", async () => {
    const actor = await owner(),
      suspended = await owner({ accountStatus: "ditangguhkan" });
    const visible = await listing(actor.id);
    await listing(actor.id, { patch: { status: "menunggu_review", publishedAt: null } });
    await listing(actor.id, { patch: { status: "dijeda" } });
    await listing(suspended.id);
    await listing(actor.id, { categoryId: (await category(undefined, false)).id });
    await listing(actor.id, { pointId: (await point(campusId, { active: false })).id });
    const result = await searchItems(db, {});
    expect(result.items.map((item) => item.id)).toEqual([visible.id]);
    expect(result.items[0]).toMatchObject({
      title: visible.title,
      pricePerDay: 25_000,
      campus: "Kampus Surabaya",
    });
    expect(result.items[0].thumbUrl).toMatch(/items-public\//);
    expect(await ownerListings(db, suspended.id)).toHaveLength(0);
    expect(await ownerListings(db, actor.id)).toHaveLength(1);
  });
  it("mencari teks dengan awalan serta filter kategori, harga, kampus, titik, dan tanggal", async () => {
    const actor = await owner();
    const [otherCampus] = await db.insert(s.campuses).values({ name: "Kampus Lain" }).returning();
    const cam = await category("Kamera");
    const spot = await point();
    const camera = await listing(actor.id, {
      categoryId: cam.id,
      pointId: spot.id,
      patch: {
        title: "Kamera Canon EOS 1200D",
        description: "Lensa kit bersih, baterai awet, dan memory card bawaan.",
        pricePerDay: 75_000,
      },
    });
    const tent = await listing(actor.id, { patch: { pricePerDay: 20_000 } });
    const remote = await listing(actor.id, { campus: otherCampus.id });
    const ids = async (query: Record<string, unknown>) =>
      (await searchItems(db, query)).items.map((item) => item.id).sort();
    expect(await ids({ q: "kame" })).toEqual([camera.id]);
    expect(await ids({ q: "canon 1200" })).toEqual([camera.id]);
    expect(await ids({ q: "pasak" })).toEqual([remote.id, tent.id].sort());
    expect(await ids({ q: "'):* | !" })).toHaveLength(3);
    expect(await ids({ category: cam.id })).toEqual([camera.id]);
    expect(await ids({ min: "50000" })).toEqual([camera.id]);
    expect(await ids({ max: "20000" })).toEqual([tent.id]);
    expect(await ids({ campus: otherCampus.id })).toEqual([remote.id]);
    expect(await ids({ point: spot.id })).toEqual([camera.id]);
    const day = addDays(wibDateKey(new Date()), 2);
    await addBlock(db, actor, tent.id, { from: day, to: day });
    expect(await ids({ from: day })).toEqual([camera.id, remote.id].sort());
    expect(await ids({ from: addDays(day, 1), to: addDays(day, 3) })).toHaveLength(3);
    expect((await searchItems(db, { q: "kamera" })).sort).toBe("relevan");
    expect((await searchItems(db, { sort: "relevan" })).sort).toBe("terbaru");
  });
  it("paginasi cursor tidak menggandakan atau melewatkan listing pada setiap urutan", async () => {
    const actor = await owner(),
      cat = await category(),
      spot = await point(),
      publishedAt = new Date();
    const created = [];
    for (let i = 0; i < 45; i++)
      created.push(
        await listing(actor.id, {
          categoryId: cat.id,
          pointId: spot.id,
          patch: { publishedAt, pricePerDay: i % 2 ? 10_000 : 20_000 },
        }),
      );
    for (const sort of ["terbaru", "termurah", "rating", "relevan"]) {
      const seen: string[] = [];
      let cursor: string | null = null;
      do {
        const page: Awaited<ReturnType<typeof searchItems>> = await searchItems(db, {
          sort,
          q: sort === "relevan" ? "tenda" : undefined,
          cursor: cursor ?? undefined,
        });
        expect(page.items.length).toBeLessThanOrEqual(20);
        seen.push(...page.items.map((item) => item.id));
        cursor = page.nextCursor;
      } while (cursor);
      expect(seen).toHaveLength(45);
      expect(new Set(seen).size).toBe(45);
    }
    const first = await searchItems(db, { sort: "termurah" });
    expect(first.items.every((item) => item.pricePerDay === 10_000)).toBe(true);
    await expect(
      searchItems(db, { sort: "terbaru", cursor: first.nextCursor! }),
    ).rejects.toMatchObject({ code: "INVALID_CURSOR" });
    await expect(searchItems(db, { cursor: "bukan-cursor" })).rejects.toMatchObject({
      code: "INVALID_CURSOR",
    });
  });
  it("detail publik hanya untuk listing tayang; pemilik dan admin melihat listing tersembunyi", async () => {
    const actor = await owner(),
      stranger = await user(db),
      admin = await user(db, { role: "admin" });
    const shown = await listing(actor.id);
    const rejected = await listing(actor.id, {
      patch: { status: "ditolak", rejectReason: "Foto kurang jelas", publishedAt: null },
    });
    const detail = await itemDetail(db, shown.id, null);
    expect(detail).toMatchObject({
      publiclyVisible: true,
      viewer: { isOwner: false, canReview: false },
      owner: { id: actor.id, name: actor.name },
    });
    expect(JSON.stringify(detail)).not.toContain(actor.phone);
    expect(detail?.photos).toHaveLength(3);
    expect(detail?.pickupPoints[0].hoursSummary).toEqual([
      "Sen–Jum 08.00–17.00",
      "Sab 08.00–12.00",
    ]);
    expect(await itemDetail(db, rejected.id, null)).toBeNull();
    expect(await itemDetail(db, rejected.id, stranger)).toBeNull();
    expect(await itemDetail(db, rejected.id, actor)).toMatchObject({
      rejectReason: "Foto kurang jelas",
      viewer: { isOwner: true },
    });
    expect(await itemDetail(db, rejected.id, admin)).toMatchObject({ viewer: { canReview: true } });
    await expect(
      itemAvailability(db, rejected.id, wibDateKey(new Date()).slice(0, 7), null),
    ).rejects.toMatchObject({
      status: 404,
    });
  });
  it("beranda memuat kategori aktif, listing terbaru, dan yang paling sering disewa", async () => {
    const actor = await owner();
    await category("Kamera");
    const popular = await listing(actor.id, { patch: { completedCount: 4 } });
    await listing(actor.id);
    const feed = await homeFeed(db);
    expect(feed.newest).toHaveLength(2);
    expect(feed.popular.map((item) => item.id)).toEqual([popular.id]);
    expect(feed.categories.map((row) => row.name)).toContain("Kamera");
  });
  it("tabel marketplace tidak dapat dibaca langsung oleh role browser", async () => {
    const actor = await owner();
    await listing(actor.id);
    for (const table of [s.items, s.categories, s.pickupPoints, s.availabilityBlocks])
      await expect(
        db.transaction(async (tx) => {
          await tx.execute(sql`SET LOCAL ROLE authenticated`);
          await tx.select().from(table);
        }),
      ).rejects.toThrow();
  });
  it("memakai target moderasi 24 jam dari settings", async () => {
    expect((await getSettings(db)).listing_sla_hours).toBe(24);
    const superAdmin = await user(db, { role: "super_admin" });
    await expect(changeSettings(db, superAdmin, { listing_sla_hours: 0 })).rejects.toThrow();
  });
});
