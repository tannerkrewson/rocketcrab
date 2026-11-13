import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "fallback-proof.spec.js",
  timeout: 45000,
  workers: 1,
  use: { baseURL: "http://localhost:5291", ...devices["Desktop Chrome"] },
  webServer: {
    command: "node ../node_modules/vite/bin/vite.js --port 5291 --strictPort",
    url: "http://localhost:5291/fallback.html",
    reuseExistingServer: !process.env.CI,
  },
});
