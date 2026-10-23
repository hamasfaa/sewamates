import { test as base, expect, type APIRequestContext, type Browser } from "@playwright/test";
import { Pool } from "pg";
import QRCode from "qrcode";
import { transactionFixtures } from "../fixtures/transactions-data";
import { e2eAppUrl, e2eDatabaseUrl } from "../fixtures/transactions-env";
import type { Wire } from "../../src/lib/live-api";
import type { rentalDetail } from "../../src/services/rental-service";

async function call<T = unknown>(request: APIRequestContext, path: string, data?: unknown) {
  const response =
    data === undefined
      ? await request.get(path)
      : await request.post(path, {
          headers: { Origin: e2eAppUrl, "Idempotency-Key": crypto.randomUUID() },
          data,
        });
  const body = await response.json();
  expect(response.ok(), `${path}: ${JSON.stringify(body)}`).toBe(true);
  return body as T;
}
async function upload(request: APIRequestContext, purpose: string) {
  const bytes = await QRCode.toBuffer(crypto.randomUUID(), { width: 160 });
  const ticket = await call<{ path: string; signedUrl: string }>(request, "/api/uploads/sign", {
    purpose,
    contentType: "image/png",
    size: bytes.length,
  });
  expect(
    (
      await request.put(ticket.signedUrl, {
        headers: { "Content-Type": "image/png" },
        data: bytes,
      })
    ).ok(),
  ).toBe(true);
  return ticket.path as string;
}

// Separate browser sessions are essential: these regressions involve another participant/admin.
const test = base.extend<{ actors: Awaited<ReturnType<typeof actors>> }>({
  actors: async ({ browser }, provide) => {
    const state = await actors(browser);
    try {
      await provide(state);
    } finally {
      await state.close();
    }
  },
});
async function actors(browser: Browser) {
  const f = await transactionFixtures(),
    pool = new Pool({ connectionString: e2eDatabaseUrl() });
  await pool.query("UPDATE users SET role='admin' WHERE id=$1", [f.stranger.id]);
  const errors: string[] = [];
  const people = await Promise.all(
    (["renter", "owner", "admin", "stranger"] as const).map(async (name) => {
      const context = await browser.newContext({
        baseURL: e2eAppUrl,
        viewport:
          name === "renter" || name === "owner"
            ? { width: 390, height: 844 }
            : { width: 1440, height: 1000 },
        permissions: ["geolocation"],
        geolocation: { latitude: -7.2819, longitude: 112.7949 },
      });
      await context.addCookies([
        {
          name: "sm_session",
          value: f[name].token,
          url: e2eAppUrl,
          httpOnly: true,
          sameSite: "Lax",
        },
      ]);
      const page = await context.newPage();
      page.on("pageerror", (error) => errors.push(error.message));
      return { context, page, request: context.request };
    }),
  );
  const [renter, owner, admin, otherAdmin] = people;
  const account = await call<{ id: string }>(admin.request, "/api/admin/platform-accounts", {
    type: "bank",
    provider: "BCA",
    accountNo: "0123456789",
    accountName: "Platform Regresi",
  });
  const { id } = await call<{ id: string }>(renter.request, "/api/rentals", {
    itemId: f.itemId,
    pickupPointId: f.pointId,
    startAt: new Date(`${f.start}:00+07:00`).toISOString(),
    days: 1,
  });
  const detail = () =>
    call<Wire<Awaited<ReturnType<typeof rentalDetail>>>>(renter.request, `/api/rentals/${id}`);
  await call(owner.request, `/api/rentals/${id}/approve`, { version: 1 });
  const proof = await call<{ id: string }>(renter.request, `/api/rentals/${id}/payments`, {
    platformAccountId: account.id,
    proofPath: await upload(renter.request, "payment_proof"),
    senderName: "Penyewa Regresi",
    transferredAt: new Date(Date.now() - 60000).toISOString(),
    claimedAmount: (await detail()).rental.amountDue,
  });
  const d = await detail();
  await call(admin.request, `/api/admin/payments/${proof.id}/decision`, {
    decision: "diterima",
    version: d.rental.version,
    verifiedAmount: d.rental.amountDue,
  });
  async function openWindow() {
    await pool.query(
      `UPDATE rentals SET start_at=now()+interval '10 minutes',due_at=now()+interval '10 minutes'+days*interval '24 hours',
      block_period=tstzrange(now()+interval '10 minutes',now()+interval '10 minutes'+days*interval '24 hours'+interval '3 hours','[)') WHERE id=$1`,
      [id],
    );
  }
  async function arriveBoth() {
    for (const person of [renter, owner])
      await call(person.request, `/api/rentals/${id}/arrive`, {});
  }
  async function addPhoto(request: APIRequestContext) {
    await call(request, `/api/rentals/${id}/handover/photos`, {
      path: await upload(request, "handover_photo"),
      source: "gallery",
    });
  }
  async function handover(phase: "start" | "end") {
    await arriveBoth();
    const shooter = phase === "start" ? renter : owner,
      receiver = phase === "start" ? owner : renter;
    await addPhoto(shooter.request);
    await addPhoto(shooter.request);
    const { code } = await call<{ code: string }>(
      shooter.request,
      `/api/rentals/${id}/handover/code`,
      {},
    );
    await call(receiver.request, `/api/rentals/${id}/handover/confirm`, {
      code,
      ...(phase === "start" ? { photosConfirmed: true } : {}),
    });
  }
  await openWindow();
  return {
    f,
    pool,
    renter,
    owner,
    admin,
    otherAdmin,
    id,
    detail,
    openWindow,
    arriveBoth,
    addPhoto,
    handover,
    close: async () => {
      await Promise.all(people.map((person) => person.context.close()));
      await pool.end();
      expect(errors).toEqual([]);
    },
  };
}

