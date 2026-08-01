import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["src/test/setup.ts"],
    // Needed so @testing-library/react auto-cleans the DOM between tests.
    globals: true,
  },
});
