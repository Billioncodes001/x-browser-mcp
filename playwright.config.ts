import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "dashboard/tests",
  workers: 1,
  fullyParallel: false,
  timeout: 45000,
  retries: 0,
  reporter: [
    ["list"],
    ["json", { outputFile: "artifacts/dashboard-browser-results.json" }],
  ],
  use: {
    baseURL: `http://127.0.0.1:${process.env.X_BROWSER_TEST_PORT || 8794}`,
    channel: process.env.PLAYWRIGHT_CHANNEL || "chromium",
    viewport: { width: 1440, height: 1000 },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npx tsx test/dashboard-fixture.ts",
    url: `http://127.0.0.1:${process.env.X_BROWSER_TEST_PORT || 8794}`,
    timeout: 30000,
    reuseExistingServer: false,
  },
});
