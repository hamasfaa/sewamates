import "server-only";
import { createClient } from "@supabase/supabase-js";
import { and, eq, gt, gte, inArray, sql } from "drizzle-orm";
import { createHash, randomUUID } from "node:crypto";
import { uploadTickets, type User } from "@/src/db/schema";
import type { Database, Executor } from "@/src/db";
import { assert } from "./errors";
import { uploadInput } from "./validation";
import type { z } from "zod";

type UploadPurpose = z.infer<typeof uploadInput>["purpose"];
const buckets: Record<UploadPurpose, string> = {
  identity_card: "identity-private",
  identity_selfie: "identity-private",
  avatar: "avatars-public",
  item_photo: "items-public",
  payment_proof: "evidence-private",
  chat_image: "evidence-private",
};
const MAX_BYTES = 5 * 1024 * 1024;
// Public listing photos may only come from verified accounts (A-3.1).
export function canUpload(user: User, purpose: UploadPurpose) {
  assert(
    user.accountStatus === "aktif" ||
      (user.accountStatus === "ditangguhkan" && ["payment_proof", "chat_image"].includes(purpose)),
    "ACCOUNT_RESTRICTED",
    "Akun sedang dibatasi.",
    403,
  );
  assert(
    purpose !== "item_photo" || user.verificationStatus === "terverifikasi",
    "VERIFICATION_REQUIRED",
    "Verifikasi identitasmu dulu sebelum mengunggah foto barang.",
    403,
  );
}

