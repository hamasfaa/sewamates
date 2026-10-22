import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withNotificationDelivery } from "@/src/lib/notification-dispatch";

const mocks = vi.hoisted(() => ({
  after: vi.fn(),
  deliver: vi.fn(),
  getDb: vi.fn(),
  captureException: vi.fn(),
}));
vi.mock("next/server", () => ({ after: mocks.after }));
vi.mock("@/src/db", () => ({ getDb: mocks.getDb }));
vi.mock("@/src/jobs/deliver-notifications", () => ({ deliverNotifications: mocks.deliver }));
vi.mock("@sentry/nextjs", () => ({ captureException: mocks.captureException }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("TELEGRAM_BOT_TOKEN", "local-test-only");
  mocks.deliver.mockResolvedValue({ attempted: 1, sent: 1 });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
const request = (method = "POST", path = "/api/rentals") =>
  new Request(`http://localhost:3000${path}`, { method });

describe("pengiriman notifikasi setelah respons", () => {
  it("menunggu aksi selesai lalu mengirim di background tanpa menahan respons", async () => {
    let commit!: (value: Response) => void;
    const response = new Response("tersimpan", { status: 201 });
    const handler = withNotificationDelivery(
      () =>
        new Promise((resolve) => {
          commit = resolve;
        }),
    );
    const pending = handler(request());
    expect(mocks.after).not.toHaveBeenCalled();
    commit(response);
    expect(await pending).toBe(response);
    expect(mocks.deliver).not.toHaveBeenCalled();
    expect(mocks.after).toHaveBeenCalledTimes(1);
    await mocks.after.mock.calls[0][0]();
    expect(mocks.deliver).toHaveBeenCalledTimes(1);
  });
  it.each([400, 403, 422, 500])(
    "tidak memicu pengiriman untuk respons gagal %i",
    async (status) => {
      await withNotificationDelivery(async () => new Response(null, { status }))(request());
      expect(mocks.after).not.toHaveBeenCalled();
    },
  );
  it("tidak memicu worker dari pembacaan atau dari job pengiriman sendiri", async () => {
    const handler = withNotificationDelivery(async () => new Response());
    await handler(request("GET"));
    await handler(request("POST", "/api/internal/jobs/deliver-notifications"));
    expect(mocks.after).not.toHaveBeenCalled();
  });
  it("melewati pengiriman jika bot belum dikonfigurasi", async () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "");
    await withNotificationDelivery(async () => new Response())(request());
    expect(mocks.after).not.toHaveBeenCalled();
  });
  it("kegagalan worker tidak mengubah respons transaksi atau mencetak secret", async () => {
    const error = new Error("https://api.telegram.org/bot-private-token/sendMessage");
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.deliver.mockRejectedValueOnce(error);
    const response = await withNotificationDelivery(
      async () => new Response(null, { status: 201 }),
    )(request());
    await expect(mocks.after.mock.calls[0][0]()).resolves.toBeUndefined();
    expect(response.status).toBe(201);
    expect(mocks.captureException).toHaveBeenCalledWith(error, expect.any(Object));
    expect(log).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(log.mock.calls)).not.toContain("private-token");
  });
});
