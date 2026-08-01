import { defineConfig, devices } from "@playwright/test";

// Spike-scoped E2E config. Serves the harness page with vite on :5199 and
// runs the multi-page peer simulation. Same-machine/loopback only — the
// cross-device scenarios are covered by the manual checklist in
// docs/testing/physical-device-checklist-f5.md.
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 1,
  timeout: 120_000,
  expect: { timeout: 20_000 },
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://localhost:5199",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "node ../../node_modules/vite/bin/vite.js --port 5199 --strictPort",
    url: "http://localhost:5199",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
