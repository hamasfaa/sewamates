import { and, desc, eq, gt, isNull } from "drizzle-orm";
import type { Database, Executor } from "@/src/db";
import {
  actionConfirmations,
  campuses,
  identityVerifications,
  notifications,
  payoutAccounts,
  sessions,
  users,
  type User,
} from "@/src/db/schema";
import { assert } from "@/src/lib/errors";
import { decrypt, encrypt, maskAccount } from "@/src/lib/crypto";
import { consumeUpload } from "@/src/lib/storage";
import { payoutInput, profileInput, TERMS_VERSION, verificationInput } from "@/src/lib/validation";
import { getSettings } from "./settings-service";
import { sendActionConfirmation } from "./telegram-api";
import { mutation } from "@/src/db/mutation";
import { campusFields } from "./campus-service";
import { notifyAdmins } from "./notification-service";

export function requireOnboarded(user: User) {
  assert(
    user.name && user.termsAcceptedAt && user.campusId,
    "PROFILE_INCOMPLETE",
    "Lengkapi profil dan setujui ketentuan terlebih dahulu.",
    409,
  );
}
export function requireActive(user: User) {
  assert(
    user.accountStatus === "aktif",
    "ACCOUNT_RESTRICTED",
    "Akun ini sedang dibatasi. Hubungi admin untuk bantuan.",
    403,
  );
}
export function requireVerified(user: User) {
  assert(
    user.verificationStatus === "terverifikasi",
    "VERIFICATION_REQUIRED",
    "Verifikasi identitasmu dulu untuk melanjutkan.",
    403,
  );
}
export async function myProfile(db: Executor, user: User) {
  const [campus] = user.campusId
    ? await db.select(campusFields).from(campuses).where(eq(campuses.id, user.campusId))
    : [];
  const [payout] = await db.select().from(payoutAccounts).where(eq(payoutAccounts.userId, user.id));
  const [verification] = await db
    .select({
      id: identityVerifications.id,
      status: identityVerifications.status,
      rejectReason: identityVerifications.rejectReason,
      createdAt: identityVerifications.createdAt,
    })
    .from(identityVerifications)
    .where(eq(identityVerifications.userId, user.id))
    .orderBy(desc(identityVerifications.createdAt))
    .limit(1);
  const [pending] = await db
    .select({
      id: actionConfirmations.id,
      status: actionConfirmations.status,
      expiresAt: actionConfirmations.expiresAt,
    })
    .from(actionConfirmations)
    .where(
      and(
        eq(actionConfirmations.userId, user.id),
        eq(actionConfirmations.action, "ubah_rekening"),
        eq(actionConfirmations.status, "menunggu"),
        gt(actionConfirmations.expiresAt, new Date()),
      ),
    )
    .limit(1);
  return {
    campus: campus || null,
    user: {
      id: user.id,
      name: user.name,
      phone: user.phone,
      avatarUrl: user.avatarUrl,
      role: user.role,
      campusId: user.campusId,
      accountStatus: user.accountStatus,
      suspensionReason: user.suspensionReason,
      verificationStatus: user.verificationStatus,
      termsAcceptedAt: user.termsAcceptedAt,
      telegramBlocked: Boolean(user.telegramBlockedAt),
    },
    payout: payout
      ? {
          type: payout.type,
          provider: payout.provider,
          accountName: payout.accountName,
          maskedNumber: maskAccount(decrypt(payout.accountNoEnc)),
        }
      : null,
    verification: verification || null,
    pendingConfirmation: pending || null,
  };
}
export async function updateProfile(db: Database, user: User, raw: unknown, key?: string) {
  const input = profileInput.parse(raw);
  return mutation(db, user.id, "profile", key, input, async (tx) => {
    const [fresh] = await tx.select().from(users).where(eq(users.id, user.id)).for("update");
    requireActive(fresh);
    assert(
      fresh.termsAcceptedAt || input.acceptTerms,
      "TERMS_REQUIRED",
      "Setujui syarat dan kebijakan privasi untuk melanjutkan.",
    );
    const [campus] = await tx.select().from(campuses).where(eq(campuses.id, input.campusId));
    assert(
      campus && (campus.isActive || campus.id === fresh.campusId),
      "INVALID_CAMPUS",
      "Pilih kampus yang tersedia.",
    );
    const renamed = input.name !== fresh.name;
    assert(
      !renamed || fresh.verificationStatus !== "menunggu",
      "VERIFICATION_PENDING",
      "Nama belum bisa diubah selama identitas sedang ditinjau.",
      409,
    );
    const avatarUrl = input.avatarPath
      ? await consumeUpload(tx, user.id, input.avatarPath, "avatar")
      : fresh.avatarUrl;
    const [saved] = await tx
      .update(users)
      .set({
        name: input.name,
        campusId: input.campusId,
        avatarUrl,
        termsAcceptedAt: fresh.termsAcceptedAt || new Date(),
        termsVersion: fresh.termsVersion || TERMS_VERSION,
        ...(renamed && fresh.verificationStatus === "terverifikasi"
          ? { verificationStatus: "belum" as const }
          : {}),
      })
      .where(eq(users.id, user.id))
      .returning();
    return myProfile(tx, saved);
  });
}
export async function submitVerification(db: Database, user: User, raw: unknown, key?: string) {
  const input = verificationInput.parse(raw);
  return mutation(db, user.id, "verification", key, input, async (tx) => {
    const [fresh] = await tx.select().from(users).where(eq(users.id, user.id)).for("update");
    requireActive(fresh);
    requireOnboarded(fresh);
    assert(
      ["belum", "ditolak"].includes(fresh.verificationStatus),
      "VERIFICATION_EXISTS",
      "Identitas sudah dikirim atau sudah terverifikasi.",
      409,
    );
    await consumeUpload(tx, user.id, input.cardPhotoPath, "identity_card");
    await consumeUpload(tx, user.id, input.selfiePath, "identity_selfie");
    const [entry] = await tx
      .insert(identityVerifications)
      .values({ userId: user.id, ...input })
      .returning({ id: identityVerifications.id });
    await tx.update(users).set({ verificationStatus: "menunggu" }).where(eq(users.id, user.id));
    await notifyAdmins(
      tx,
      "Identitas perlu ditinjau",
      `${fresh.name} mengajukan verifikasi identitas.`,
      "/admin/verifikasi",
    );
    await tx.insert(notifications).values({
      userId: user.id,
      type: "verification_submitted",
      title: "Identitasmu sedang ditinjau",
      body: "Admin akan memeriksa kartu dan selfie kamu, dengan target 24 jam.",
      link: "/profil/verifikasi",
    });
    return entry;
  });
}
export async function requestPayoutChange(db: Database, user: User, raw: unknown, key?: string) {
  const input = payoutInput.parse(raw);
  return mutation(db, user.id, "payout-account", key, input, async (tx) => {
    const [fresh] = await tx.select().from(users).where(eq(users.id, user.id)).for("update");
    requireActive(fresh);
    requireOnboarded(fresh);
    assert(
      fresh.telegramUserId && fresh.telegramChatId && !fresh.telegramBlockedAt,
      "TELEGRAM_UNAVAILABLE",
      "Buka bot Telegram dan tekan Start sebelum mengubah rekening.",
      409,
    );
    const rules = await getSettings(tx);
    await tx
      .update(actionConfirmations)
      .set({ status: "kedaluwarsa" })
      .where(
        and(
          eq(actionConfirmations.userId, user.id),
          eq(actionConfirmations.action, "ubah_rekening"),
          eq(actionConfirmations.status, "menunggu"),
        ),
      );
    const [confirmation] = await tx
      .insert(actionConfirmations)
      .values({
        userId: user.id,
        action: "ubah_rekening",
        payload: {
          type: input.type,
          provider: input.provider,
          accountNoEnc: encrypt(input.accountNo),
          accountName: input.accountName,
        },
        expiresAt: new Date(Date.now() + rules.action_ttl_minutes * 60000),
      })
      .returning();
    await sendActionConfirmation(
      fresh.telegramChatId!,
      confirmation.id,
      `${input.provider} · ${maskAccount(input.accountNo)}\nAtas nama ${input.accountName}`,
      rules.action_ttl_minutes,
    );
    return { id: confirmation.id, status: confirmation.status, expiresAt: confirmation.expiresAt };
  });
}
export async function activeSessions(db: Executor, userId: string, currentId: string) {
  const rows = await db
    .select({
      id: sessions.id,
      userAgent: sessions.userAgent,
      lastSeenAt: sessions.lastSeenAt,
      expiresAt: sessions.expiresAt,
      createdAt: sessions.createdAt,
    })
    .from(sessions)
    .where(
      and(
        eq(sessions.userId, userId),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, new Date()),
      ),
    )
    .orderBy(desc(sessions.lastSeenAt));
  return rows.map((row) => ({ ...row, current: row.id === currentId }));
}