test("jadwal ulang mengarsipkan foto lama dan meminta dua foto baru", async ({ actors: s }) => {
  await s.arriveBoth();
  await s.addPhoto(s.renter.request);
  await s.addPhoto(s.renter.request);
  await s.renter.page.goto(`/transaksi/${s.id}`);
  await s.owner.page.goto(`/transaksi/${s.id}`);
  await s.renter.page.getByRole("button", { name: "Usulkan jadwal baru", exact: true }).click();
  await s.renter.page.getByLabel("Jadwal mulai baru (WIB)").fill(s.f.start);
  await s.renter.page.getByRole("button", { name: "Kirim usulan", exact: true }).click();
  await s.owner.page.getByRole("button", { name: "Setujui jadwal baru", exact: true }).click();
  await expect.poll(async () => (await s.detail()).rental.rescheduleCount).toBe(1);
  await s.openWindow();
  await s.arriveBoth();
  await s.renter.page.reload();
  await expect(
    s.renter.page.getByText("Ambil minimal 2 foto kondisi awal (0/8).", { exact: true }),
  ).toBeVisible();
  await expect(
    s.renter.page.getByRole("button", { name: "Tampilkan kode", exact: true }),
  ).toHaveCount(0);
  await expect(s.renter.page.getByText(/jadwal sebelumnya/)).toHaveCount(2);
  const refused = await s.renter.request.post(`/api/rentals/${s.id}/handover/code`, {
    headers: { Origin: e2eAppUrl },
    data: {},
  });
  expect(refused.status()).toBe(409);
  expect((await refused.json()).error.code).toBe("PHOTOS_REQUIRED");
  for (let count = 1; count <= 2; count++) {
    await s.renter.page.getByLabel("Pilih dari galeri").setInputFiles({
      name: `baru-${count}.png`,
      mimeType: "image/png",
      buffer: await QRCode.toBuffer(`Pertemuan baru ${count}`, { width: 160 }),
    });
    await expect(
      s.renter.page.getByText(`Ambil minimal 2 foto kondisi awal (${count}/8).`, { exact: true }),
    ).toBeVisible();
    await expect(
      s.renter.page.getByRole("button", { name: "Tampilkan kode", exact: true }),
    ).toHaveCount(count === 2 ? 1 : 0);
  }
  await s.renter.page.getByRole("button", { name: "Tampilkan kode", exact: true }).click();
  const code = (await s.renter.page.locator('[aria-label^="Kode "]').textContent())!.trim();
  await s.owner.page.getByRole("checkbox", { name: /Saya sudah memeriksa foto kondisi/ }).check();
  await s.owner.page.getByLabel("Kode serah terima (6 angka)").fill(code);
  await s.owner.page.getByRole("button", { name: "Konfirmasi serah terima", exact: true }).click();
  await expect.poll(async () => (await s.detail()).rental.status).toBe("BERJALAN");
});

