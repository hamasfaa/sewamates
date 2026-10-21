import "server-only";
export function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Konfigurasi ${name} belum diisi.`);
  return value;
}
export function appUrl() {
  return process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
}
export function integrationsReady() {
  return Boolean(
    process.env.DATABASE_URL &&
    process.env.TELEGRAM_BOT_TOKEN &&
    process.env.TELEGRAM_BOT_USERNAME &&
    process.env.TELEGRAM_WEBHOOK_SECRET,
  );
}
