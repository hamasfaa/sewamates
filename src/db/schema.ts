import {
  index,
  pgEnum,
  pgTable,
  text,
  uuid,
  timestamp,
  integer,
  bigint,
  jsonb,
  uniqueIndex,
  boolean,
  smallint,
  primaryKey,
  customType,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type { PickupHours } from "@/src/domain/pickup-points";
import { ITEM_STATUSES } from "@/src/domain/listing";

const created = () => timestamp("created_at", { withTimezone: true }).defaultNow().notNull();
const updated = () => timestamp("updated_at", { withTimezone: true }).defaultNow().notNull();
export const role = pgEnum("user_role", ["user", "admin", "super_admin"]);
export const accountStatus = pgEnum("account_status", ["aktif", "ditangguhkan", "dihapus"]);
export const verificationStatus = pgEnum("verification_status", [
  "belum",
  "menunggu",
  "terverifikasi",
  "ditolak",
]);
export const identityStatus = pgEnum("identity_status", ["menunggu", "diterima", "ditolak"]);
export const loginStatus = pgEnum("login_status", [
  "menunggu",
  "disetujui",
  "dipakai",
  "kedaluwarsa",
]);
export const confirmationStatus = pgEnum("confirmation_status", [
  "menunggu",
  "dikonfirmasi",
  "ditolak",
  "kedaluwarsa",
]);

export const campuses = pgTable("campuses", {
  id: uuid().primaryKey().defaultRandom(),
  name: text().notNull(),
  sourceKey: text("source_key").unique(),
  domains: jsonb().$type<string[]>().notNull().default([]),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: created(),
  updatedAt: updated(),
});
export const users = pgTable("users", {
  id: uuid().primaryKey().defaultRandom(),
  phone: text().notNull().unique(),
  name: text().notNull().default(""),
  avatarUrl: text("avatar_url"),
  role: role().notNull().default("user"),
  telegramUserId: bigint("telegram_user_id", { mode: "number" }).unique(),
  telegramChatId: bigint("telegram_chat_id", { mode: "number" }),
  telegramLinkedAt: timestamp("telegram_linked_at", { withTimezone: true }),
  telegramBlockedAt: timestamp("telegram_blocked_at", { withTimezone: true }),
  accountStatus: accountStatus("account_status").notNull().default("aktif"),
  verificationStatus: verificationStatus("verification_status").notNull().default("belum"),
  campusId: uuid("campus_id").references(() => campuses.id),
  ratingAvg: integer("rating_avg").notNull().default(0),
  ratingCount: integer("rating_count").notNull().default(0),
  completedCount: integer("completed_count").notNull().default(0),
  termsAcceptedAt: timestamp("terms_accepted_at", { withTimezone: true }),
  termsVersion: text("terms_version"),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt: created(),
  updatedAt: updated(),
});
export const identityVerifications = pgTable(
  "identity_verifications",
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    cardType: text("card_type", { enum: ["ktm", "ktp"] }).notNull(),
    cardPhotoPath: text("card_photo_path").notNull(),
    selfiePath: text("selfie_path").notNull(),
    status: identityStatus().notNull().default("menunggu"),
    rejectReason: text("reject_reason"),
    reviewedBy: uuid("reviewed_by").references(() => users.id),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [
    uniqueIndex("one_pending_identity")
      .on(t.userId)
      .where(sql`${t.status} = 'menunggu'`),
    index("identity_queue").on(t.status, t.createdAt),
  ],
);
export const payoutAccounts = pgTable("payout_accounts", {
  id: uuid().primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .unique()
    .references(() => users.id),
  type: text({ enum: ["bank", "ewallet"] }).notNull(),
  provider: text().notNull(),
  accountNoEnc: text("account_no_enc").notNull(),
  accountName: text("account_name").notNull(),
  createdAt: created(),
  updatedAt: updated(),
});
export const sessions = pgTable(
  "sessions",
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    tokenHash: text("token_hash").notNull().unique(),
    userAgent: text("user_agent"),
    ip: text(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: created(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);
export const loginRequests = pgTable(
  "login_requests",
  {
    id: uuid().primaryKey().defaultRandom(),
    tokenHash: text("token_hash").notNull().unique(),
    browserNonceHash: text("browser_nonce_hash").notNull(),
    ipHash: text("ip_hash").notNull(),
    matchCode: text("match_code").notNull(),
    telegramUserId: bigint("telegram_user_id", { mode: "number" }),
    userId: uuid("user_id").references(() => users.id),
    status: loginStatus().notNull().default("menunggu"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [
    index("login_browser_rate").on(t.browserNonceHash, t.createdAt),
    index("login_ip_rate").on(t.ipHash, t.createdAt),
  ],
);
export const actionConfirmations = pgTable(
  "action_confirmations",
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    action: text({ enum: ["ubah_rekening", "hapus_akun"] }).notNull(),
    payload: jsonb().notNull().$type<Record<string, unknown>>(),
    status: confirmationStatus().notNull().default("menunggu"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [
    uniqueIndex("one_pending_action")
      .on(t.userId, t.action)
      .where(sql`${t.status} = 'menunggu'`),
  ],
);
export const telegramUpdates = pgTable("telegram_updates", {
  updateId: bigint("update_id", { mode: "number" }).primaryKey(),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
});
export const settings = pgTable("settings", {
  key: text().primaryKey(),
  value: jsonb().notNull().$type<unknown>(),
  updatedBy: uuid("updated_by").references(() => users.id),
  createdAt: created(),
  updatedAt: updated(),
});
export const adminAuditLogs = pgTable(
  "admin_audit_logs",
  {
    id: uuid().primaryKey().defaultRandom(),
    adminId: uuid("admin_id")
      .notNull()
      .references(() => users.id),
    action: text().notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    meta: jsonb().notNull().default({}).$type<Record<string, unknown>>(),
    createdAt: created(),
  },
  (t) => [index("audit_actor_action").on(t.adminId, t.action, t.createdAt)],
);
export const notifications = pgTable(
  "notifications",
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    type: text().notNull(),
    title: text().notNull(),
    body: text().notNull(),
    link: text().notNull(),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: created(),
  },
  (t) => [index("notifications_user").on(t.userId, t.createdAt)],
);

// Issued upload tickets allow submission to prove ownership and single use.
export const uploadTickets = pgTable("upload_tickets", {
  id: uuid().primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  path: text().notNull().unique(),
  purpose: text({ enum: ["identity_card", "identity_selfie", "avatar", "item_photo"] }).notNull(),
  contentType: text("content_type").notNull(),
  used: boolean().notNull().default(false),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: created(),
});
export const idempotencyKeys = pgTable("idempotency_keys", {
  id: text().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  requestHash: text("request_hash").notNull(),
  response: jsonb().notNull().$type<unknown>(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: created(),
});
export const itemStatus = pgEnum("item_status", ITEM_STATUSES);
// Ranges are written with tstzrange(start, end, '[)') and read through lower()/upper().
const tstzrange = customType<{ data: string }>({ dataType: () => "tstzrange" });
export const categories = pgTable("categories", {
  id: uuid().primaryKey().defaultRandom(),
  name: text().notNull(),
  active: boolean().notNull().default(true),
  createdAt: created(),
  updatedAt: updated(),
});
export const pickupPoints = pgTable("pickup_points", {
  id: uuid().primaryKey().defaultRandom(),
  campusId: uuid("campus_id")
    .notNull()
    .references(() => campuses.id),
  name: text().notNull(),
  description: text().notNull().default(""),
  hours: jsonb("hours_json").notNull().$type<PickupHours>(),
  active: boolean().notNull().default(true),
  createdAt: created(),
  updatedAt: updated(),
});
// search_tsv is a generated column maintained by PostgreSQL; queries reference it in SQL.
export const items = pgTable("items", {
  id: uuid().primaryKey().defaultRandom(),
  ownerId: uuid("owner_id")
    .notNull()
    .references(() => users.id),
  campusId: uuid("campus_id")
    .notNull()
    .references(() => campuses.id),
  categoryId: uuid("category_id")
    .notNull()
    .references(() => categories.id),
  title: text().notNull(),
  description: text().notNull(),
  itemValue: bigint("item_value", { mode: "number" }).notNull(),
  pricePerDay: bigint("price_per_day", { mode: "number" }).notNull(),
  deposit: bigint({ mode: "number" }).notNull(),
  minDays: integer("min_days").notNull(),
  maxDays: integer("max_days").notNull(),
  status: itemStatus().notNull().default("menunggu_review"),
  rejectReason: text("reject_reason"),
  reviewedBy: uuid("reviewed_by").references(() => users.id),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  ratingAvg: integer("rating_avg").notNull().default(0),
  ratingCount: integer("rating_count").notNull().default(0),
  completedCount: integer("completed_count").notNull().default(0),
  version: integer().notNull().default(1),
  createdAt: created(),
  updatedAt: updated(),
});
export const itemPhotos = pgTable("item_photos", {
  id: uuid().primaryKey().defaultRandom(),
  itemId: uuid("item_id")
    .notNull()
    .references(() => items.id),
  path: text().notNull().unique(),
  thumbPath: text("thumb_path").notNull().unique(),
  sort: smallint().notNull(),
  createdAt: created(),
});
export const itemPickupPoints = pgTable(
  "item_pickup_points",
  {
    itemId: uuid("item_id")
      .notNull()
      .references(() => items.id),
    pickupPointId: uuid("pickup_point_id")
      .notNull()
      .references(() => pickupPoints.id),
  },
  (t) => [primaryKey({ columns: [t.itemId, t.pickupPointId] })],
);
export const availabilityBlocks = pgTable(
  "availability_blocks",
  {
    id: uuid().primaryKey().defaultRandom(),
    itemId: uuid("item_id")
      .notNull()
      .references(() => items.id),
    period: tstzrange().notNull(),
    reason: text(),
    createdAt: created(),
  },
  (t) => [index("availability_blocks_item").on(t.itemId)],
);
export type User = typeof users.$inferSelect;
export type Role = User["role"];
export type Item = typeof items.$inferSelect;
