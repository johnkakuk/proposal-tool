import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests against the full local stack: Supabase (`pnpm db:start`), plus the
 * Worker and Vite dev servers, which Playwright starts if they aren't already running.
 */
export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  use: { baseURL: "http://localhost:5173", trace: "retain-on-failure", ...devices["Desktop Chrome"], viewport: { width: 1440, height: 1000 } },
  webServer: { command: "pnpm dev", url: "http://localhost:5173/api/health", reuseExistingServer: true, timeout: 120_000 },
});
