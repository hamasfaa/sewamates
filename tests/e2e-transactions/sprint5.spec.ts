import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { Pool } from "pg";
import QRCode from "qrcode";
import { transactionFixtures } from "../fixtures/transactions-data";
import { e2eAppUrl, e2eDatabaseUrl } from "../fixtures/transactions-env";

async function call<T = Record<string, unknown>>(
  request: APIRequestContext,
  path: string,
  data?: unknown,
): Promise<T> {
  const r =
    data === undefined
      ? await request.get(path)
      : await request.post(path, {
          headers: { Origin: e2eAppUrl, "Idempotency-Key": crypto.randomUUID() },
          data,
        });
  const b = await r.json();
  expect(r.ok(), `${path}: ${JSON.stringify(b)}`).toBe(true);
  return b as T;
}
async function login(page: Page, token: string) {
  await page
    .context()
    .addCookies([
      { name: "sm_session", value: token, url: e2eAppUrl, httpOnly: true, sameSite: "Lax" },
    ]);
}
async function overflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
}
async function paid(
  request: APIRequestContext,
  owner: APIRequestContext,
  admin: APIRequestContext,
  f: Awaited<ReturnType<typeof transactionFixtures>>,
) {
  const account = await call<{ id: string }>(admin, "/api/admin/platform-accounts", {
    type: "bank",
    provider: "BCA",
    accountNo: "0123456789",
    accountName: "Platform Uji",
  });
  const { id } = await call<{ id: string }>(request, "/api/rentals", {
    itemId: f.itemId,
    pickupPointId: f.pointId,
    startAt: new Date(`${f.start}:00+07:00`).toISOString(),
    days: 1,
  });
  await call(owner, `/api/rentals/${id}/approve`, { version: 1 });
  const d = await call<{ rental: { amountDue: number } }>(request, `/api/rentals/${id}`);
  const bytes = await QRCode.toBuffer(crypto.randomUUID(), { width: 160 }),
    upload = await call<{ path: string; signedUrl: string }>(request, "/api/uploads/sign", {
      purpose: "payment_proof",
      contentType: "image/png",
      size: bytes.length,
    });
  expect(
    (
      await request.put(upload.signedUrl, { headers: { "Content-Type": "image/png" }, data: bytes })
    ).ok(),
  ).toBe(true);
  const proof = await call<{ id: string }>(request, `/api/rentals/${id}/payments`, {
    platformAccountId: account.id,
    proofPath: upload.path,
    senderName: "Penyewa Uji",
    transferredAt: new Date(Date.now() - 60000).toISOString(),
    claimedAmount: d.rental.amountDue,
  });
  const current = await call<{ rental: { version: number } }>(request, `/api/rentals/${id}`);
  await call(admin, `/api/admin/payments/${proof.id}/decision`, {
    decision: "diterima",
    version: current.rental.version,
    verifiedAmount: d.rental.amountDue,
  });
  return { id, account, amount: d.rental.amountDue };
}
test("Sprint 5: tanggapan, putusan bagi dana, ulasan dua pihak dan rating publik", async ({
  page,
  browser,
}, info) => {
  const f = await transactionFixtures(),
    pool = new Pool({ connectionString: e2eDatabaseUrl() }),
    ownerContext = await browser.newContext({
      baseURL: e2eAppUrl,
      viewport: info.project.use.viewport,
    }),
    adminContext = await browser.newContext({
      baseURL: e2eAppUrl,
      viewport: info.project.use.viewport,
    });
  const owner = await ownerContext.newPage(),
    admin = await adminContext.newPage(),
    errors: string[] = [];
  for (const p of [page, owner, admin]) p.on("pageerror", (e) => errors.push(e.message));
  try {
    await login(page, f.renter.token);
    await login(owner, f.owner.token);
    await login(admin, f.admin.token);
    const r = await paid(page.request, owner.request, admin.request, f);
    await pool.query("UPDATE rentals SET status='BERJALAN' WHERE id=$1", [r.id]);
    const opened = await call<{ disputeId: string }>(
      owner.request,
      `/api/rentals/${r.id}/disputes`,
      {
        category: "rusak",
        description: "Ada kerusakan yang perlu ditinjau bersama admin.",
        evidencePaths: [],
      },
    );
    await page.goto(`/transaksi/${r.id}`);
    await page
      .getByLabel("Tanggapan sengketa")
      .fill("Kondisi ini sudah kami dokumentasikan sejak serah terima.");
    await page.getByRole("button", { name: "Kirim tanggapan" }).click();
    await expect(
      page.getByText("Kondisi ini sudah kami dokumentasikan sejak serah terima."),
    ).toBeVisible();
    await overflow(page);
    await admin.goto("/admin/sengketa");
    await admin.getByRole("button", { name: "Lihat bukti" }).click();
    await expect(
      admin.getByText("Kondisi ini sudah kami dokumentasikan sejak serah terima."),
    ).toBeVisible();
    await admin.getByLabel("Jenis putusan").selectOption("bagi_dana");
    await admin.getByLabel("Bagian pemilik (Rp)").fill("70000");
    await admin.getByLabel("Bagian penyewa (Rp)").fill(String(r.amount - 75000));
    await admin
      .getByLabel("Alasan putusan")
      .fill("Kedua bukti telah diperiksa dan kerusakan diselesaikan melalui pembagian dana.");
    await admin.getByRole("button", { name: "Simpan putusan" }).click();
    await expect(page.getByRole("heading", { name: "Ulasan transaksi", exact: true })).toBeVisible({
      timeout: 20000,
    });
    await overflow(admin);
    await page.getByLabel("Bintang").selectOption("4");
    await page.getByLabel("Komentar (opsional)").fill("Komunikasi baik selama proses mediasi.");
    await page.getByRole("button", { name: "Kirim ulasan" }).click();
    await expect
      .poll(async () => await call<unknown[]>(page.request, `/api/items/${f.itemId}/reviews`))
      .toHaveLength(0);
    await owner.goto(`/transaksi/${r.id}`);
    await owner.getByLabel("Bintang").selectOption("5");
    await owner.getByRole("button", { name: "Kirim ulasan" }).click();
    await expect
      .poll(async () => await call<unknown[]>(page.request, `/api/items/${f.itemId}/reviews`))
      .toHaveLength(1);
    await page.goto(`/barang/${f.itemId}`);
    await expect(page.getByText("Komunikasi baik selama proses mediasi.")).toBeVisible();
    await overflow(page);
    expect(
      (await pool.query("SELECT status,outcome FROM disputes WHERE id=$1", [opened.disputeId]))
        .rows[0],
    ).toEqual({ status: "diputuskan", outcome: "bagi_dana" });
    expect(errors).toEqual([]);
  } finally {
    await ownerContext.close();
    await adminContext.close();
    await pool.end();
  }
});
test("Sprint 5: laporan listing ditangani admin dan pemberitahuan pelapor", async ({
  page,
  browser,
}, info) => {
  const f = await transactionFixtures(),
    adminContext = await browser.newContext({
      baseURL: e2eAppUrl,
      viewport: info.project.use.viewport,
    }),
    admin = await adminContext.newPage();
  try {
    await login(page, f.renter.token);
    await login(admin, f.admin.token);
    await page.goto(`/barang/${f.itemId}`);
    await page.getByRole("button", { name: "Laporkan listing" }).click();
    await page
      .getByLabel("Alasan laporan")
      .selectOption({ label: "Penipuan atau informasi palsu" });
    await page
      .getByLabel("Penjelasan tambahan")
      .fill("Deskripsi listing perlu ditinjau karena informasinya tidak cocok.");
    await page.getByRole("button", { name: "Kirim laporan", exact: true }).click();
    await expect(page.getByText("Laporan terkirim. Admin akan meninjaunya.")).toBeVisible();
    await admin.goto("/admin/laporan");
    await admin.getByRole("button", { name: "Tinjau laporan" }).click();
    await admin.getByLabel("Tindakan", { exact: true }).selectOption("sembunyikan");
    await admin
      .getByLabel("Alasan keputusan")
      .fill("Informasi tidak sesuai sehingga listing harus diperbaiki dan ditinjau ulang.");
    await admin.getByRole("button", { name: "Putuskan laporan" }).click();
    await expect(admin.getByText("Tidak ada laporan menunggu.")).toBeVisible();
    await overflow(admin);
    await page.goto("/notifikasi");
    await expect(page.getByText("Laporanmu sudah ditangani")).toBeVisible();
    await overflow(page);
  } finally {
    await adminContext.close();
  }
});
test("Sprint 5: cari pengguna, tangguhkan/aktifkan, rekonsiliasi dan ekspor CSV", async ({
  page,
}) => {
  const f = await transactionFixtures(),
    pool = new Pool({ connectionString: e2eDatabaseUrl() });
  try {
    await login(page, f.admin.token);
    const account = await call<{ id: string }>(page.request, "/api/admin/platform-accounts", {
      type: "bank",
      provider: "BCA",
      accountNo: "0123456789",
      accountName: "Platform Uji",
    });
    await page.goto("/admin/pengguna");
    await expect(page.getByRole("button", { name: "Lihat riwayat" })).toHaveCount(4);
    await page.getByLabel("Cari nama, HP, atau kode transaksi").fill("Penyewa E2E");
    await page.getByRole("button", { name: "Cari", exact: true }).click();
    await expect(page.getByRole("button", { name: "Lihat riwayat" })).toHaveCount(1);
    await page.getByRole("button", { name: "Lihat riwayat" }).click();
    await page.getByLabel("Tindakan", { exact: true }).selectOption("suspend");
    await page
      .getByLabel("Alasan tindakan")
      .fill("Akun ditinjau untuk memastikan pelanggaran yang dilaporkan.");
    await page.getByRole("button", { name: "Simpan", exact: true }).click();
    await expect
      .poll(
        async () =>
          (await pool.query("SELECT account_status FROM users WHERE id=$1", [f.renter.id])).rows[0]
            .account_status,
      )
      .toBe("ditangguhkan");
    await page.getByLabel("Tindakan", { exact: true }).selectOption("reactivate");
    await page
      .getByLabel("Alasan tindakan")
      .fill("Peninjauan selesai dan akun sudah dapat digunakan kembali.");
    await page.getByRole("button", { name: "Simpan", exact: true }).click();
    await expect
      .poll(
        async () =>
          (await pool.query("SELECT account_status FROM users WHERE id=$1", [f.renter.id])).rows[0]
            .account_status,
      )
      .toBe("aktif");
    await overflow(page);
    await page.goto("/admin/rekonsiliasi");
    const date = new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
    await page.getByLabel("Tanggal (WIB)").fill(date);
    await page.getByLabel("Rekening platform", { exact: true }).selectOption(account.id);
    await page.getByLabel("Saldo aktual (Rp)").fill("1000");
    await page
      .getByLabel("Catatan selisih")
      .fill("Ada saldo aktual yang perlu ditelusuri pada mutasi rekening.");
    await page.getByRole("button", { name: "Simpan", exact: true }).click();
    await expect(page.getByText("Selisih Rp1.000")).toBeVisible();
    await overflow(page);
    const csv = await page.request.get("/api/admin/recap?format=csv");
    expect(csv.headers()["content-type"]).toContain("text/csv");
    expect(await csv.text()).toContain("status,jumlah,nilai_sewa,dana_diterima");
  } finally {
    await pool.end();
  }
});
test("Sprint 5: privasi mengelola blokir dan memerlukan konfirmasi Telegram untuk hapus akun", async ({
  page,
}) => {
  const f = await transactionFixtures();
  await login(page, f.renter.token);
  await page.goto("/profil/privasi");
  await expect(page.getByRole("heading", { name: "Pengguna diblokir" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Minta hapus akun" })).toBeDisabled();
  await page.getByLabel("Saya memahami dan ingin menghapus akun ini.").check();
  await page.getByRole("button", { name: "Minta hapus akun" }).click();
  await expect(
    page.getByText("Buka bot dan tekan Start untuk mengonfirmasi hapus akun."),
  ).toBeVisible();
  await overflow(page);
  for (const method of ["GET", "POST", "DELETE"]) {
    const response = await page.request.fetch("/api/me/push", {
      method,
      headers: { Origin: e2eAppUrl },
      ...(method === "GET" ? {} : { data: {} }),
    });
    expect(response.status()).toBe(404);
  }
  expect(
    (
      await page.request.put("/api/me/push/preferences", {
        headers: { Origin: e2eAppUrl },
        data: { chat: true },
      })
    ).status(),
  ).toBe(404);
  await expect(page.locator('link[rel="manifest"]')).toHaveCount(0);
  for (const path of ["/push-sw.js", "/manifest.webmanifest"]) {
    const response = await page.request.get(path);
    // A streamed Next.js not-found page can retain status 200.
    expect(response.headers()["content-type"]).toContain("text/html");
    expect(await response.text()).toContain("Sepertinya salah jalan");
  }
});
