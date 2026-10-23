import {
  expect,
  test,
  type APIRequestContext,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { Pool } from "pg";
import QRCode from "qrcode";
import { transactionFixtures } from "../fixtures/transactions-data";
import { e2eAppUrl, e2eDatabaseUrl } from "../fixtures/transactions-env";

async function session(context: BrowserContext, token: string) {
  await context.addCookies([
    { name: "sm_session", value: token, url: e2eAppUrl, httpOnly: true, sameSite: "Lax" },
  ]);
}
async function fits(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
}
// API calls stand in for steps that this test is not about (request, payment, desktop handover).
async function call<T = Record<string, unknown>>(
  request: APIRequestContext,
  url: string,
  data?: unknown,
): Promise<T> {
  const response =
    data === undefined
      ? await request.get(url)
      : await request.post(url, {
          headers: {
            Origin: e2eAppUrl,
            "Content-Type": "application/json",
            "Idempotency-Key": crypto.randomUUID(),
          },
          data: JSON.stringify(data),
        });
  const body = await response.json();
  expect(response.ok(), JSON.stringify(body)).toBe(true);
  return body as T;
}
async function upload(request: APIRequestContext, purpose: string, bytes: Buffer) {
  const ticket = await call<{ path: string; signedUrl: string }>(request, "/api/uploads/sign", {
    purpose,
    contentType: "image/png",
    size: bytes.length,
  });
  const put = await request.put(ticket.signedUrl, {
    headers: { "Content-Type": "image/png" },
    data: bytes,
  });
  expect(put.ok()).toBe(true);
  return ticket.path;
}
// The list column keeps hidden copies of status chips on phones, so read the detail only.
const status = (view: Page, label: string) =>
  view.getByRole("region", { name: "Detail transaksi" }).getByText(label, { exact: true }).first();
const wibInput = (offsetMs = 0) =>
  new Date(Date.now() + 7 * 3600000 + offsetMs).toISOString().slice(0, 16);

test("serah terima di HP, masa cek, lalu pencairan berbukti sampai selesai", async ({
  browser,
  context,
  page,
}, info) => {
  test.setTimeout(300000);
  const f = await transactionFixtures(),
    desktop = info.project.name === "chromium-desktop",
    errors: string[] = [];
  const owner = await browser.newContext({ ...info.project.use, baseURL: e2eAppUrl }),
    admin = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      baseURL: e2eAppUrl,
    });
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: -7.2819, longitude: 112.7949, accuracy: 25 });
  await session(context, f.renter.token);
  await session(owner, f.owner.token);
  await session(admin, f.admin.token);
  const ownerPage = await owner.newPage(),
    adminPage = await admin.newPage(),
    pool = new Pool({ connectionString: e2eDatabaseUrl() });
  for (const view of [page, ownerPage, adminPage])
    view.on("pageerror", (e) => errors.push(e.message));
  adminPage.on("dialog", (dialog) => dialog.accept());
  const image = (seed: number) => QRCode.toBuffer(`Foto kondisi ${seed}`, { width: 160 });
  try {
    const account = await call<{ id: string }>(admin.request, "/api/admin/platform-accounts", {
      type: "bank",
      provider: "BCA",
      accountNo: "0123456789",
      accountName: "Platform Pengujian",
    });
    const { id } = await call<{ id: string }>(context.request, "/api/rentals", {
      itemId: f.itemId,
      pickupPointId: f.pointId,
      startAt: new Date(`${f.start}:00+07:00`).toISOString(),
      days: 1,
    });
    await call(owner.request, `/api/rentals/${id}/approve`, { version: 1 });
    let detail = await call<{ rental: { amountDue: number; version: number; publicCode: string } }>(
      context.request,
      `/api/rentals/${id}`,
    );
    const proof = await call<{ id: string }>(context.request, `/api/rentals/${id}/payments`, {
      platformAccountId: account.id,
      proofPath: await upload(context.request, "payment_proof", await image(0)),
      senderName: "Penyewa E2E",
      transferredAt: new Date(Date.now() - 60000).toISOString(),
      claimedAmount: detail.rental.amountDue,
    });
    detail = await call(context.request, `/api/rentals/${id}`);
    await call(admin.request, `/api/admin/payments/${proof.id}/decision`, {
      version: detail.rental.version,
      decision: "diterima",
      verifiedAmount: detail.rental.amountDue,
    });
    const { amountDue, publicCode } = detail.rental;
    // The handover window opens 60 minutes before the schedule.
    await pool.query(
      `UPDATE rentals SET start_at = now() + interval '10 minutes', due_at = now() + interval '10 minutes' + days * interval '24 hours',
       block_period = tstzrange(now() + interval '10 minutes', now() + interval '10 minutes' + days * interval '24 hours' + interval '3 hours', '[)') WHERE id = $1`,
      [id],
    );
    await page.goto(`/transaksi/${id}`);
    await ownerPage.goto(`/transaksi/${id}`);
    await expect(
      page.getByRole("heading", { name: "Serah terima barang", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("list", { name: "Progres transaksi" })).toBeVisible();
    await fits(page);
    if (desktop) {
      await expect(
        page.getByRole("heading", { name: "Lanjutkan di HP", exact: true }),
      ).toBeVisible();
      await expect(page.getByAltText("QR untuk membuka transaksi ini di HP")).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Saya sudah sampai", exact: true }),
      ).toBeHidden();
      await page.screenshot({
        path: test.info().outputPath("handover-desktop.png"),
        fullPage: true,
      });
      // The renter photographs at the start, the owner at the return (A-3.5).
      const phases = [
        { shooter: context.request, receiver: owner.request, confirm: { photosConfirmed: true } },
        { shooter: owner.request, receiver: context.request, confirm: {} },
      ];
      for (const [index, phase] of phases.entries()) {
        for (const request of [context.request, owner.request])
          await call(request, `/api/rentals/${id}/arrive`, {});
        for (const seed of [1, 2])
          await call(phase.shooter, `/api/rentals/${id}/handover/photos`, {
            path: await upload(phase.shooter, "handover_photo", await image(index * 2 + seed)),
            source: "gallery",
          });
        const { code } = await call<{ code: string }>(
          phase.shooter,
          `/api/rentals/${id}/handover/code`,
          {},
        );
        await call(phase.receiver, `/api/rentals/${id}/handover/confirm`, {
          code,
          ...phase.confirm,
        });
        if (index === 0) await expect(status(page, "Sedang disewa")).toBeVisible();
      }
    } else {
      for (const view of [ownerPage, page])
        await view.getByRole("button", { name: "Saya sudah sampai", exact: true }).click();
      await expect(page.getByText(/Pemilik sudah sampai/)).toBeVisible();
      for (const seed of [1, 2]) {
        await page.getByLabel("Pilih dari galeri").setInputFiles({
          name: `awal-${seed}.png`,
          mimeType: "image/png",
          buffer: await image(seed),
        });
        await expect(page.getByText(`(${seed}/8)`, { exact: false })).toBeVisible();
      }
      await expect(page.getByText("dari galeri").first()).toBeVisible();
      await page.getByRole("button", { name: "Tampilkan kode", exact: true }).click();
      const code = (await page.locator('[aria-label^="Kode "]').textContent())!.trim();
      expect(code).toMatch(/^\d{6}$/);
      await expect(page.getByAltText("QR kode serah terima")).toBeVisible();
      await page.screenshot({ path: test.info().outputPath("handover-code.png"), fullPage: true });
      await ownerPage.screenshot({
        path: test.info().outputPath("handover-owner.png"),
        fullPage: true,
      });
      await fits(page);
      await ownerPage.getByRole("checkbox", { name: /Saya sudah memeriksa foto kondisi/ }).check();
      await ownerPage
        .getByLabel("Kode serah terima (6 angka)")
        .fill(code === "000000" ? "111111" : "000000");
      await ownerPage.getByRole("button", { name: "Konfirmasi serah terima", exact: true }).click();
      await expect(ownerPage.getByText(/Kode tidak cocok. Sisa 4 percobaan/)).toBeVisible();
      await ownerPage.getByLabel("Kode serah terima (6 angka)").fill(code);
      await ownerPage.getByRole("button", { name: "Konfirmasi serah terima", exact: true }).click();
      await expect(status(page, "Sedang disewa")).toBeVisible();
      await expect(
        page.getByRole("heading", { name: "Pengembalian barang", exact: true }),
      ).toBeVisible();
      await fits(ownerPage);
      for (const view of [page, ownerPage])
        await view.getByRole("button", { name: "Saya sudah sampai", exact: true }).click();
      for (const seed of [3, 4]) {
        await ownerPage.getByLabel("Pilih dari galeri").setInputFiles({
          name: `akhir-${seed}.png`,
          mimeType: "image/png",
          buffer: await image(seed),
        });
        await expect(ownerPage.getByText(`(${seed - 2}/8)`, { exact: false })).toBeVisible();
      }
      await ownerPage.getByRole("button", { name: "Tampilkan kode", exact: true }).click();
      const back = (await ownerPage.locator('[aria-label^="Kode "]').textContent())!.trim();
      await page.getByLabel("Kode pengembalian (6 angka)").fill(back);
      await page.getByRole("button", { name: "Konfirmasi pengembalian", exact: true }).click();
    }
    await expect(
      page.getByRole("heading", { name: "Cek kondisi barang", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Rincian pencairan yang akan dibuat", { exact: true }),
    ).toBeVisible();
    await page.screenshot({ path: test.info().outputPath("check-window.png"), fullPage: true });
    await expect(
      page.getByRole("region", { name: "Kondisi awal (serah terima)" }).getByRole("img"),
    ).toHaveCount(2);
    await fits(page);
    for (const view of [page, ownerPage]) {
      await view.getByRole("button", { name: "Sesuai", exact: true }).click();
      await expect(
        view
          .getByText("Kamu sudah menyatakan kondisi sesuai.", { exact: true })
          .or(status(view, "Dana diproses")),
      ).toBeVisible();
    }
    await expect(status(page, "Dana diproses")).toBeVisible();
    await adminPage.goto("/admin/pencairan");
    await expect(
      adminPage.getByRole("link", { name: "Pencairan, 2 menunggu", exact: true }),
    ).toBeVisible();
    const queue = adminPage.getByRole("table", { name: "Antrean pencairan" });
    for (const [recipient, amount] of [
      ["Pemilik E2E", 45000],
      ["Penyewa E2E", amountDue - 50000],
    ] as const) {
      await queue
        .getByRole("button", { name: `Buka ${publicCode} untuk ${recipient}`, exact: true })
        .click();
      await expect(
        adminPage
          .getByText("081200000000", { exact: false })
          .or(adminPage.getByText("081200000001", { exact: false })),
      ).toBeVisible();
      await adminPage.getByRole("button", { name: "Klaim tugas", exact: true }).click();
      await adminPage.getByLabel("Rekening platform sumber").selectOption({ index: 1 });
      await adminPage.getByLabel("Nominal ditransfer (Rp)").fill(String(amount));
      await adminPage.getByLabel("Biaya transfer (Rp)").fill("2500");
      await adminPage.getByLabel("Waktu transfer (WIB)").fill(wibInput(-60000));
      await adminPage.getByLabel("Bukti transfer", { exact: true }).setInputFiles({
        name: `transfer-${recipient}.png`,
        mimeType: "image/png",
        buffer: await image(amount),
      });
      await adminPage.getByRole("button", { name: "Selesaikan pencairan", exact: true }).click();
      await expect(adminPage.getByText(/^Selesai /)).toBeVisible();
      await fits(adminPage);
    }
    await expect(
      adminPage.getByText("Tidak ada tugas pencairan yang menunggu.", { exact: true }),
    ).toBeVisible();
    const payouts = page.getByRole("region", { name: "Pencairan & refund", exact: true });
    await expect(status(page, "Selesai")).toBeVisible();
    await expect(payouts.getByRole("link", { name: "Lihat bukti transfer ↗" })).toHaveCount(1);
    await expect(payouts.getByText("Sudah ditransfer").first()).toBeVisible();
    const final = await call<{ rental: { status: string }; payouts: { status: string }[] }>(
      context.request,
      `/api/rentals/${id}`,
    );
    expect(final.rental.status).toBe("SELESAI");
    expect(final.payouts.map((task) => task.status)).toEqual(["selesai", "selesai"]);
    await fits(page);
    if (desktop)
      await adminPage.screenshot({
        path: test.info().outputPath("admin-payouts.png"),
        fullPage: true,
      });
    expect(errors).toEqual([]);
  } finally {
    await pool.end();
    await owner.close();
    await admin.close();
  }
});
