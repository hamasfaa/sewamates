import "server-only";
import { createClient } from "@supabase/supabase-js";
import { and, eq, gt, gte, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { uploadTickets } from "@/src/db/schema";
import type { Database, Executor } from "@/src/db";
import { assert } from "./errors";
import { uploadInput } from "./validation";
import type { z } from "zod";

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
    assert(count < 30, "RATE_LIMITED", "Batas unggah tercapai. Coba lagi dalam satu jam.", 429);
    const extension = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" }[
      input.contentType
    ];
    const path = `${userId}/${input.purpose}/${randomUUID()}.${extension}`;
    const bucket = input.purpose === "avatar" ? "avatars-public" : "identity-private";
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
    return { path, signedUrl: data.signedUrl };
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
export async function identityPreview(path: string) {
  const { data, error } = await storage().from("identity-private").createSignedUrl(path, 300);
  if (error || !data) throw new Error("Gagal membaca bukti identitas.");
  return data.signedUrl;
}
