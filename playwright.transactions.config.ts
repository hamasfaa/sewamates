import { defineConfig } from "@playwright/test";
import { e2eAppUrl, e2eDatabaseUrl } from "./tests/fixtures/transactions-env";
e2eDatabaseUrl();
export default defineConfig({
  testDir: "tests/e2e-transactions",
  workers: 1,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  timeout: 90000,
  expect: { timeout: 15000 },
  reporter: "list",
  outputDir: "test-results/transactions",
  use: { baseURL: e2eAppUrl, trace: "retain-on-failure" },
  webServer: {
    command: "node --import tsx tests/fixtures/transactions-server.ts",
    url: `${e2eAppUrl}/api/health`,
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
