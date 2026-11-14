import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./presence-e2e",
  timeout: 60000,
  workers: 1,
  use: { baseURL: "http://127.0.0.1:5200", ...devices["Desktop Chrome"] },
});
