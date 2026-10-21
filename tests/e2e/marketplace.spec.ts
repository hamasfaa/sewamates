import { expect, test, type Page } from "@playwright/test";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const campus = {
  id: uuid(900),
  name: "Institut Teknologi Sepuluh Nopember",
  domains: ["its.ac.id"],
  isActive: true,
};
const category = { id: uuid(901), name: "Kamera & Foto" };
const card = (n: number) => ({
  id: uuid(n),
  title: `Kamera mirrorless lengkap dengan lensa kit nomor ${n}`,
  pricePerDay: 50_000 + n * 1_000,
  ratingAvg: 0,
  ratingCount: 0,
  isNew: n < 3,
  thumbUrl: null,
  pointName: "Lobi Perpustakaan Pusat",
  categoryName: category.name,
  campus: "ITS",
});
// Search runs against mocked APIs so the layout is tested without a database.
async function mockMarketplace(page: Page) {
  const requests: URL[] = [];
  await page.route(
    (url) => url.pathname === "/api/categories",
    (route) => route.fulfill({ json: [category] }),
  );
  await page.route(
    (url) => url.pathname === "/api/campuses",
    (route) => route.fulfill({ json: [campus] }),
  );
  await page.route(
    (url) => url.pathname === "/api/pickup-points",
    (route) => route.fulfill({ json: [{ id: uuid(902), name: "Lobi Perpustakaan Pusat" }] }),
  );
  await page.route(
    (url) => url.pathname === "/api/items",
    (route) => {
      const url = new URL(route.request().url());
      requests.push(url);
      const next = url.searchParams.get("cursor");
      return route.fulfill({
        json: next
          ? { items: [card(21)], nextCursor: null, sort: "relevan" }
          : {
              items: Array.from({ length: 20 }, (_, i) => card(i + 1)),
              nextCursor: "halaman-2",
              sort: url.searchParams.get("q") ? "relevan" : "terbaru",
            },
      });
    },
  );
  return requests;
}

test("pencarian menampilkan grid, filter sesuai perangkat, dan halaman berikutnya", async ({
  page,
}, info) => {
  const requests = await mockMarketplace(page);
  await page.goto("/cari?q=kamera");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Hasil untuk “kamera”");
  const results = page.getByRole("list", { name: "Hasil pencarian" }).getByRole("listitem");
  await expect(results).toHaveCount(20);
  await expect(page.getByText("Baru", { exact: true }).first()).toBeVisible();
  expect(requests[0].searchParams.get("q")).toBe("kamera");
  const desktop = info.project.name === "chromium-desktop";
  await expect(page.getByRole("heading", { name: "Filter", exact: true })).toBeVisible({
    visible: desktop,
  });
  if (!desktop) {
    await page.getByRole("button", { name: "Filter" }).click();
    const sheet = page.getByRole("dialog", { name: "Filter" });
    await expect(sheet).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  // Scrolling near the end triggers the next page (the button is the no-observer fallback).
  await results.last().scrollIntoViewIfNeeded();
  await expect(results).toHaveCount(21);
  await expect(page.getByText("Sudah sampai ujung daftar.")).toBeVisible();
  expect(requests.some((url) => url.searchParams.get("cursor") === "halaman-2")).toBe(true);
});

test("filter kategori memperbarui URL, permintaan, dan chip yang bisa dihapus", async ({
  page,
}, info) => {
  const requests = await mockMarketplace(page);
  await page.goto("/cari");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Barang dari teman kampus");
  if (info.project.name !== "chromium-desktop")
    await page.getByRole("button", { name: "Filter" }).click();
  await page.getByLabel("Kategori").selectOption(category.id);
  await page.getByRole("button", { name: "Terapkan filter" }).click();
  await expect(page).toHaveURL(new RegExp(`category=${category.id}`));
  await expect.poll(() => requests.at(-1)?.searchParams.get("category")).toBe(category.id);
  const chip = page.getByRole("button", { name: `Hapus filter ${category.name}` });
  await expect(chip).toBeVisible();
  await chip.click();
  await expect(page).not.toHaveURL(/category=/);
  await expect(page.getByRole("list", { name: "Hasil pencarian" }).getByRole("listitem")).toHaveCount(
    20,
  );
});

test("halaman pemilik dan API listing tetap terlindungi", async ({ page, request }) => {
  for (const path of ["/sewakan", `/barang/${uuid(1)}/ubah`, `/barang/${uuid(1)}/kalender`]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/masuk$/);
  }
  expect((await request.get("/api/me/items")).status()).toBe(401);
  expect((await request.get("/api/admin/items/pending")).status()).toBe(401);
  const forged = await request.post("/api/items", {
    headers: { origin: "https://attacker.example" },
    data: {},
  });
  expect(forged.status()).toBe(403);
});