export function storage() {
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  assert(
    url && key,
    "STORAGE_NOT_CONFIGURED",
    "Layanan penyimpanan foto belum diaktifkan. Hubungi pengelola SewaMates.",
    503,
  );
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  }).storage;
}
export async function signUpload(db: Database, userId: string, input: z.infer<typeof uploadInput>) {
  const client = storage();
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`upload:${userId}`}))`);
    const [{ count }] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(uploadTickets)
      .where(
        and(
          eq(uploadTickets.userId, userId),
          gte(uploadTickets.createdAt, new Date(Date.now() - 3600000)),
        ),
      );
    // A listing needs up to 16 files (photo + thumbnail), so allow a couple of listings per hour.
    assert(count < 60, "RATE_LIMITED", "Batas unggah tercapai. Coba lagi dalam satu jam.", 429);
    const extension = {
      "image/jpeg": "jpg",
      "image/png": "png",
      "image/webp": "webp",
      "application/pdf": "pdf",
    }[input.contentType];
    const path = `${userId}/${input.purpose}/${randomUUID()}.${extension}`;
    const bucket = buckets[input.purpose];
    const { data, error } = await client
      .from(bucket)
      .createSignedUploadUrl(path, { upsert: false });
    if (error || !data) throw new Error("Gagal menerbitkan URL unggah.");
    await tx.insert(uploadTickets).values({
      userId,
      path,
      purpose: input.purpose,
      contentType: input.contentType,
      expiresAt: new Date(Date.now() + 2 * 3600000),
    });
    return {
      path,
      signedUrl: data.signedUrl,
      ...(input.purpose === "item_photo" ? { publicUrl: publicItemUrl(path) } : {}),
    };
  });
}
export function isImage(bytes: Uint8Array) {
  return (
    (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) ||
    (bytes[0] === 0x89 && Buffer.from(bytes.slice(1, 8)).toString("hex") === "504e470d0a1a0a") ||
    (Buffer.from(bytes.slice(0, 4)).toString() === "RIFF" &&
      Buffer.from(bytes.slice(8, 12)).toString() === "WEBP")
  );
}
export async function consumeUpload(
  db: Executor,
  userId: string,
  path: string,
  purpose: "identity_card" | "identity_selfie" | "avatar",
) {
  const [ticket] = await db
    .select()
    .from(uploadTickets)
    .where(
      and(
        eq(uploadTickets.userId, userId),
        eq(uploadTickets.path, path),
        eq(uploadTickets.purpose, purpose),
        eq(uploadTickets.used, false),
        gt(uploadTickets.expiresAt, new Date()),
      ),
    )
    .for("update");
  assert(
    ticket && path.startsWith(`${userId}/${purpose}/`),
    "INVALID_UPLOAD",
    "Unggahan tidak valid atau sudah dipakai. Unggah foto sekali lagi.",
  );
  const bucket = purpose === "avatar" ? "avatars-public" : "identity-private";
  const { data, error } = await storage().from(bucket).download(path);
  assert(
    !error && data && data.size > 0 && data.size <= 5 * 1024 * 1024,
    "UPLOAD_MISSING",
    "Foto belum terunggah atau ukurannya melebihi 5 MB.",
  );
  assert(
    isImage(new Uint8Array(await data.slice(0, 12).arrayBuffer())),
    "INVALID_IMAGE",
    "File harus berupa foto JPEG, PNG, atau WebP.",
  );
  await db.update(uploadTickets).set({ used: true }).where(eq(uploadTickets.id, ticket.id));
  if (purpose === "avatar") return storage().from(bucket).getPublicUrl(path).data.publicUrl;
  return path;
}
// Canvas re-encoding drops EXIF/XMP; reject uploads that bypassed it (04 §6.2).
export function hasEmbeddedMetadata(bytes: Uint8Array) {
  const view = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view[0] === 0xff && view[1] === 0xd8) {
    for (let i = 2; i + 4 <= view.length && view[i] === 0xff;) {
      const marker = view[i + 1];
      if (marker === 0xda || marker === 0xd9) return false;
      if (marker === 0xe1) return true; // APP1 carries Exif or XMP.
      i += 2 + view.readUInt16BE(i + 2);
    }
    return false;
  }
  if (view.subarray(0, 4).toString("latin1") === "RIFF") {
    for (let i = 12; i + 8 <= view.length;) {
      const type = view.subarray(i, i + 4).toString("latin1"),
        size = view.readUInt32LE(i + 4);
      if (type === "EXIF" || type === "XMP ") return true;
      i += 8 + size + (size % 2);
    }
    return false;
  }
  for (let i = 8; i + 8 <= view.length;) {
    const type = view.subarray(i + 4, i + 8).toString("latin1");
    if (["eXIf", "iTXt", "tEXt", "zTXt"].includes(type)) return true;
    if (type === "IEND") return false;
    i += 12 + view.readUInt32BE(i);
  }
  return false;
}
const ITEM_PHOTO = /^[0-9a-f-]{36}\/item_photo\/[0-9a-f-]{36}\.(jpg|png|webp)$/;
export function assertItemPhotoPaths(userId: string, paths: string[]) {
  assert(
    paths.every((path) => ITEM_PHOTO.test(path) && path.startsWith(`${userId}/item_photo/`)),
    "INVALID_UPLOAD",
    "Foto tidak valid. Unggah ulang fotonya.",
    422,
  );
}
// Runs before the database transaction so slow downloads do not hold row locks.
export async function verifyItemPhotos(paths: string[]) {
  if (!paths.length) return;
  const bucket = storage().from(buckets.item_photo);
  await Promise.all(
    paths.map(async (path) => {
      const { data, error } = await bucket.download(path);
      assert(
        !error && data && data.size > 0 && data.size <= MAX_BYTES,
        "UPLOAD_MISSING",
        "Sebagian foto belum terunggah atau melebihi 5 MB. Unggah ulang foto tersebut.",
        422,
      );
      const bytes = new Uint8Array(await data.arrayBuffer());
      assert(isImage(bytes), "INVALID_IMAGE", "File harus berupa foto JPEG, PNG, atau WebP.", 422);
      assert(
        !hasEmbeddedMetadata(bytes),
        "PHOTO_METADATA",
        "Foto masih membawa metadata seperti lokasi. Unggah ulang lewat SewaMates.",
        422,
      );
    }),
  );
}
// Marks every ticket as used in one statement; a missing or reused ticket aborts the transaction.
export async function claimUploads(
  db: Executor,
  userId: string,
  purpose: UploadPurpose,
  paths: string[],
) {
  if (!paths.length) return;
  const claimed = await db
    .update(uploadTickets)
    .set({ used: true })
    .where(
      and(
        eq(uploadTickets.userId, userId),
        eq(uploadTickets.purpose, purpose),
        inArray(uploadTickets.path, paths),
        eq(uploadTickets.used, false),
        gt(uploadTickets.expiresAt, new Date()),
      ),
    )
    .returning({ path: uploadTickets.path });
  assert(
    claimed.length === paths.length,
    "INVALID_UPLOAD",
    "Sebagian foto sudah kedaluwarsa atau dipakai. Unggah ulang fotonya.",
    422,
  );
}
export function publicItemUrl(path: string | null) {
  const base = process.env.SUPABASE_URL?.trim();
  if (!path || !base) return null;
  return new URL(`/storage/v1/object/public/${buckets.item_photo}/${path}`, base).toString();
}
export async function identityPreview(path: string) {
  const { data, error } = await storage().from("identity-private").createSignedUrl(path, 300);
  if (error || !data) throw new Error("Gagal membaca bukti identitas.");
  return data.signedUrl;
}

export async function inspectEvidence(
  userId: string,
  path: string,
  purpose: "payment_proof" | "chat_image",
) {
  assert(
    path.startsWith(`${userId}/${purpose}/`) &&
      /^[0-9a-f-]{36}\/(payment_proof|chat_image)\/[0-9a-f-]{36}\.(jpg|png|webp|pdf)$/.test(path),
    "INVALID_UPLOAD",
    "Unggahan ini bukan milikmu atau tujuannya tidak sesuai.",
    422,
  );
  const { data, error } = await storage().from("evidence-private").download(path);
  assert(
    !error && data && data.size > 0 && data.size <= MAX_BYTES,
    "UPLOAD_MISSING",
    "File belum terunggah atau melebihi 5 MB.",
    422,
  );
  const bytes = new Uint8Array(await data.arrayBuffer());
  const pdf = Buffer.from(bytes.slice(0, 5)).toString() === "%PDF-";
  assert(
    isImage(bytes) || (purpose === "payment_proof" && pdf),
    "INVALID_FILE",
    purpose === "payment_proof"
      ? "Pilih foto JPEG/PNG/WebP atau PDF yang valid."
      : "Pilih foto JPEG, PNG, atau WebP yang valid.",
    422,
  );
  assert(!path.endsWith(".pdf") || pdf, "INVALID_FILE", "File PDF tidak valid.", 422);
  return createHash("sha256").update(bytes).digest("hex");
}
// Stable URLs prevent image downloads on every chat poll; callers authorize first.
const previews = new Map<string, { url: string; until: number }>();
export async function evidencePreview(path: string) {
  const key = `${process.env.SUPABASE_URL}:${path}`,
    cached = previews.get(key);
  if (cached && cached.until > Date.now()) return cached.url;
  const { data, error } = await storage().from("evidence-private").createSignedUrl(path, 300);
  assert(
    !error && data,
    "PREVIEW_UNAVAILABLE",
    "Bukti belum bisa ditampilkan. Coba muat ulang.",
    503,
  );
  if (previews.size >= 500) previews.delete(previews.keys().next().value!);
  previews.set(key, { url: data.signedUrl, until: Date.now() + 240000 });
  return data.signedUrl;
}
