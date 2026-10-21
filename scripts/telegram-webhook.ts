import { Api } from "grammy";
const {
  TELEGRAM_BOT_TOKEN: token,
  TELEGRAM_WEBHOOK_SECRET: secret,
  NEXT_PUBLIC_APP_URL: url,
} = process.env;
if (!token || !secret || !url?.startsWith("https://"))
  throw new Error("Isi token bot, webhook secret, dan NEXT_PUBLIC_APP_URL HTTPS terlebih dahulu.");
const bot = new Api(token);
await bot.setMyCommands([
  { command: "start", description: "Masuk dan hubungkan akun SewaMates" },
  { command: "bantuan", description: "Panduan penggunaan SewaMates" },
]);
await bot.setWebhook(`${url.replace(/\/$/, "")}/api/telegram/webhook`, {
  secret_token: secret,
  allowed_updates: ["message", "callback_query", "my_chat_member"],
  max_connections: 1,
  drop_pending_updates: false,
});
console.log("Webhook dan perintah bot sudah didaftarkan. Token tidak ditampilkan.");
