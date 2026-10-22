import { InlineKeyboard, Keyboard } from "grammy";
import type { Update, Message, CallbackQuery } from "grammy/types";
import { and, desc, eq, gt, ne, or, sql } from "drizzle-orm";
import type { Database, Executor } from "@/src/db";
import {
  actionConfirmations,
  loginRequests,
  notifications,
  payoutAccounts,
  sessions,
  telegramUpdates,
  users,
} from "@/src/db/schema";
import { hash, matchOptions, decrypt, maskAccount } from "@/src/lib/crypto";
import { normalizePhone, payoutInput } from "@/src/lib/validation";
import { appUrl } from "@/src/lib/env";
import { telegramApi } from "./telegram-api";
import { rentals } from "@/src/db/schema";
import { RENTAL_LABELS } from "@/src/domain/rental-state-machine";

type PendingLogin = typeof loginRequests.$inferSelect;
async function showNumbers(chatId: number, request: PendingLogin) {
  const keyboard = new InlineKeyboard();
  for (const value of matchOptions(request.matchCode))
    keyboard.text(value, `login:${request.id}:${value}`);
  await telegramApi().sendMessage(
    chatId,
    "Pilih angka yang sama dengan di browser SewaMates. Jangan konfirmasi login dari tautan orang lain.",
    { reply_markup: keyboard },
  );
}
async function handleMessage(db: Executor, message: Message) {
  if (message.chat.type !== "private" || !message.from || message.from.is_bot) return;
  const sender = message.from.id,
    chat = message.chat.id,
    text = message.text || "";
  const [linked] = await db.select().from(users).where(eq(users.telegramUserId, sender));
  if (/^\/start(?:@\w+)?(?:\s|$)/.test(text)) {
    if (linked)
      await db
        .update(users)
        .set({ telegramBlockedAt: null, telegramChatId: chat })
        .where(eq(users.id, linked.id));
    const token = text.split(/\s+/)[1];
    if (!token || !/^[\w-]{43}$/.test(token)) {
      await telegramApi().sendMessage(
        chat,
        "Selamat datang di SewaMates! Mulai login dari browser agar sesimu tersambung dengan aman.",
        { reply_markup: new InlineKeyboard().url("Buka SewaMates", appUrl()) },
      );
      return;
    }
    const [request] = await db
      .select()
      .from(loginRequests)
      .where(
        and(
          eq(loginRequests.tokenHash, hash(token)),
          eq(loginRequests.status, "menunggu"),
          gt(loginRequests.expiresAt, new Date()),
        ),
      )
      .for("update");
    if (!request || (request.telegramUserId && request.telegramUserId !== sender)) {
      await telegramApi().sendMessage(
        chat,
        "Permintaan login tidak tersedia atau sudah kedaluwarsa. Buat permintaan baru di browser.",
      );
      return;
    }
    // Contact messages have no deep-link token; keep exactly one waiting request per sender.
    await db
      .update(loginRequests)
      .set({ status: "kedaluwarsa" })
      .where(
        and(
          eq(loginRequests.telegramUserId, sender),
          eq(loginRequests.status, "menunggu"),
          ne(loginRequests.id, request.id),
        ),
      );
    await db
      .update(loginRequests)
      .set({ telegramUserId: sender, userId: linked?.id || null })
      .where(eq(loginRequests.id, request.id));
    if (linked) await showNumbers(chat, request);
    else
      await telegramApi().sendMessage(
        chat,
        "Bagikan nomor HP milik akun Telegram kamu untuk masuk. Nomormu hanya dipakai untuk identitas akun dan tidak tampil ke pengguna lain.",
        { reply_markup: new Keyboard().requestContact("Bagikan nomor HP").resized().oneTime() },
      );
    return;
  }
  if (message.contact) {
    if (message.contact.user_id !== sender) {
      await telegramApi().sendMessage(
        chat,
        "Gunakan tombol Bagikan nomor HP untuk mengirim kontak milikmu sendiri.",
      );
      return;
    }
    const [request] = await db
      .select()
      .from(loginRequests)
      .where(
        and(
          eq(loginRequests.telegramUserId, sender),
          eq(loginRequests.status, "menunggu"),
          gt(loginRequests.expiresAt, new Date()),
        ),
      )
      .orderBy(desc(loginRequests.createdAt))
      .limit(1)
      .for("update");
    if (!request) {
      await telegramApi().sendMessage(
        chat,
        "Mulai permintaan login baru dari browser terlebih dahulu.",
      );
      return;
    }
    let phone: string;
    try {
      phone = normalizePhone(message.contact.phone_number);
    } catch {
      await telegramApi().sendMessage(chat, "Nomor HP tidak valid. Coba bagikan kontak kembali.");
      return;
    }
    await db.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`phone:${phone}`}))`);
    await db.insert(users).values({ phone }).onConflictDoNothing({ target: users.phone });
    const [user] = await db.select().from(users).where(eq(users.phone, phone)).for("update");
    if (user.accountStatus === "dihapus" || (linked && linked.id !== user.id)) {
      await telegramApi().sendMessage(
        chat,
        "Akun ini tidak bisa ditautkan. Hubungi admin melalui aplikasi.",
      );
      return;
    }
    // Do not move an existing Telegram link until the browser match is approved.
    await db.update(loginRequests).set({ userId: user.id }).where(eq(loginRequests.id, request.id));
    await telegramApi().sendMessage(chat, "Nomor HP berhasil diperiksa.", {
      reply_markup: { remove_keyboard: true },
    });
    await showNumbers(chat, request);
    return;
  }
  if (/^\/transaksi(?:@\w+)?$/.test(text)) {
    const active = linked
      ? await db
          .select()
          .from(rentals)
          .where(
            and(
              or(eq(rentals.ownerId, linked.id), eq(rentals.renterId, linked.id)),
              sql`${rentals.status} NOT IN ('SELESAI','DITOLAK','KADALUARSA','DIBATALKAN')`,
            ),
          )
          .orderBy(desc(rentals.createdAt))
          .limit(5)
      : [];
    const keyboard = new InlineKeyboard();
    for (const rental of active)
      keyboard
        .url(rental.publicCode, new URL(`/transaksi/${rental.id}`, appUrl()).toString())
        .row();
    keyboard.url(
      linked ? "Semua transaksi" : "Masuk ke SewaMates",
      new URL(linked ? "/transaksi" : "/masuk", appUrl()).toString(),
    );
    await telegramApi().sendMessage(
      chat,
      active.length
        ? active.map((r) => `${r.publicCode}: ${RENTAL_LABELS[r.status]}`).join("\n")
        : "Belum ada transaksi aktif. Mulai dari aplikasi SewaMates.",
      { reply_markup: keyboard },
    );
    return;
  }
  if (/^\/bantuan(?:@\w+)?$/.test(text)) {
    await telegramApi().sendMessage(
      chat,
      "Login dimulai di SewaMates. Pilih angka yang sama dengan browser. Jangan bagikan tautan login atau data kartu identitas di chat ini. Ubah rekening hanya setelah kamu memintanya di aplikasi.",
      { reply_markup: new InlineKeyboard().url("Buka SewaMates", appUrl()) },
    );
    return;
  }
  await telegramApi().sendMessage(
    chat,
    "Gunakan /start untuk terhubung atau /bantuan untuk panduan. Aktivitas sewa dilakukan di aplikasi.",
  );
}
async function handleCallback(db: Executor, query: CallbackQuery) {
  if (!query.data || !query.message || query.message.chat.type !== "private") return;
  const sender = query.from.id,
    chat = query.message.chat.id;
  if (sender !== chat) return;
  const [kind, id, value] = query.data.split(":");
  if (!/^[0-9a-f-]{36}$/.test(id || "")) return;
  if (kind === "login") {
    const [request] = await db
      .select()
      .from(loginRequests)
      .where(and(eq(loginRequests.id, id), eq(loginRequests.telegramUserId, sender)))
      .for("update");
    if (
      !request ||
      request.status !== "menunggu" ||
      request.expiresAt <= new Date() ||
      !request.userId
    ) {
      await telegramApi().answerCallbackQuery(query.id, {
        text: "Permintaan tidak tersedia. Mulai lagi dari browser.",
      });
      return;
    }
    if (value !== request.matchCode) {
      await db.update(loginRequests).set({ status: "kedaluwarsa" }).where(eq(loginRequests.id, id));
      await telegramApi().answerCallbackQuery(query.id, {
        text: "Angka tidak cocok. Login dibatalkan.",
        show_alert: true,
      });
      return;
    }
    const [user] = await db.select().from(users).where(eq(users.id, request.userId)).for("update");
    const [other] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.telegramUserId, sender));
    if (user.accountStatus === "dihapus" || (other && other.id !== user.id)) {
      await db.update(loginRequests).set({ status: "kedaluwarsa" }).where(eq(loginRequests.id, id));
      await telegramApi().answerCallbackQuery(query.id, {
        text: "Akun tidak tersedia.",
        show_alert: true,
      });
      return;
    }
    const relinked = user.telegramUserId && user.telegramUserId !== sender;
    if (relinked) {
      await db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.userId, user.id));
      await db
        .update(actionConfirmations)
        .set({ status: "kedaluwarsa" })
        .where(
          and(eq(actionConfirmations.userId, user.id), eq(actionConfirmations.status, "menunggu")),
        );
      await db
        .update(loginRequests)
        .set({ status: "kedaluwarsa" })
        .where(
          and(
            eq(loginRequests.userId, user.id),
            ne(loginRequests.id, id),
            ne(loginRequests.status, "dipakai"),
          ),
        );
      if (user.telegramChatId) {
        // A blocked old bot chat must not prevent legitimate relinking.
        await telegramApi()
          .sendMessage(
            user.telegramChatId,
            "Akun SewaMates dengan nomor HP kamu telah ditautkan ke akun Telegram baru. Semua sesi lama telah dicabut. Jika bukan kamu, hubungi admin.",
          )
          .catch(() => undefined);
      }
    }
    await db
      .update(users)
      .set({
        telegramUserId: sender,
        telegramChatId: chat,
        telegramLinkedAt: new Date(),
        telegramBlockedAt: null,
      })
      .where(eq(users.id, user.id));
    await db.update(loginRequests).set({ status: "disetujui" }).where(eq(loginRequests.id, id));
    await telegramApi().answerCallbackQuery(query.id, {
      text: "Login disetujui. Kembali ke browser SewaMates.",
    });
    await telegramApi().sendMessage(
      chat,
      "Login disetujui. Sesi diberikan hanya ke browser yang memulai permintaan ini.",
    );
    return;
  }
  if (kind === "confirm" && ["yes", "no"].includes(value)) {
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.telegramUserId, sender))
      .for("update");
    if (!user || user.accountStatus !== "aktif") return;
    const [entry] = await db
      .select()
      .from(actionConfirmations)
      .where(and(eq(actionConfirmations.id, id), eq(actionConfirmations.userId, user.id)))
      .for("update");
    if (!entry || entry.status !== "menunggu" || entry.expiresAt <= new Date()) {
      await telegramApi().answerCallbackQuery(query.id, {
        text: "Konfirmasi sudah dipakai atau kedaluwarsa.",
      });
      return;
    }
    if (entry.action !== "ubah_rekening") return; // Account deletion arrives in Sprint 5.
    if (value === "yes") {
      const payload = entry.payload as {
        type: "bank" | "ewallet";
        provider: string;
        accountNoEnc: string;
        accountName: string;
      };
      payoutInput.parse({
        type: payload.type,
        provider: payload.provider,
        accountNo: decrypt(payload.accountNoEnc),
        accountName: payload.accountName,
      });
      await db
        .insert(payoutAccounts)
        .values({ userId: user.id, ...payload })
        .onConflictDoUpdate({ target: payoutAccounts.userId, set: payload });
      await db.insert(notifications).values({
        userId: user.id,
        type: "payout_account_changed",
        title: "Rekening pencairan diperbarui",
        body: `${payload.provider} · ${maskAccount(decrypt(payload.accountNoEnc))}. Rekening ini dipakai untuk pencairan berikutnya.`,
        link: "/profil/rekening",
      });
    }
    await db
      .update(actionConfirmations)
      .set({ status: value === "yes" ? "dikonfirmasi" : "ditolak" })
      .where(eq(actionConfirmations.id, id));
    await telegramApi().answerCallbackQuery(query.id, {
      text: value === "yes" ? "Rekening berhasil diperbarui." : "Perubahan rekening ditolak.",
    });
    await telegramApi().sendMessage(
      chat,
      value === "yes"
        ? "Rekening pencairanmu sudah diperbarui."
        : "Perubahan dibatalkan. Rekening pencairanmu tetap seperti sebelumnya.",
    );
  }
}
export async function processTelegramUpdate(db: Database, update: Update) {
  return db.transaction(async (tx) => {
    const sender =
      update.message?.from?.id || update.callback_query?.from.id || update.my_chat_member?.from.id;
    // Acquire a sender lock before dedup, preserving Telegram contact/confirmation ordering.
    if (sender)
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`telegram:${sender}`}))`);
    const inserted = await tx
      .insert(telegramUpdates)
      .values({ updateId: update.update_id })
      .onConflictDoNothing()
      .returning();
    if (!inserted.length) return { duplicate: true };
    if (update.message) await handleMessage(tx, update.message);
    else if (update.callback_query) await handleCallback(tx, update.callback_query);
    else if (update.my_chat_member?.chat.type === "private") {
      const change = update.my_chat_member;
      await tx
        .update(users)
        .set({ telegramBlockedAt: change.new_chat_member.status === "kicked" ? new Date() : null })
        .where(eq(users.telegramUserId, change.chat.id));
    }
    return { duplicate: false };
  });
}
