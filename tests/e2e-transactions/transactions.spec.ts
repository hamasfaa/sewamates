import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { transactionFixtures } from "../fixtures/transactions-data";
import { e2eAppUrl } from "../fixtures/transactions-env";
import QRCode from "qrcode";

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
test("akun baru menyewa barang Rp1 juta, pembayaran bertahap, verifikasi, dan chat privat", async ({
  browser,
  context,
  page,
}, info) => {
  const f = await transactionFixtures();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/transaksi");
  await expect(page).toHaveURL(/\/masuk$/);
  expect((await context.request.get("/api/rentals")).status()).toBe(401);
  expect((await context.request.post("/api/internal/jobs/expire-payments")).status()).toBe(403);
  await session(context, f.renter.token);
  expect((await context.request.get("/api/admin/platform-accounts")).status()).toBe(403);
  const owner = await browser.newContext({ ...info.project.use, baseURL: e2eAppUrl }),
    admin = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      baseURL: e2eAppUrl,
    });
  await session(owner, f.owner.token);
  await session(admin, f.admin.token);
  const ownerPage = await owner.newPage(),
    adminPage = await admin.newPage();
  ownerPage.on("pageerror", (error) => errors.push(error.message));
  adminPage.on("pageerror", (error) => errors.push(error.message));
  ownerPage.on("dialog", (d) => d.accept());
  adminPage.on("dialog", (d) => d.accept());
  try {
    await adminPage.goto("/admin/pengaturan/rekening");
    await expect(
      adminPage.getByText(
        "Belum ada rekening. Tambahkan rekening pertama agar pemilik bisa menyetujui pengajuan.",
        { exact: true },
      ),
    ).toBeVisible();
    await adminPage.getByLabel("Nomor rekening / e-wallet").fill("0123456789");
    await adminPage.getByLabel("Nama pemilik rekening").fill("Platform Pengujian");
    await adminPage.getByRole("button", { name: "Simpan rekening", exact: true }).click();
    await expect(adminPage.getByText("0123456789", { exact: true })).toBeVisible();
    await fits(adminPage);
    await ownerPage.goto("/notifikasi");
    await expect(
      ownerPage.getByRole("heading", { name: "Belum ada kabar baru", exact: true }),
    ).toBeVisible();
    await page.goto(`/barang/${f.itemId}/sewa`);
    await expect(page.getByRole("heading", { name: "Ajukan sewa", exact: true })).toBeVisible();
    await page.getByLabel("Mulai sewa (WIB)").fill(f.start);
    await page.getByLabel("Durasi (hari)").fill("1");
    await page.getByLabel("Titik serah terima").selectOption(f.pointId);
    await page.getByLabel("Pesan untuk pemilik (opsional)").fill("Untuk tugas kampus.");
    await fits(page);
    await page.getByRole("button", { name: "Kirim pengajuan", exact: true }).click();
    await expect(page).toHaveURL(/\/transaksi\/[\w-]+$/);
    const id = page.url().split("/").at(-1)!;
    const stranger = await browser.newContext({ baseURL: e2eAppUrl });
    await session(stranger, f.stranger.token);
    expect((await stranger.request.get(`/api/rentals/${id}`)).status()).toBe(404);
    await stranger.close();
    // A different browser creates the request; the open notification page updates without navigation.
    const notice = ownerPage.getByRole("heading", { name: "Ada pengajuan sewa baru" });
    await expect(notice).toBeVisible();
    await expect(
      ownerPage.getByRole("link", { name: "Notifikasi, 1 belum dibaca", exact: true }),
    ).toBeVisible();
    await fits(ownerPage);
    await ownerPage.getByRole("button").filter({ has: notice }).click();
    await expect(ownerPage).toHaveURL(`/transaksi/${id}`);
    await ownerPage.getByRole("button", { name: "Terima pengajuan", exact: true }).click();
    await expect(ownerPage.getByText("Batas unggah bukti:")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Unggah bukti transfer", exact: true }),
    ).toBeVisible();
    await fits(page);
    await fits(ownerPage);
    if (info.project.name === "chromium-desktop") {
      const summary = page
        .getByRole("heading", { name: "Rincian pembayaran", exact: true })
        .locator("..");
      expect(await summary.evaluate((element) => getComputedStyle(element).position)).toBe(
        "sticky",
      );
      const formBox = await page
        .getByRole("heading", { name: "Unggah bukti transfer", exact: true })
        .boundingBox();
      const summaryBox = await summary.boundingBox();
      expect(summaryBox!.x).toBeGreaterThan(formBox!.x);
      await page.screenshot({ path: test.info().outputPath("payment.png"), fullPage: true });
    }
    const rental = (await (await context.request.get(`/api/rentals/${id}`)).json()).rental;
    expect(rental.listingSnapshot.itemValue).toBe(1000000);
    const transferTime = new Date(Date.now() + 7 * 3600000 - 60000).toISOString().slice(0, 16);
    const image = await QRCode.toBuffer("Gambar pengujian lokal", { width: 120 });
    async function pay(amount: number, index: number, reject = false) {
      await page.getByLabel("Rekening tujuan", { exact: true }).selectOption({ index: 1 });
      await page.getByLabel("Nama pengirim", { exact: true }).fill("Penyewa E2E");
      await page.getByLabel("Nominal yang ditransfer (Rp)").fill(String(amount));
      await page.getByLabel("Waktu transfer (WIB)").fill(transferTime);
      const proofFile = {
        name: `bukti-${index}.png`,
        mimeType: "image/png",
        buffer: Buffer.concat([image, Buffer.from(String(index))]),
      };
      if (index === 0) {
        await page.getByLabel("Bukti transfer", { exact: true }).setInputFiles({
          name: "salah.txt",
          mimeType: "text/plain",
          buffer: Buffer.from("bukan bukti transfer"),
        });
        await expect(
          page.getByRole("alert").filter({ hasText: "ukuran maksimal 5 MB" }),
        ).toBeVisible();
      }
      if (index === 1 && info.project.name === "chromium-desktop") {
        const dataTransfer = await page.evaluateHandle(
          ({ name, bytes }) => {
            const transfer = new DataTransfer();
            transfer.items.add(new File([Uint8Array.from(bytes)], name, { type: "image/png" }));
            return transfer;
          },
          { name: proofFile.name, bytes: Array.from(proofFile.buffer) },
        );
        const dropzone = page.getByRole("group", {
          name: "Area unggah bukti transfer",
          exact: true,
        });
        await dropzone.dispatchEvent("dragover", { dataTransfer });
        await dropzone.dispatchEvent("drop", { dataTransfer });
        await dataTransfer.dispose();
      } else {
        await page.getByLabel("Bukti transfer", { exact: true }).setInputFiles(proofFile);
      }
      await expect(
        page.getByText(`File dipilih: ${proofFile.name}`, { exact: true }),
      ).toBeVisible();
      await page.getByRole("button", { name: "Kirim bukti transfer", exact: true }).click();
      await expect(page.getByText("Bukti sedang diperiksa admin.", { exact: false })).toBeVisible();
      await adminPage.goto("/admin/pembayaran");
      const queue = adminPage.getByRole("table", { name: "Antrean verifikasi pembayaran" });
      await expect(
        queue.getByRole("columnheader", { name: "Umur tugas", exact: true }),
      ).toBeVisible();
      await expect(
        adminPage.getByRole("link", { name: "Pembayaran, 1 menunggu", exact: true }),
      ).toBeVisible();
      if (index === 0) {
        await adminPage.getByLabel("Cari pembayaran", { exact: true }).fill("tidak-ditemukan");
        await adminPage.getByRole("button", { name: "Cari", exact: true }).click();
        await expect(
          adminPage.getByText("Tidak ada bukti yang cocok dengan filter.", { exact: true }),
        ).toBeVisible();
        await adminPage.getByLabel("Cari pembayaran", { exact: true }).fill(rental.publicCode);
        await adminPage.getByRole("button", { name: "Cari", exact: true }).click();
        await expect(queue.getByText(rental.publicCode, { exact: true })).toBeVisible();
        await adminPage.getByLabel("Target verifikasi", { exact: true }).selectOption("overdue");
        await expect(
          adminPage.getByText("Tidak ada bukti yang cocok dengan filter.", { exact: true }),
        ).toBeVisible();
        await adminPage.getByLabel("Target verifikasi", { exact: true }).selectOption("on_time");
        await expect(queue.getByText(rental.publicCode, { exact: true })).toBeVisible();
        await adminPage.getByLabel("Cari pembayaran", { exact: true }).fill("");
        await adminPage.getByRole("button", { name: "Cari", exact: true }).click();
        await adminPage.getByLabel("Target verifikasi", { exact: true }).selectOption("all");
      }
      await queue
        .getByRole("button", { name: `Periksa ${rental.publicCode} dari Penyewa E2E`, exact: true })
        .click();
      await expect(adminPage.getByAltText("Bukti transfer yang diajukan")).toBeVisible();
      if (index === 0 && info.project.name === "chromium-desktop")
        await adminPage.screenshot({
          path: test.info().outputPath("admin-payments.png"),
          fullPage: true,
        });
      if (reject) {
        const reason = "Dana belum ditemukan pada mutasi rekening platform.";
        await adminPage
          .getByLabel("Templat alasan penolakan", { exact: true })
          .selectOption(reason);
        await expect(adminPage.getByLabel("Alasan penolakan", { exact: true })).toHaveValue(reason);
        await adminPage.getByRole("button", { name: "Tolak bukti", exact: true }).click();
        await expect(page.getByText(reason, { exact: true })).toBeVisible();
      } else {
        await adminPage.getByLabel("Nominal yang masuk di mutasi (Rp)").fill(String(amount));
        await adminPage.getByRole("checkbox", { name: /Saya sudah mencocokkan/ }).check();
        await adminPage.getByRole("button", { name: "Terima pembayaran", exact: true }).click();
      }
      await expect(
        adminPage.getByText("Tidak ada bukti yang menunggu verifikasi.", { exact: true }),
      ).toBeVisible();
      await expect(
        adminPage.getByRole("link", { name: "Pembayaran, 1 menunggu", exact: true }),
      ).toHaveCount(0);
      await fits(adminPage);
    }
    await pay(50000, 0, true);
    await pay(50000, 1);
    await expect(page.getByText(/Kurang Rp/)).toContainText("100.001");
    await pay(rental.amountDue - 50000, 2);
    await expect(
      page.getByText("Pembayaran sudah diterima platform.", { exact: false }),
    ).toBeVisible();
    await fits(page);
    const final = await (await context.request.get(`/api/rentals/${id}`)).json();
    expect(final.rental.status).toBe("DIBAYAR");
    expect(final.payments).toHaveLength(3);
    expect(
      final.payments.filter((payment: { status: string }) => payment.status === "ditolak"),
    ).toHaveLength(1);
    const proof = new URL(final.payments[0].proofUrl);
    proof.searchParams.delete("token");
    expect((await context.request.get(proof.toString())).status()).toBe(403);
    await page.getByRole("link", { name: "Buka chat", exact: true }).click();
    const room = rental.conversationId;
    await page
      .getByLabel("Pesan", { exact: true })
      .fill("Halo, kontak 081234567890 https://example.com");
    await page.getByRole("button", { name: "Kirim pesan", exact: true }).click();
    await expect(
      page.getByText("Demi keamanan, lakukan transaksi lewat SewaMates.", { exact: true }),
    ).toBeVisible();
    expect(await page.getByRole("log").innerText()).not.toContain("081234567890");
    expect((await admin.request.get(`/api/conversations/${room}/messages`)).status()).toBe(404);
    await ownerPage.goto(`/chat/${room}`);
    await expect(
      ownerPage.getByText("Demi keamanan, lakukan transaksi lewat SewaMates.", { exact: true }),
    ).toBeVisible();
    await ownerPage
      .getByLabel("Pesan", { exact: true })
      .fill("Siap, bertemu di lobi sesuai jadwal.");
    await ownerPage.getByRole("button", { name: "Kirim pesan", exact: true }).click();
    await expect(
      page.getByText("Siap, bertemu di lobi sesuai jadwal.", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText(/Dibaca/).first()).toBeVisible();
    await page
      .getByLabel("Pilih gambar chat")
      .setInputFiles({ name: "chat.png", mimeType: "image/png", buffer: image });
    await expect(ownerPage.getByAltText("Gambar dalam percakapan")).toBeVisible();
    await expect
      .poll(() =>
        ownerPage
          .getByAltText("Gambar dalam percakapan")
          .evaluate((img) => (img as HTMLImageElement).naturalWidth),
      )
      .toBeGreaterThan(0);
    await fits(page);
    await fits(ownerPage);
    await ownerPage.getByRole("button", { name: "Laporkan pesan", exact: true }).last().click();
    await ownerPage
      .getByLabel("Alasan melaporkan pesan")
      .fill("Mengirim nomor telepon dan tautan eksternal.");
    await ownerPage.getByRole("button", { name: "Kirim laporan", exact: true }).click();
    await expect(
      ownerPage.getByText("Laporan sudah diterima untuk ditinjau admin.", { exact: true }),
    ).toBeVisible();
    const reported = await admin.request.get(`/api/admin/conversations/${room}`);
    expect(reported.status()).toBe(200);
    expect(JSON.stringify(await reported.json())).toContain("081234567890");
    await ownerPage.getByRole("button", { name: "Blokir", exact: true }).click();
    await expect(ownerPage.getByRole("button", { name: "Buka blokir", exact: true })).toBeVisible();
    await expect(
      page.getByText("Pesan tidak dapat dikirim karena salah satu pihak memblokir akun.", {
        exact: true,
      }),
    ).toBeVisible();
    await ownerPage.getByRole("button", { name: "Buka blokir", exact: true }).click();
    await expect(page.getByRole("button", { name: "Kirim pesan", exact: true })).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: test.info().outputPath("chat.png") });
    await page.goto("/chat");
    await expect(
      page.getByRole("link").filter({ hasText: "Pemilik E2E" }).locator("time"),
    ).toBeVisible();
    await fits(page);
    expect(errors).toEqual([]);
  } finally {
    await owner.close();
    await admin.close();
  }
});
