import { afterEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@/src/db";
import { endpoint, json } from "@/src/lib/http";
import { signUpload } from "@/src/lib/storage";

const mocks = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.createClient }));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("Konfigurasi penyimpanan foto", () => {
  it.each([
    { url: "", key: "sb_secret_test_only" },
    { url: "https://storage.test", key: "" },
    { url: "https://storage.test", key: "   " },
  ])(
    "mengembalikan 503 tanpa mengakses DB atau membocorkan konfigurasi: $url",
    async ({ url, key }) => {
      vi.stubEnv("SUPABASE_URL", url);
      vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", key);
      const transaction = vi.fn();
      const db = { transaction } as unknown as Database;
      const handler = endpoint(async () =>
        json(
          await signUpload(db, crypto.randomUUID(), {
            purpose: "avatar",
            contentType: "image/jpeg",
            size: 1024,
          }),
        ),
      );
      const response = await handler(
        new Request("http://localhost:3000/api/uploads/sign", {
          method: "POST",
        }),
      );
      expect(response.status).toBe(503);
      const result = await response.json();
      expect(result.error).toMatchObject({
        code: "STORAGE_NOT_CONFIGURED",
        message: expect.stringContaining("penyimpanan foto belum diaktifkan"),
      });
      expect(JSON.stringify(result)).not.toMatch(/sb_secret_test_only|storage\.test|SUPABASE_/);
      expect(transaction).not.toHaveBeenCalled();
      expect(mocks.createClient).not.toHaveBeenCalled();
    },
  );
});
