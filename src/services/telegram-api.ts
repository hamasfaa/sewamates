import "server-only";
import { Api, InlineKeyboard } from "grammy";
import { required } from "@/src/lib/env";
export function telegramApi(timeoutSeconds = 8) {
  return new Api(required("TELEGRAM_BOT_TOKEN"), { timeoutSeconds });
}
export async function sendActionConfirmation(
  chatId: number,
  id: string,
  summary: string,
  ttl: number,
) {
  await telegramApi().sendMessage(
    chatId,
    `Konfirmasi rekening pencairan\n\n${summary}\n\nPerubahan berlaku setelah kamu konfirmasi. Berlaku ${ttl} menit. Jika bukan kamu, pilih Tolak.`,
    {
      reply_markup: new InlineKeyboard()
        .text("Konfirmasi", `confirm:${id}:yes`)
        .text("Tolak", `confirm:${id}:no`),
    },
  );
}
