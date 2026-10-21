import { afterEach, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import {
  encrypt,
  decrypt,
  hash,
  randomToken,
  matchCode,
  matchOptions,
  safeEqual,
} from "@/src/lib/crypto";
import { normalizePhone, payoutInput, decisionInput } from "@/src/lib/validation";
import { settingsSchema, DEFAULT_SETTINGS } from "@/src/domain/settings";
import { checkOrigin } from "@/src/lib/http";
import { scrubErrorEvent } from "@/src/lib/observability";

afterEach(() => {
  delete process.env.ACCOUNT_ENCRYPTION_KEY;
});
describe("Kunci, token, dan input sensitif", () => {
  it("menghapus payload sensitif dari event Sentry sambil mempertahankan tipe dan stack", () => {
    const event = scrubErrorEvent({
      type: undefined,
      request: {
        data: "private-photo",
        cookies: { session: "secret" },
        headers: { authorization: "secret" },
        query_string: "token=secret",
      },
      user: { id: "private-user" },
      extra: { accountNo: "1234567890" },
      breadcrumbs: [{ message: "https://api.telegram.org/bot-secret-token/sendMessage" }],
      exception: {
        values: [
          {
            type: "DatabaseError",
            value: "SQL params: secret-phone",
            stacktrace: { frames: [{ filename: "service.ts", lineno: 10 }] },
          },
        ],
      },
    });
    expect(JSON.stringify(event)).not.toMatch(/secret|private|1234567890/);
    expect(event.exception?.values?.[0].stacktrace?.frames?.[0].filename).toBe("service.ts");
  });
  it("mengenkripsi rekening dengan IV unik, menolak modifikasi, dan tidak menyimpan plaintext", () => {
    process.env.ACCOUNT_ENCRYPTION_KEY = randomBytes(32).toString("base64");
    const encrypted = encrypt("123456789012");
    expect(encrypted).not.toContain("123456789012");
    expect(decrypt(encrypted)).toBe("123456789012");
    expect(encrypt("123456789012")).not.toBe(encrypted);
    const parts = encrypted.split(".");
    parts[2] = Buffer.alloc(16).toString("base64url");
    expect(() => decrypt(parts.join("."))).toThrow();
  });
  it("menolak kunci enkripsi yang bukan 256 bit", () => {
    process.env.ACCOUNT_ENCRYPTION_KEY = "short";
    expect(() => encrypt("1234567890")).toThrow();
  });
  it("membuat token acak 32 byte dan tiga pilihan angka berbeda", () => {
    const token = randomToken();
    expect(Buffer.from(token, "base64url")).toHaveLength(32);
    expect(hash(token)).toHaveLength(64);
    expect(hash(token)).not.toBe(token);
    expect(randomToken()).not.toBe(token);
    for (let i = 0; i < 50; i++) {
      const code = matchCode(),
        options = matchOptions(code);
      expect(code).toMatch(/^\d{2}$/);
      expect(new Set(options).size).toBe(3);
      expect(options).toContain(code);
    }
    expect(safeEqual("a", "a")).toBe(true);
    expect(safeEqual("a", "b")).toBe(false);
  });
  it("menormalisasi nomor kontak dan menolak nomor tidak valid", () => {
    expect(normalizePhone("0812-3456-7890")).toBe("+6281234567890");
    expect(normalizePhone("6281234567890")).toBe("+6281234567890");
    expect(() => normalizePhone("hello")).toThrow();
  });
  it("memvalidasi kombinasi penyedia rekening dan alasan penolakan", () => {
    expect(
      payoutInput.safeParse({
        type: "bank",
        provider: "OVO",
        accountNo: "081234567890",
        accountName: "Teman Kampus",
      }).success,
    ).toBe(false);
    expect(decisionInput.safeParse({ decision: "ditolak" }).success).toBe(false);
  });
  it("menolak CSRF dengan origin asing atau tanpa Origin", () => {
    expect(() =>
      checkOrigin(
        new Request("http://localhost:3000/api/me", {
          method: "PATCH",
          headers: { origin: "https://attacker.example" },
        }),
      ),
    ).toThrow();
    expect(() =>
      checkOrigin(new Request("http://localhost:3000/api/me", { method: "PATCH" })),
    ).toThrow();
    expect(() =>
      checkOrigin(
        new Request("http://localhost:3000/api/me", {
          method: "PATCH",
          headers: { origin: "http://localhost:3000" },
        }),
      ),
    ).not.toThrow();
  });
});
describe("Pengaturan yang disetujui PM", () => {
  it("memakai default S1 yang sesuai aturan", () => {
    expect(DEFAULT_SETTINGS).toMatchObject({
      login_ttl_minutes: 10,
      login_max_requests: 5,
      login_window_minutes: 15,
      admin_session_hours: 12,
      user_session_days: 30,
      action_ttl_minutes: 10,
      commission_rate_bp: 1000,
    });
  });
  it("menolak tipe, key, rentang, dan hubungan nilai yang salah", () => {
    for (const patch of [
      { admin_session_hours: 13 },
      { login_ttl_minutes: "10" },
      { unknown: 1 },
      { admin_open_hour: 22, admin_close_hour: 8 },
      { deposit_min_bp: 6000, deposit_max_bp: 5000 },
    ])
      expect(settingsSchema.safeParse({ ...DEFAULT_SETTINGS, ...patch }).success).toBe(false);
  });
});
