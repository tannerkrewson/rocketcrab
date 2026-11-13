// Real-browser Trystero integration against the local edge signaling relay.
// Run separately with `npm run test:e2e:trystero`; relay failures fail tests.
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

const here = path.dirname(fileURLToPath(import.meta.url));
const hasCerts =
  existsSync(path.join(here, "certs/key.pem")) && existsSync(path.join(here, "certs/cert.pem"));
const baseURL = hasCerts ? "https://localhost:5200" : "http://localhost:5200";
const viteBin = path.join(here, "..", "node_modules", "vite", "bin", "vite.js");

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 300_000,
  expect: { timeout: 30_000 },
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    ignoreHTTPSErrors: true, // local spike certs are self-signed
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command:
        "npm run edge:dev -- --port 18787 --var ORIGIN_ALLOWLIST:http://localhost:5200,https://localhost:5200",
      cwd: path.join(here, ".."),
      port: 18787,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: `node ${viteBin} --port 5200 --strictPort`,
      cwd: here,
      url: baseURL,
      reuseExistingServer: !process.env.CI,
      ignoreHTTPSErrors: true,
      timeout: 60_000,
    },
  ],
});
