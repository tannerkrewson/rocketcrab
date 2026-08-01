import { defineConfig } from "@playwright/test";

// F4 spike e2e: three HTTPS origins (host 5273, runtime 5274, evil 5275),
// each a Vite dev server with a self-signed cert (ignoreHTTPSErrors).
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    ignoreHTTPSErrors: true,
    viewport: { width: 390, height: 844 }, // iPhone-ish viewport
    launchOptions: {
      // Fake media devices so getUserMedia can be exercised headlessly.
      // Software WebGL (SwiftShader) for headless.
      // NOTE: cross-origin process isolation (OOPIF) could not be forced in
      // this headless shell; see findings for the infinite-loop containment
      // caveat (must be verified on physical browsers).
      args: [
        "--use-fake-device-for-media-stream",
        "--use-fake-ui-for-media-stream",
        "--enable-unsafe-swiftshader",
        "--use-angle=swiftshader",
      ],
    },
  },
  webServer: [
    {
      command: "npm run gen-certs && npm run dev:host",
      url: "https://localhost:5273",
      ignoreHTTPSErrors: true,
      reuseExistingServer: true,
      timeout: 30_000,
    },
    {
      command: "npm run gen-certs && npm run dev:runtime",
      url: "https://localhost:5274",
      ignoreHTTPSErrors: true,
      reuseExistingServer: true,
      timeout: 30_000,
    },
    {
      command: "npm run gen-certs && npm run dev:evil",
      url: "https://localhost:5275",
      ignoreHTTPSErrors: true,
      reuseExistingServer: true,
      timeout: 30_000,
    },
    {
      command: "npm run gen-certs && npm run echo",
      port: 5276, // wss echo: accepts WebSocket upgrades, not plain HTTP — use a port check
      reuseExistingServer: true,
      timeout: 30_000,
    },
  ],
});
