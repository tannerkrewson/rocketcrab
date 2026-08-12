import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    // Run tests as if served from the runtime origin so origin-derivation
    // and bootstrap-origin checks behave like the real app (dev port 5174).
    environmentOptions: {
      jsdom: { url: "http://localhost:5174/" },
    },
    include: ["src/**/*.test.ts"],
  },
});
