import { defineConfig, devices } from "@playwright/test";

// E2E smoke tests: the Nova home page renders, and the separate runtime
// origin (apps/runtime, dev port 5174) serves its page. The root `dev`
// script starts both apps via concurrently, matching local development.
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  // Vite's first request in a cold dev server compiles several routes. Three
  // browser projects hitting it concurrently can exceed the 5 s default even
  // though the app is healthy; a 15 s assertion window removes that false
  // failure without masking product timeouts (tests are still capped at 30 s).
  expect: { timeout: 15_000 },
  use: {
    baseURL: "http://localhost:5173",
    trace: "on-first-retry",
    navigationTimeout: 30_000,
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
  // Bound parallel browser memory use locally and in CI.
  workers: 3,
  webServer: {
    command: "npm run dev",
    url: "http://localhost:5173",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
