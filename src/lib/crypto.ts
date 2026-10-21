import "server-only";
import {
  createHash,
  randomBytes,
  randomInt,
  createCipheriv,
  createDecipheriv,
  timingSafeEqual,
} from "node:crypto";
import { required } from "./env";
export const randomToken = () => randomBytes(32).toString("base64url");
export const hash = (value: string) => createHash("sha256").update(value).digest("hex");
export function safeEqual(a: string, b: string) {
  return timingSafeEqual(Buffer.from(hash(a)), Buffer.from(hash(b)));
}
export const matchCode = () => String(randomInt(10, 100));
export function matchOptions(correct: string) {
  const values = new Set([correct]);
  while (values.size < 3) values.add(matchCode());
  const result = [...values];
  for (let i = result.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
function key() {
  const value = Buffer.from(required("ACCOUNT_ENCRYPTION_KEY"), "base64");
  if (value.length !== 32) throw new Error("ACCOUNT_ENCRYPTION_KEY wajib 32 byte dalam base64.");
  return value;
}
export function encrypt(value: string) {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [
    "v1",
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    body.toString("base64url"),
  ].join(".");
}
export function decrypt(value: string) {
  const [version, iv, tag, body] = value.split(".");
  if (version !== "v1" || !iv || !tag || !body)
    throw new Error("Format data terenkripsi tidak sah.");
  const cipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  cipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([cipher.update(Buffer.from(body, "base64url")), cipher.final()]).toString(
    "utf8",
  );
}
export function maskAccount(value: string) {
  return `•••• ${value.slice(-4)}`;
}