test("detail pencairan mengikuti klaim dan pelepasan admin lain tanpa reload", async ({
  actors: s,
}) => {
  await s.handover("start");
  await s.handover("end");
  for (const person of [s.renter, s.owner])
    await call(person.request, `/api/rentals/${s.id}/check`, { decision: "sesuai" });
  const d = await s.detail();
  const task = (
    await call<{ id: string; recipientName: string; amount: number }[]>(
      s.admin.request,
      "/api/admin/payout-tasks",
    )
  )[0];
  for (const person of [s.admin, s.otherAdmin]) {
    await person.page.goto("/admin/pencairan");
    await person.page
      .getByRole("button", {
        name: `Buka ${d.rental.publicCode} untuk ${task.recipientName}`,
        exact: true,
      })
      .first()
      .click();
    await expect(
      person.page.getByRole("button", { name: "Klaim tugas", exact: true }),
    ).toBeVisible();
  }
  await s.admin.page.getByRole("button", { name: "Klaim tugas", exact: true }).click();
  await expect(s.admin.page.getByLabel("Rekening platform sumber")).toBeVisible();
  await expect(s.otherAdmin.page.getByText(/Tugas sedang diklaim admin lain/)).toBeVisible();
  await expect(
    s.otherAdmin.page.getByRole("button", { name: "Klaim tugas", exact: true }),
  ).toHaveCount(0);
  await s.admin.page.getByLabel("Nominal ditransfer (Rp)").fill(String(task.amount));
  // A background update must preserve the admin's unsent form.
  await s.admin.page.waitForResponse(
    (response) =>
      response.url().endsWith(`/payout-tasks/${task.id}`) && response.request().method() === "GET",
  );
  await expect(s.admin.page.getByLabel("Nominal ditransfer (Rp)")).toHaveValue(String(task.amount));
  await s.admin.page.getByRole("button", { name: "Lepas klaim", exact: true }).click();
  await expect(
    s.otherAdmin.page.getByRole("button", { name: "Klaim tugas", exact: true }),
  ).toBeVisible();
  await s.otherAdmin.page.getByRole("button", { name: "Klaim tugas", exact: true }).click();
  await expect(s.otherAdmin.page.getByLabel("Rekening platform sumber")).toBeVisible();
  await expect(s.admin.page.getByText(/Tugas sedang diklaim admin lain/)).toBeVisible();
});

test("bukti tambahan sengketa terlihat admin tanpa reload", async ({ actors: s }) => {
  await s.handover("start");
  await call(s.renter.request, `/api/rentals/${s.id}/disputes`, {
    category: "rusak",
    description: "Lensa kamera pecah saat diperiksa dan tidak dapat digunakan.",
    evidencePaths: [await upload(s.renter.request, "dispute_evidence")],
  });
  await s.admin.page.goto("/admin/sengketa");
  await s.admin.page.getByRole("button", { name: "Lihat bukti", exact: true }).click();
  await expect(s.admin.page.getByRole("link", { name: /Bukti \d/ })).toHaveCount(1);
  await s.owner.page.goto(`/transaksi/${s.id}`);
  await s.owner.page.getByLabel("Bukti (opsional, maksimal 10 file)").setInputFiles({
    name: "bantahan.png",
    mimeType: "image/png",
    buffer: await QRCode.toBuffer("Bukti pemilik", { width: 160 }),
  });
  await s.owner.page
    .getByLabel("Catatan untuk admin (opsional)")
    .fill("Kondisi lensa awal masih utuh saat diserahkan.");
  await s.owner.page.getByRole("button", { name: "Kirim bukti", exact: true }).click();
  await expect(s.admin.page.getByRole("link", { name: /Bukti \d/ })).toHaveCount(2);
  await expect(
    s.admin.page.getByText("Kondisi lensa awal masih utuh saat diserahkan.", { exact: true }),
  ).toBeVisible();
});
