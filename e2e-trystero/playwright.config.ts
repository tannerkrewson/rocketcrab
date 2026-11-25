// Real-browser Trystero integration against the local edge signaling relay.
// Run separately with `npm run test:e2e:trystero`; relay failures fail tests.
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

const here = path.dirname(fileURLToPath(import.meta.url));
const hasCerts =
  existsSync(path.join(here, "certs/key.pem")) && existsSync(path.join(here, "certs/cert.pem"));
const baseURL = hasCerts ? "https://localhost:2725" : "http://localhost:2725";
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
    ignoreHTTPSErrors: true, // Local certificates are self-signed.
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command:
        "npm run dev:api -- --port 2726 --inspector-port 2728" +
        (hasCerts
          ? " --local-protocol https --https-key-path e2e-trystero/certs/key.pem --https-cert-path e2e-trystero/certs/cert.pem"
          : ""),
      cwd: path.join(here, ".."),
      port: 2726,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: `node ${viteBin} --port 2725 --strictPort`,
      cwd: here,
      url: baseURL,
      reuseExistingServer: !process.env.CI,
      ignoreHTTPSErrors: true,
      timeout: 60_000,
    },
  ],
});
