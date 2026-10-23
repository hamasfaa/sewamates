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
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type { PickupHours } from "@/src/domain/pickup-points";
import { ITEM_STATUSES } from "@/src/domain/listing";
import { RENTAL_STATUSES } from "@/src/domain/rental-state-machine";
import type { Settings } from "@/src/domain/settings";
import type { Settlement } from "@/src/domain/payout";
import { DISPUTE_CATEGORIES } from "@/src/domain/dispute";

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
  suspendedAt: timestamp("suspended_at", { withTimezone: true }),
  suspensionReason: text("suspension_reason"),
  strikeReviewedAt: timestamp("strike_reviewed_at", { withTimezone: true }),
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
    purgedAt: timestamp("purged_at", { withTimezone: true }),
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
  purpose: text({
    enum: [
      "identity_card",
      "identity_selfie",
      "avatar",
      "item_photo",
      "payment_proof",
      "chat_image",
      "handover_photo",
      "dispute_evidence",
      "payout_proof",
      "cash_proof",
    ],
  }).notNull(),
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

export const platformAccounts = pgTable("platform_accounts", {
  id: uuid().primaryKey().defaultRandom(),
  type: text().notNull(),
  provider: text().notNull(),
  accountNo: text("account_no").notNull(),
  accountName: text("account_name").notNull(),
  active: boolean().notNull().default(true),
  createdAt: created(),
  updatedAt: updated(),
});
export const conversations = pgTable(
  "conversations",
  {
    id: uuid().primaryKey().defaultRandom(),
    itemId: uuid("item_id")
      .notNull()
      .references(() => items.id),
    renterId: uuid("renter_id")
      .notNull()
      .references(() => users.id),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }).notNull().defaultNow(),
    renterLastReadAt: timestamp("renter_last_read_at", { withTimezone: true }),
    ownerLastReadAt: timestamp("owner_last_read_at", { withTimezone: true }),
    createdAt: created(),
  },
  (t) => [uniqueIndex("conversation_pair").on(t.itemId, t.renterId)],
);
export const rentalStatus = pgEnum("rental_status", RENTAL_STATUSES);
export const rentals = pgTable("rentals", {
  id: uuid().primaryKey().defaultRandom(),
  publicCode: text("public_code").notNull().unique(),
  itemId: uuid("item_id")
    .notNull()
    .references(() => items.id),
  ownerId: uuid("owner_id")
    .notNull()
    .references(() => users.id),
  renterId: uuid("renter_id")
    .notNull()
    .references(() => users.id),
  conversationId: uuid("conversation_id")
    .notNull()
    .references(() => conversations.id),
  pickupPointId: uuid("pickup_point_id")
    .notNull()
    .references(() => pickupPoints.id),
  startAt: timestamp("start_at", { withTimezone: true }).notNull(),
  dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
  days: integer().notNull(),
  blockPeriod: tstzrange("block_period").notNull(),
  pricePerDay: bigint("price_per_day", { mode: "number" }).notNull(),
  rentTotal: bigint("rent_total", { mode: "number" }).notNull(),
  deposit: bigint({ mode: "number" }).notNull(),
  commissionRateBp: integer("commission_rate_bp").notNull(),
  commissionAmount: bigint("commission_amount", { mode: "number" }).notNull(),
  uniqueCode: integer("unique_code"),
  amountDue: bigint("amount_due", { mode: "number" }).notNull(),
  amountReceived: bigint("amount_received", { mode: "number" }).notNull().default(0),
  rulesSnapshot: jsonb("rules_snapshot").notNull().$type<Settings>(),
  listingSnapshot: jsonb("listing_snapshot").notNull().$type<Record<string, unknown>>(),
  status: rentalStatus().notNull().default("DIAJUKAN"),
  respondBy: timestamp("respond_by", { withTimezone: true }).notNull(),
  payBy: timestamp("pay_by", { withTimezone: true }),
  cancelledBy: uuid("cancelled_by").references(() => users.id),
  cancelReason: text("cancel_reason"),
  statusBeforeDispute: rentalStatus("status_before_dispute"),
  returnedAt: timestamp("returned_at", { withTimezone: true }),
  reviewEndsAt: timestamp("review_ends_at", { withTimezone: true }),
  lateFee: bigint("late_fee", { mode: "number" }).notNull().default(0),
  // Late fees stop at the renter's arrival when the owner missed the return (A-3.7).
  lateUntil: timestamp("late_until", { withTimezone: true }),
  ownerOkAt: timestamp("owner_ok_at", { withTimezone: true }),
  renterOkAt: timestamp("renter_ok_at", { withTimezone: true }),
  rescheduleCount: integer("reschedule_count").notNull().default(0),
  settledAt: timestamp("settled_at", { withTimezone: true }),
  settlement: jsonb().$type<Settlement>(),
  version: integer().notNull().default(1),
  createdAt: created(),
  updatedAt: updated(),
});
export type Rental = typeof rentals.$inferSelect;
export const rentalEvents = pgTable("rental_events", {
  id: uuid().primaryKey().defaultRandom(),
  rentalId: uuid("rental_id")
    .notNull()
    .references(() => rentals.id),
  fromStatus: rentalStatus("from_status"),
  toStatus: rentalStatus("to_status").notNull(),
  actorId: uuid("actor_id").references(() => users.id),
  actorType: text("actor_type").notNull(),
  meta: jsonb().notNull().default({}).$type<Record<string, unknown>>(),
  createdAt: created(),
});
export const messages = pgTable("messages", {
  id: uuid().primaryKey().defaultRandom(),
  conversationId: uuid("conversation_id")
    .notNull()
    .references(() => conversations.id),
  senderId: uuid("sender_id").references(() => users.id),
  rentalId: uuid("rental_id").references(() => rentals.id),
  type: text().notNull(),
  body: text().notNull().default(""),
  imagePath: text("image_path"),
  hiddenAt: timestamp("hidden_at", { withTimezone: true }),
  createdAt: created(),
});
export const userBlocks = pgTable(
  "user_blocks",
  {
    blockerId: uuid("blocker_id")
      .notNull()
      .references(() => users.id),
    blockedId: uuid("blocked_id")
      .notNull()
      .references(() => users.id),
    createdAt: created(),
  },
  (t) => [primaryKey({ columns: [t.blockerId, t.blockedId] })],
);
export const reports = pgTable("reports", {
  id: uuid().primaryKey().defaultRandom(),
  reporterId: uuid("reporter_id")
    .notNull()
    .references(() => users.id),
  targetType: text("target_type").notNull(),
  targetId: uuid("target_id").notNull(),
  reason: text().notNull(),
  note: text(),
  actionTaken: text("action_taken"),
  handledBy: uuid("handled_by").references(() => users.id),
  handledAt: timestamp("handled_at", { withTimezone: true }),
  decisionNote: text("decision_note"),
  status: text().notNull().default("menunggu"),
  createdAt: created(),
});
export const payments = pgTable("payments", {
  id: uuid().primaryKey().defaultRandom(),
  rentalId: uuid("rental_id")
    .notNull()
    .references(() => rentals.id),
  platformAccountId: uuid("platform_account_id")
    .notNull()
    .references(() => platformAccounts.id),
  platformSnapshot: jsonb("platform_snapshot").notNull().$type<Record<string, unknown>>(),
  proofPath: text("proof_path").notNull().unique(),
  proofSha256: text("proof_sha256").notNull(),
  senderName: text("sender_name").notNull(),
  transferredAt: timestamp("transferred_at", { withTimezone: true }).notNull(),
  claimedAmount: bigint("claimed_amount", { mode: "number" }).notNull(),
  status: text().notNull().default("menunggu"),
  verifiedAmount: bigint("verified_amount", { mode: "number" }),
  rejectReason: text("reject_reason"),
  verifiedBy: uuid("verified_by").references(() => users.id),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  targetAt: timestamp("target_at", { withTimezone: true }).notNull(),
  settledAt: timestamp("settled_at", { withTimezone: true }),
  createdAt: created(),
});
export const ledgerEntries = pgTable("ledger_entries", {
  id: uuid().primaryKey().defaultRandom(),
  journalId: uuid("journal_id").notNull(),
  rentalId: uuid("rental_id").references(() => rentals.id),
  paymentId: uuid("payment_id").references(() => payments.id),
  payoutTaskId: uuid("payout_task_id").references((): AnyPgColumn => payoutTasks.id),
  cashMovementId: uuid("cash_movement_id").references((): AnyPgColumn => cashMovements.id),
  account: text().notNull(),
  debit: bigint({ mode: "number" }).notNull().default(0),
  credit: bigint({ mode: "number" }).notNull().default(0),
  memo: text().notNull(),
  createdAt: created(),
});
export const payoutTasks = pgTable("payout_tasks", {
  id: uuid().primaryKey().defaultRandom(),
  rentalId: uuid("rental_id")
    .notNull()
    .references(() => rentals.id),
  recipientId: uuid("recipient_id")
    .notNull()
    .references(() => users.id),
  sourcePaymentId: uuid("source_payment_id")
    .unique()
    .references(() => payments.id),
  kind: text().notNull(),
  adjustmentOf: uuid("adjustment_of").references((): AnyPgColumn => payoutTasks.id),
  adjustmentReason: text("adjustment_reason"),
  createdBy: uuid("created_by").references(() => users.id),
  amount: bigint({ mode: "number" }).notNull(),
  accountSnapshot: jsonb("account_snapshot").notNull().$type<Record<string, unknown>>(),
  status: text({ enum: ["menunggu", "diklaim", "selesai"] })
    .notNull()
    .default("menunggu"),
  targetAt: timestamp("target_at", { withTimezone: true }).notNull(),
  claimedBy: uuid("claimed_by").references(() => users.id),
  claimedUntil: timestamp("claimed_until", { withTimezone: true }),
  sourceAccountId: uuid("source_account_id").references(() => platformAccounts.id),
  transferredAmount: bigint("transferred_amount", { mode: "number" }),
  transferFee: bigint("transfer_fee", { mode: "number" }),
  proofPath: text("proof_path").unique(),
  transferredAt: timestamp("transferred_at", { withTimezone: true }),
  completedBy: uuid("completed_by").references(() => users.id),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: created(),
});
export type PayoutTask = typeof payoutTasks.$inferSelect;
export const cashMovements = pgTable("cash_movements", {
  id: uuid().primaryKey().defaultRandom(),
  type: text({ enum: ["antar_rekening", "penarikan_komisi"] }).notNull(),
  fromAccountId: uuid("from_account_id")
    .notNull()
    .references(() => platformAccounts.id),
  toAccountId: uuid("to_account_id").references(() => platformAccounts.id),
  amount: bigint({ mode: "number" }).notNull(),
  fee: bigint({ mode: "number" }).notNull().default(0),
  proofPath: text("proof_path").notNull().unique(),
  note: text(),
  createdBy: uuid("created_by")
    .notNull()
    .references(() => users.id),
  createdAt: created(),
});
export type GeoPoint = { latitude: number; longitude: number; accuracy: number };
export const handoverRecords = pgTable(
  "handover_records",
  {
    id: uuid().primaryKey().defaultRandom(),
    rentalId: uuid("rental_id")
      .notNull()
      .references(() => rentals.id),
    type: text({ enum: ["start", "end"] }).notNull(),
    ownerArrivedAt: timestamp("owner_arrived_at", { withTimezone: true }),
    renterArrivedAt: timestamp("renter_arrived_at", { withTimezone: true }),
    ownerLocation: jsonb("owner_location").$type<GeoPoint>(),
    renterLocation: jsonb("renter_location").$type<GeoPoint>(),
    photosConfirmedAt: timestamp("photos_confirmed_at", { withTimezone: true }),
    codeHash: text("code_hash"),
    codeIssuedAt: timestamp("code_issued_at", { withTimezone: true }),
    codeFailedAttempts: integer("code_failed_attempts").notNull().default(0),
    codeLockedUntil: timestamp("code_locked_until", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [uniqueIndex("handover_records_rental_id_type_key").on(t.rentalId, t.type)],
);
export type HandoverRecord = typeof handoverRecords.$inferSelect;
export const handoverPhotos = pgTable("handover_photos", {
  id: uuid().primaryKey().defaultRandom(),
  handoverId: uuid("handover_id")
    .notNull()
    .references(() => handoverRecords.id),
  uploadedBy: uuid("uploaded_by")
    .notNull()
    .references(() => users.id),
  path: text().notNull().unique(),
  source: text({ enum: ["camera", "gallery"] }).notNull(),
  rescheduleCount: integer("reschedule_count").notNull().default(0),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
});
export const rescheduleRequests = pgTable("reschedule_requests", {
  id: uuid().primaryKey().defaultRandom(),
  rentalId: uuid("rental_id")
    .notNull()
    .references(() => rentals.id),
  proposedBy: uuid("proposed_by")
    .notNull()
    .references(() => users.id),
  newStartAt: timestamp("new_start_at", { withTimezone: true }).notNull(),
  status: text({ enum: ["menunggu", "disetujui", "ditolak", "kedaluwarsa"] })
    .notNull()
    .default("menunggu"),
  respondedAt: timestamp("responded_at", { withTimezone: true }),
  createdAt: created(),
});
export const noShowReports = pgTable("no_show_reports", {
  id: uuid().primaryKey().defaultRandom(),
  rentalId: uuid("rental_id")
    .notNull()
    .references(() => rentals.id),
  phase: text({ enum: ["start", "end"] }).notNull(),
  reportedBy: uuid("reported_by")
    .notNull()
    .references(() => users.id),
  reportedParty: uuid("reported_party")
    .notNull()
    .references(() => users.id),
  status: text({ enum: ["menunggu", "diterima", "dibantah", "gugur"] })
    .notNull()
    .default("menunggu"),
  respondBy: timestamp("respond_by", { withTimezone: true }).notNull(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  createdAt: created(),
});
export const disputes = pgTable("disputes", {
  id: uuid().primaryKey().defaultRandom(),
  rentalId: uuid("rental_id")
    .notNull()
    .references(() => rentals.id),
  openedBy: uuid("opened_by").references(() => users.id),
  category: text({ enum: DISPUTE_CATEGORIES }).notNull(),
  description: text().notNull(),
  openedFromStatus: rentalStatus("opened_from_status").notNull(),
  status: text({ enum: ["dibuka", "diputuskan"] })
    .notNull()
    .default("dibuka"),
  respondBy: timestamp("respond_by", { withTimezone: true }).notNull(),
  decideBy: timestamp("decide_by", { withTimezone: true }).notNull(),
  outcome: text({ enum: ["lanjutkan", "batal", "bagi_dana"] }),
  ownerAmount: bigint("owner_amount", { mode: "number" }),
  renterAmount: bigint("renter_amount", { mode: "number" }),
  commissionAmount: bigint("commission_amount", { mode: "number" }),
  newStartAt: timestamp("new_start_at", { withTimezone: true }),
  decisionNote: text("decision_note"),
  decidedBy: uuid("decided_by").references(() => users.id),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  createdAt: created(),
});
export const disputeEvidence = pgTable("dispute_evidence", {
  id: uuid().primaryKey().defaultRandom(),
  disputeId: uuid("dispute_id")
    .notNull()
    .references(() => disputes.id),
  uploadedBy: uuid("uploaded_by")
    .notNull()
    .references(() => users.id),
  path: text().notNull().unique(),
  note: text(),
  createdAt: created(),
});
export const strikes = pgTable(
  "strikes",
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    reason: text({
      enum: ["batal_setelah_dibayar", "tidak_hadir", "terlambat", "sengketa", "laporan"],
    }).notNull(),
    rentalId: uuid("rental_id").references(() => rentals.id),
    givenBy: uuid("given_by").references(() => users.id),
    reportId: uuid("report_id")
      .unique()
      .references(() => reports.id),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: created(),
  },
  (t) => [uniqueIndex("strikes_user_id_rental_id_reason_key").on(t.userId, t.rentalId, t.reason)],
);
// One row per reminder or SLA alert, so jobs can run every minute without repeating messages.
export const sentAlerts = pgTable(
  "sent_alerts",
  {
    kind: text().notNull(),
    targetId: uuid("target_id").notNull(),
    createdAt: created(),
  },
  (t) => [primaryKey({ columns: [t.kind, t.targetId] })],
);
export const notificationDeliveries = pgTable("notification_deliveries", {
  id: uuid().primaryKey().defaultRandom(),
  notificationId: uuid("notification_id")
    .notNull()
    .references(() => notifications.id),
  channel: text().notNull().default("telegram"),
  chatId: bigint("chat_id", { mode: "number" }),
  status: text().notNull().default("antre"),
  attempts: integer().notNull().default(0),
  lastError: text("last_error"),
  nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
  claimedUntil: timestamp("claimed_until", { withTimezone: true }),
  dispatchRequestId: bigint("dispatch_request_id", { mode: "number" }),
  telegramMessageId: bigint("telegram_message_id", { mode: "number" }),
  createdAt: created(),
});
export const deliveryThrottles = pgTable("delivery_throttles", {
  key: text().primaryKey(),
  nextAt: timestamp("next_at", { withTimezone: true }).notNull(),
});

export const disputeResponses = pgTable(
  "dispute_responses",
  {
    id: uuid().primaryKey().defaultRandom(),
    disputeId: uuid("dispute_id")
      .notNull()
      .references(() => disputes.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    body: text().notNull(),
    createdAt: created(),
  },
  (t) => [uniqueIndex("one_dispute_response").on(t.disputeId, t.userId)],
);
export const reviews = pgTable(
  "reviews",
  {
    id: uuid().primaryKey().defaultRandom(),
    rentalId: uuid("rental_id")
      .notNull()
      .references(() => rentals.id),
    reviewerId: uuid("reviewer_id")
      .notNull()
      .references(() => users.id),
    revieweeId: uuid("reviewee_id")
      .notNull()
      .references(() => users.id),
    score: integer().notNull(),
    tags: text().array().notNull().default([]),
    comment: text().notNull().default(""),
    visibleAt: timestamp("visible_at", { withTimezone: true }),
    hiddenAt: timestamp("hidden_at", { withTimezone: true }),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [uniqueIndex("one_rental_review").on(t.rentalId, t.reviewerId)],
);
export const reconciliations = pgTable(
  "reconciliations",
  {
    id: uuid().primaryKey().defaultRandom(),
    date: text().notNull(),
    platformAccountId: uuid("platform_account_id")
      .notNull()
      .references(() => platformAccounts.id),
    actualBalance: bigint("actual_balance", { mode: "number" }).notNull(),
    ledgerBalance: bigint("ledger_balance", { mode: "number" }).notNull(),
    note: text().notNull().default(""),
    enteredBy: uuid("entered_by")
      .notNull()
      .references(() => users.id),
    createdAt: created(),
  },
  (t) => [uniqueIndex("one_daily_reconciliation").on(t.date, t.platformAccountId)],
);
