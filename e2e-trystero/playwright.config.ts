// P1 real-browser integration tests for TrysteroTransport (external network).
//
// NOT part of the default `npm run test:e2e` (CI smoke) — run with
// `npm run test:e2e:trystero`. These specs exercise the full Trystero
// protocol stack (real Nostr relays + WebRTC) between pages on one machine,
// modeled on the F5 spike. They are resilient by design: when the external
// relays are unreachable the adapter's join fails with `relay_unreachable`
// and the specs SKIP instead of failing CI.
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
  timeout: 300_000, // discovery on real relays takes 20-25 s (F5 F3)
  expect: { timeout: 30_000 },
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    ignoreHTTPSErrors: true, // local spike certs are self-signed
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `node ${viteBin} --port 5200 --strictPort`,
    cwd: here,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    ignoreHTTPSErrors: true,
    timeout: 60_000,
  },
});
