import { defineConfig } from "@playwright/test";
const port = Number(process.env.E2E_PORT || 3000);
export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "html" : "list",
  use: { baseURL: `http://localhost:${port}`, trace: "retain-on-failure" },
  webServer: {
    command: `npm run start -- --hostname 127.0.0.1 --port ${port}`,
    url: `http://127.0.0.1:${port}/api/health`,
    reuseExistingServer: false,
    timeout: 120000,
  },
  projects: [
    {
      name: "chromium-mobile",
      use: { browserName: "chromium", viewport: { width: 360, height: 800 } },
    },
    {
      name: "chromium-desktop",
      use: { browserName: "chromium", viewport: { width: 1440, height: 900 } },
    },
    {
      name: "webkit-mobile",
      use: {
        browserName: "webkit",
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
    },
    {
      name: "chromium-tablet",
      use: { browserName: "chromium", viewport: { width: 768, height: 1024 } },
    },
  ],
});
