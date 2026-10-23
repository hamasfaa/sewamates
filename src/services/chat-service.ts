import { and, asc, desc, eq, gt, or, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database, Executor } from "@/src/db";
import {
  adminAuditLogs,
  conversations,
  disputes,
  items,
  messages,
  rentals,
  reports,
  userBlocks,
  users,
  type User,
} from "@/src/db/schema";
import { mutation } from "@/src/db/mutation";
import { assert } from "@/src/lib/errors";
import { chatInput } from "@/src/lib/transaction-validation";
import { claimUploads, evidencePreview, inspectEvidence } from "@/src/lib/storage";
import { redactChat } from "@/src/domain/chat";
import { requireActive, requireVerified } from "./profile-service";
import { coverThumb, itemDetail } from "./item-service";
import { publicItemUrl } from "@/src/lib/storage";
import { notify } from "./notification-service";
import { requireAdmin } from "./admin-service";

export async function assertNotBlocked(db: Executor, first: string, second: string) {
  const [blocked] = await db
    .select()
    .from(userBlocks)
    .where(
      or(
        and(eq(userBlocks.blockerId, first), eq(userBlocks.blockedId, second)),
        and(eq(userBlocks.blockerId, second), eq(userBlocks.blockedId, first)),
      ),
    )
    .limit(1);
  assert(
    !blocked,
    "USER_BLOCKED",
    "Percakapan atau pengajuan baru tidak tersedia karena salah satu pihak memblokir akun.",
    403,
  );
}
export async function ensureConversation(
  tx: Executor,
  itemId: string,
  ownerId: string,
  renterId: string,
) {
  await tx
    .insert(conversations)
    .values({ itemId, ownerId, renterId })
    .onConflictDoNothing({ target: [conversations.itemId, conversations.renterId] });
  const [row] = await tx
    .select()
    .from(conversations)
    .where(and(eq(conversations.itemId, itemId), eq(conversations.renterId, renterId)));
  return row;
}
export async function openConversation(db: Database, actor: User, itemId: string, key?: string) {
  requireActive(actor);
  requireVerified(actor);
  return mutation(db, actor.id, "chat:open", key, { itemId }, async (tx) => {
    const detail = await itemDetail(tx, itemId, actor);
    assert(detail?.publiclyVisible, "NOT_FOUND", "Barang tidak tersedia.", 404);
    assert(
      detail.owner.id !== actor.id,
      "SELF_CHAT",
      "Kamu tidak bisa mengirim chat ke diri sendiri.",
      422,
    );
    await assertNotBlocked(tx, actor.id, detail.owner.id);
    return { id: (await ensureConversation(tx, itemId, detail.owner.id, actor.id)).id };
  });
}
export async function partyConversation(db: Executor, actor: User, id: string) {
  const [row] = await db.select().from(conversations).where(eq(conversations.id, id));
  assert(
    row && [row.ownerId, row.renterId].includes(actor.id),
    "NOT_FOUND",
    "Percakapan tidak ditemukan.",
    404,
  );
  return row;
}
export async function systemMessage(
  tx: Executor,
  conversationId: string,
  rentalId: string,
  body: string,
) {
  await tx.insert(messages).values({ conversationId, rentalId, type: "system", body });
  await tx
    .update(conversations)
    .set({ lastMessageAt: new Date() })
    .where(eq(conversations.id, conversationId));
}
export async function conversationList(db: Executor, actor: User) {
  const rows = await db
    .select({
      conversation: conversations,
      itemTitle: items.title,
      thumbnail: coverThumb,
      unread: sql<number>`(SELECT count(*)::int FROM messages m WHERE m.conversation_id="conversations"."id" AND m.sender_id IS DISTINCT FROM ${actor.id}::uuid AND m.created_at>coalesce(CASE WHEN "conversations".renter_id=${actor.id}::uuid THEN "conversations".renter_last_read_at ELSE "conversations".owner_last_read_at END,'epoch'::timestamptz))`,
      preview: sql<string>`coalesce((SELECT body FROM messages m WHERE m.conversation_id="conversations"."id" ORDER BY created_at DESC,id DESC LIMIT 1),'')`,
      previewType: sql<string>`(SELECT type FROM messages m WHERE m.conversation_id="conversations"."id" ORDER BY created_at DESC,id DESC LIMIT 1)`,
      partnerName: sql<string>`(SELECT name FROM users u WHERE u.id=CASE WHEN "conversations".renter_id=${actor.id}::uuid THEN "conversations".owner_id ELSE "conversations".renter_id END)`,
    })
    .from(conversations)
    .innerJoin(items, eq(items.id, conversations.itemId))
    .where(or(eq(conversations.renterId, actor.id), eq(conversations.ownerId, actor.id)))
    .orderBy(desc(conversations.lastMessageAt), desc(conversations.id))
    .limit(100);
  return rows.map(({ conversation, ...row }) => ({
    ...conversation,
    ...row,
    thumbnail: publicItemUrl(row.thumbnail),
    preview:
      row.previewType === "system"
        ? row.preview
        : row.previewType === "image"
          ? "Gambar"
          : redactChat(row.preview).text,
  }));
}
export async function presentMessages(rows: (typeof messages.$inferSelect)[], raw = false) {
  return Promise.all(
    rows.map(async (row) => ({
      id: row.id,
      senderId: row.senderId,
      rentalId: row.rentalId,
      type: row.type,
      createdAt: row.createdAt,
      ...(row.hiddenAt && !raw
        ? { text: "Pesan disembunyikan oleh admin", redacted: true }
        : row.type === "system"
          ? { text: row.body, redacted: false }
          : redactChat(row.body)),
      ...(raw ? { originalBody: row.body } : {}),
      imageUrl:
        row.imagePath && (!row.hiddenAt || raw) ? await evidencePreview(row.imagePath) : null,
    })),
  );
}
export async function conversationMessages(db: Executor, actor: User, id: string, cursor?: string) {
  const conversation = await partyConversation(db, actor, id);
  if (cursor) {
    z.uuid().parse(cursor);
    const [existing] = await db
      .select({ id: messages.id })
      .from(messages)
      .where(and(eq(messages.id, cursor), eq(messages.conversationId, id)));
    assert(
      existing,
      "INVALID_CURSOR",
      "Muat ulang percakapan untuk membaca pesan sebelumnya.",
      422,
    );
  }
  const rows = await db
    .select()
    .from(messages)
    .where(
      and(
        eq(messages.conversationId, id),
        cursor
          ? sql`(${messages.createdAt},${messages.id})<(SELECT created_at,id FROM messages WHERE id=${cursor}::uuid)`
          : undefined,
      ),
    )
    .orderBy(desc(messages.createdAt), desc(messages.id))
    .limit(51);
  const [item] = await db
    .select({ id: items.id, title: items.title })
    .from(items)
    .where(eq(items.id, conversation.itemId));
  const partnerId =
    actor.id === conversation.ownerId ? conversation.renterId : conversation.ownerId;
  const [partner] = await db
    .select({ id: users.id, name: users.name, verificationStatus: users.verificationStatus })
    .from(users)
    .where(eq(users.id, partnerId));
  const blocks = await db
    .select()
    .from(userBlocks)
    .where(
      or(
        and(eq(userBlocks.blockerId, actor.id), eq(userBlocks.blockedId, partnerId)),
        and(eq(userBlocks.blockerId, partnerId), eq(userBlocks.blockedId, actor.id)),
      ),
    )
    .limit(2);
  return {
    conversation,
    partner,
    item,
    blocked: blocks.length > 0,
    selfBlocked: blocks.some((block) => block.blockerId === actor.id),
    messages: await presentMessages(rows.slice(0, 50).reverse()),
    nextCursor: rows.length > 50 ? rows[49].id : null,
  };
}
export async function sendMessage(
  db: Database,
  actor: User,
  id: string,
  raw: unknown,
  key?: string,
) {
  const input = chatInput.parse(raw),
    conversation = await partyConversation(db, actor, id);
  await assertNotBlocked(
    db,
    actor.id,
    actor.id === conversation.ownerId ? conversation.renterId : conversation.ownerId,
  );
  if (input.imagePath) await inspectEvidence(actor.id, input.imagePath, "chat_image");
  return mutation(db, actor.id, `chat:send:${id}`, key, input, async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`chat:${actor.id}`}))`);
    await partyConversation(tx, actor, id);
    const other = actor.id === conversation.ownerId ? conversation.renterId : conversation.ownerId;
    await assertNotBlocked(tx, actor.id, other);
    const [{ count }] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(messages)
      .where(
        and(eq(messages.senderId, actor.id), gt(messages.createdAt, new Date(Date.now() - 60000))),
      );
    assert(count < 30, "RATE_LIMITED", "Maksimal 30 pesan per menit. Tunggu sebentar.", 429);
    if (input.imagePath) await claimUploads(tx, actor.id, "chat_image", [input.imagePath]);
    const [row] = await tx
      .insert(messages)
      .values({
        conversationId: id,
        senderId: actor.id,
        type: input.imagePath ? "image" : "text",
        body: input.body || "",
        imagePath: input.imagePath,
      })
      .returning();
    await tx
      .update(conversations)
      .set({ lastMessageAt: row.createdAt })
      .where(eq(conversations.id, id));
    await notify(
      tx,
      other,
      "chat_message",
      "Pesan baru",
      `${actor.name} mengirim ${input.imagePath ? "gambar" : "pesan"}.`,
      `/chat/${id}`,
    );
    return { id: row.id };
  });
}
export async function markConversationRead(
  db: Executor,
  actor: User,
  id: string,
  lastMessageId: string,
) {
  const conversation = await partyConversation(db, actor, id);
  const [last] = await db
    .select()
    .from(messages)
    .where(and(eq(messages.id, z.uuid().parse(lastMessageId)), eq(messages.conversationId, id)));
  assert(last, "NOT_FOUND", "Pesan tidak ditemukan.", 404);
  const field =
    actor.id === conversation.ownerId
      ? conversations.ownerLastReadAt
      : conversations.renterLastReadAt;
  const exactTime = sql`greatest(${field},(SELECT created_at FROM messages WHERE id=${last.id}::uuid))`;
  await db
    .update(conversations)
    .set(
      actor.id === conversation.ownerId
        ? { ownerLastReadAt: exactTime }
        : { renterLastReadAt: exactTime },
    )
    .where(eq(conversations.id, id));
  return { ok: true };
}
export async function blockUser(db: Database, actor: User, otherId: string, blocked: boolean) {
  assert(actor.id !== otherId, "SELF_BLOCK", "Kamu tidak bisa memblokir diri sendiri.", 422);
  return db.transaction(async (tx) => {
    const [other] = await tx.select({ id: users.id }).from(users).where(eq(users.id, otherId));
    assert(other, "NOT_FOUND", "Pengguna tidak ditemukan.", 404);
    if (blocked)
      await tx
        .insert(userBlocks)
        .values({ blockerId: actor.id, blockedId: otherId })
        .onConflictDoNothing();
    else
      await tx
        .delete(userBlocks)
        .where(and(eq(userBlocks.blockerId, actor.id), eq(userBlocks.blockedId, otherId)));
    return { blocked };
  });
}
export async function reportMessage(
  db: Database,
  actor: User,
  messageId: string,
  reason: string,
  key?: string,
) {
  const [message] = await db.select().from(messages).where(eq(messages.id, messageId));
  assert(message, "NOT_FOUND", "Pesan tidak ditemukan.", 404);
  await partyConversation(db, actor, message.conversationId);
  const input = { messageId, reason: z.string().trim().min(5).max(1000).parse(reason) };
  return mutation(db, actor.id, "chat:report", key, input, async (tx) => {
    const [report] = await tx
      .insert(reports)
      .values({
        reporterId: actor.id,
        targetType: "message",
        targetId: message.id,
        reason: input.reason,
      })
      .returning({ id: reports.id });
    return report;
  });
}
export async function adminConversation(db: Database, actor: User, id: string) {
  requireAdmin(actor);
  return db.transaction(async (tx) => {
    const linked = await tx
      .select({ id: reports.id })
      .from(reports)
      .innerJoin(messages, eq(messages.id, reports.targetId))
      .where(and(eq(reports.targetType, "message"), eq(messages.conversationId, id)))
      .limit(1);
    const disputed = linked.length
      ? []
      : await tx
          .select({ id: disputes.id })
          .from(disputes)
          .innerJoin(rentals, eq(rentals.id, disputes.rentalId))
          .where(eq(rentals.conversationId, id))
          .limit(1);
    assert(
      linked.length || disputed.length,
      "FORBIDDEN",
      "Admin hanya dapat membaca chat yang terkait laporan atau sengketa.",
      403,
    );
    await tx.insert(adminAuditLogs).values({
      adminId: actor.id,
      action: linked.length ? "reported_chat_viewed" : "dispute_chat_viewed",
      targetType: "conversations",
      targetId: id,
      meta: linked.length ? { reportId: linked[0].id } : { disputeId: disputed[0].id },
    });
    const rows = await tx
      .select()
      .from(messages)
      .where(eq(messages.conversationId, id))
      .orderBy(asc(messages.createdAt), asc(messages.id))
      .limit(200);
    return { messages: await presentMessages(rows, true) };
  });
}
