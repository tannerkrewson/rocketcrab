import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./scale-e2e",
  testMatch: ["scale-proof.spec.js", "scale-transport-proof.spec.js"],
  timeout: 150000,
  workers: 1,
  use: { baseURL: "http://localhost:5199", ...devices["Desktop Chrome"] },
});
