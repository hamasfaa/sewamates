import { and, eq, inArray, ne, or, sql } from "drizzle-orm";
import { InlineKeyboard } from "grammy";
import type { Database, Executor } from "@/src/db";
import {
  actionConfirmations,
  disputes,
  idempotencyKeys,
  identityVerifications,
  items,
  loginRequests,
  payoutAccounts,
  payoutTasks,
  payments,
  rentals,
  sessions,
  uploadTickets,
  users,
  type User,
} from "@/src/db/schema";
import { mutation } from "@/src/db/mutation";
import { FINAL_STATUSES } from "@/src/domain/rental-state-machine";
import { assert } from "@/src/lib/errors";
import { storage } from "@/src/lib/storage";
import { telegramApi } from "./telegram-api";
import { getSettings } from "./settings-service";
import { lockAccountActivity } from "./account-activity";

export async function assertDeletable(tx: Executor, id: string) {
  await lockAccountActivity(tx, [id]);
  const [person] = await tx.select().from(users).where(eq(users.id, id)).for("update");
  assert(
    person && person.accountStatus !== "dihapus",
    "ACCOUNT_UNAVAILABLE",
    "Akun tidak tersedia.",
    409,
  );
  const [active] = await tx
    .select({ id: rentals.id })
    .from(rentals)
    .where(
      and(
        or(eq(rentals.ownerId, id), eq(rentals.renterId, id)),
        sql`${rentals.status} NOT IN (${sql.join(
          FINAL_STATUSES.map((s) => sql`${s}`),
          sql`,`,
        )})`,
      ),
    )
    .limit(1);
  const [payout] = await tx
    .select({ id: payoutTasks.id })
    .from(payoutTasks)
    .innerJoin(rentals, eq(rentals.id, payoutTasks.rentalId))
    .where(
      and(or(eq(rentals.ownerId, id), eq(rentals.renterId, id)), ne(payoutTasks.status, "selesai")),
    )
    .limit(1);
  const [dispute] = await tx
    .select({ id: disputes.id })
    .from(disputes)
    .innerJoin(rentals, eq(rentals.id, disputes.rentalId))
    .where(
      and(or(eq(rentals.ownerId, id), eq(rentals.renterId, id)), eq(disputes.status, "dibuka")),
    )
    .limit(1);
  const [pendingPayment] = await tx
    .select({ id: payments.id })
    .from(payments)
    .innerJoin(rentals, eq(rentals.id, payments.rentalId))
    .where(
      and(or(eq(rentals.ownerId, id), eq(rentals.renterId, id)), eq(payments.status, "menunggu")),
    )
    .limit(1);
  assert(
    !active && !payout && !dispute && !pendingPayment,
    "ACCOUNT_HAS_OBLIGATIONS",
    "Selesaikan transaksi, pemeriksaan pembayaran, sengketa, dan pencairan tertunda sebelum menghapus akun.",
    409,
  );
  if (person.role === "super_admin") {
    const [other] = await tx
      .select({ id: users.id })
      .from(users)
      .where(and(ne(users.id, id), eq(users.role, "super_admin"), eq(users.accountStatus, "aktif")))
      .limit(1);
    assert(other, "LAST_SUPER_ADMIN", "Tunjuk super admin lain sebelum menghapus akun ini.", 409);
  }
  return person;
}
export async function requestAccountDeletion(db: Database, actor: User, key?: string) {
  return mutation(db, actor.id, "delete-account", key, {}, async (tx) => {
    const person = await assertDeletable(tx, actor.id),
      rules = await getSettings(tx);
    assert(
      person.telegramChatId && !person.telegramBlockedAt,
      "TELEGRAM_UNAVAILABLE",
      "Buka bot dan tekan Start untuk mengonfirmasi hapus akun.",
      409,
    );
    await tx
      .update(actionConfirmations)
      .set({ status: "kedaluwarsa" })
      .where(
        and(
          eq(actionConfirmations.userId, actor.id),
          eq(actionConfirmations.action, "hapus_akun"),
          eq(actionConfirmations.status, "menunggu"),
        ),
      );
    const [entry] = await tx
      .insert(actionConfirmations)
      .values({
        userId: actor.id,
        action: "hapus_akun",
        payload: {},
        expiresAt: new Date(Date.now() + rules.action_ttl_minutes * 60000),
      })
      .returning();
    await telegramApi().sendMessage(
      person.telegramChatId!,
      `Konfirmasi hapus akun SewaMates\n\nData pribadimu akan dianonimkan, semua sesi dicabut, dan foto identitas dihapus setelah 30 hari. Riwayat transaksi dan bukti tetap disimpan untuk audit. Berlaku ${rules.action_ttl_minutes} menit.`,
      {
        reply_markup: new InlineKeyboard()
          .text("Hapus akun saya", `confirm:${entry.id}:yes`)
          .text("Batalkan", `confirm:${entry.id}:no`),
      },
    );
    return { id: entry.id, expiresAt: entry.expiresAt, status: entry.status };
  });
}
// Called under the Telegram sender lock; re-check obligations at confirmation, not only request.
export async function anonymizeAccount(tx: Executor, id: string) {
  await assertDeletable(tx, id);
  const now = new Date();
  await tx
    .update(users)
    .set({
      phone: `deleted:${id}`,
      name: "Pengguna dihapus",
      avatarUrl: null,
      campusId: null,
      role: "user",
      accountStatus: "dihapus",
      verificationStatus: "belum",
      telegramUserId: null,
      telegramChatId: null,
      telegramLinkedAt: null,
      telegramBlockedAt: null,
      deletedAt: now,
      termsAcceptedAt: null,
      termsVersion: null,
      suspensionReason: null,
    })
    .where(eq(users.id, id));
  await tx
    .update(items)
    .set({ status: "diarsipkan", version: sql`${items.version}+1` })
    .where(eq(items.ownerId, id));
  await tx.delete(payoutAccounts).where(eq(payoutAccounts.userId, id));
  await tx.delete(idempotencyKeys).where(eq(idempotencyKeys.userId, id));
  await tx
    .update(sessions)
    .set({ revokedAt: now, ip: null, userAgent: null })
    .where(eq(sessions.userId, id));
  await tx
    .update(loginRequests)
    .set({ status: "kedaluwarsa", telegramUserId: null })
    .where(eq(loginRequests.userId, id));
  await tx
    .update(actionConfirmations)
    .set({ status: "kedaluwarsa", payload: {} })
    .where(and(eq(actionConfirmations.userId, id), eq(actionConfirmations.status, "menunggu")));
  await tx
    .update(actionConfirmations)
    .set({ payload: {} })
    .where(eq(actionConfirmations.userId, id));
}
// Storage removal is idempotent. A failed request leaves DB paths intact for the next run.
export async function purgeIdentity(db: Database) {
  const deleted = await db
    .select({ id: users.id, deletedAt: users.deletedAt })
    .from(users)
    .where(
      and(
        eq(users.accountStatus, "dihapus"),
        sql`EXISTS(SELECT 1 FROM upload_tickets t WHERE t.user_id=${users.id} AND (t.purpose='avatar' OR (${users.deletedAt}+interval '30 days'<=now() AND t.purpose IN ('identity_card','identity_selfie')))) OR (${users.deletedAt}+interval '30 days'<=now() AND EXISTS(SELECT 1 FROM identity_verifications v WHERE v.user_id=${users.id} AND v.purged_at IS NULL))`,
      ),
    )
    .limit(100);
  let purged = 0,
    failed = 0;
  for (const person of deleted) {
    const expired = person.deletedAt && person.deletedAt.getTime() + 30 * 86400000 <= Date.now();
    const tickets = await db
      .select()
      .from(uploadTickets)
      .where(
        and(
          eq(uploadTickets.userId, person.id),
          inArray(
            uploadTickets.purpose,
            expired ? ["avatar", "identity_card", "identity_selfie"] : ["avatar"],
          ),
        ),
      );
    const identities = expired
      ? await db
          .select()
          .from(identityVerifications)
          .where(
            and(
              eq(identityVerifications.userId, person.id),
              sql`${identityVerifications.purgedAt} IS NULL`,
            ),
          )
      : [];
    const paths = [
      ...new Set(
        [
          ...tickets.filter((t) => t.purpose !== "avatar").map((t) => t.path),
          ...identities.flatMap((t) => [t.cardPhotoPath, t.selfiePath]),
        ].filter(Boolean),
      ),
    ];
    const avatars = tickets.filter((t) => t.purpose === "avatar").map((t) => t.path);
    try {
      for (const [bucket, files] of [
        ["identity-private", paths],
        ["avatars-public", avatars],
      ] as const)
        if (files.length) {
          const { error } = await storage()
            .from(bucket)
            .remove([...files]);
          if (error) throw new Error("STORAGE_DELETE_FAILED");
        }
      await db.transaction(async (tx) => {
        if (identities.length)
          await tx
            .update(identityVerifications)
            .set({
              cardPhotoPath: "",
              selfiePath: "",
              purgedAt: new Date(),
              rejectReason: sql`CASE WHEN status='ditolak' THEN 'Foto identitas dihapus setelah masa retensi.' ELSE NULL END`,
            })
            .where(
              inArray(
                identityVerifications.id,
                identities.map((r) => r.id),
              ),
            );
        if (tickets.length)
          await tx.delete(uploadTickets).where(
            inArray(
              uploadTickets.id,
              tickets.map((r) => r.id),
            ),
          );
      });
      purged += identities.length;
    } catch {
      failed++;
      /* Retry on the next scheduled run; no secret or signed URL in logs. */
    }
  }
  return { purged, failed };
}
