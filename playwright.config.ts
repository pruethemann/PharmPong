import { defineConfig, devices } from "@playwright/test";
import { BASE_URL, E2E_ENV, PORT } from "./tests/e2e/support/env";

const CI = !!process.env.CI;

/**
 * End-to-end suite against a production build (`next build` + `next start`) on port 3100
 * with its own database (pharmapong_e2e) and build dir (.next-e2e).
 * Tests share one database, so everything runs serially (workers: 1); specs that need a
 * particular tournament state reset it in beforeAll via `pnpm scenario <mode>`.
 *
 * Tags: @desktop-only specs are skipped on the phone projects, @mobile-only specs on desktop.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "**/*.spec.ts",
  globalSetup: "./tests/e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: CI ? [["list"], ["html", { open: "never" }]] : [["list"]],
  outputDir: "test-results",
  use: {
    baseURL: BASE_URL,
    locale: "de-CH",
    timezoneId: "Europe/Zurich",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } },
      grepInvert: /@mobile-only/,
    },
    {
      name: "mobile",
      use: { ...devices["Pixel 7"] },
      grepInvert: /@desktop-only/,
    },
    {
      name: "iphone",
      // No WebKit installed: iPhone 14 viewport + user agent on Chromium.
      use: { ...devices["iPhone 14"], browserName: "chromium", defaultBrowserType: "chromium" },
      grepInvert: /@desktop-only/,
    },
  ],
  webServer: {
    command: `pnpm build && pnpm start -p ${PORT}`,
    url: `${BASE_URL}/api/health`,
    env: E2E_ENV,
    reuseExistingServer: !CI,
    timeout: 10 * 60_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
