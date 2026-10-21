import { expect, test } from "@playwright/test";
test("navigasi menyesuaikan perangkat dan tidak meluber", async ({ page }, info) => {
  const response = await page.goto("/");
  expect(response?.headers()["content-security-policy"]).not.toContain("upgrade-insecure-requests");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Nggak harus punya");
  await expect(page.getByRole("navigation", { name: "Navigasi seluler" })).toBeVisible({
    visible: info.project.name !== "chromium-desktop",
  });
  await expect(page.getByRole("navigation", { name: "Navigasi utama" })).toBeVisible({
    visible: info.project.name === "chromium-desktop",
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.getByRole("link", { name: "Yuk, kenalan dulu" }).click();
  await expect(page).toHaveURL(/\/masuk$/);
});
test("login menampilkan angka, QR desktop, dan deep link yang sesuai", async ({ page }, info) => {
  await page.route("**/api/auth/telegram/start", (route) =>
    route.fulfill({
      json: {
        id: "00000000-0000-4000-8000-000000000001",
        matchCode: "47",
        deepLink: "https://t.me/SewaMatesDevBot?start=example",
        expiresAt: new Date(Date.now() + 600000).toISOString(),
      },
      status: 201,
    }),
  );
  await page.route("**/api/auth/telegram/status/*", (route) =>
    route.fulfill({ json: { status: "menunggu" } }),
  );
  await page.goto("/masuk");
  await page.getByRole("button", { name: "Masuk dengan Telegram" }).click();
  await expect(page.getByText("47", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Buka aplikasi Telegram" })).toHaveAttribute(
    "href",
    "tg://resolve?domain=SewaMatesDevBot&start=example",
  );
  const telegramWeb = page.getByRole("link", { name: "Buka Telegram Web" });
  await expect(telegramWeb).toHaveAttribute(
    "href",
    `https://web.telegram.org/k/#?tgaddr=${encodeURIComponent("tg://resolve?domain=SewaMatesDevBot&start=example")}`,
  );
  await page
    .context()
    .route("https://web.telegram.org/**", (route) =>
      route.fulfill({ contentType: "text/html", body: "<title>Telegram Web test</title>" }),
    );
  const popupPromise = page.waitForEvent("popup");
  await telegramWeb.click();
  const popup = await popupPromise;
  await expect(popup).toHaveURL(/https:\/\/web\.telegram\.org\/k\//);
  await popup.close();
  await expect(page.getByText("47", { exact: true })).toBeVisible();
  await expect(page.getByAltText("Pindai QR untuk membuka bot login di HP")).toBeVisible({
    visible: info.project.name === "chromium-desktop",
  });
});
test("permintaan kedaluwarsa memberi pilihan login ulang", async ({ page }) => {
  await page.route("**/api/auth/telegram/start", (route) =>
    route.fulfill({
      json: {
        id: "00000000-0000-4000-8000-000000000001",
        matchCode: "47",
        deepLink: "https://t.me/SewaMatesDevBot?start=example",
        expiresAt: new Date(Date.now() + 600000).toISOString(),
      },
    }),
  );
  await page.route("**/api/auth/telegram/status/*", (route) =>
    route.fulfill({ json: { status: "kedaluwarsa" } }),
  );
  await page.goto("/masuk");
  await page.getByRole("button", { name: "Masuk dengan Telegram" }).click();
  await expect(page.getByRole("button", { name: "Coba login lagi" })).toBeVisible({
    timeout: 10000,
  });
});
test("halaman privat mengarahkan pengunjung ke login dan API menolak CSRF", async ({
  page,
  request,
}) => {
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/masuk$/);
  const response = await request.patch("/api/me", {
    headers: { origin: "https://attacker.example" },
    data: { name: "Attacker" },
  });
  expect(response.status()).toBe(403);
  const privateResponse = await request.get("/api/admin/verifications");
  expect(privateResponse.status()).toBe(401);
});
