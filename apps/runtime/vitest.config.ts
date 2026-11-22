import { defineConfig } from "vitest/config";
import { novaFrameScript } from "./vite.config";

export default defineConfig({
  plugins: [novaFrameScript()],
  test: {
    environment: "jsdom",
    // Run tests as if served from the runtime origin so origin-derivation
    // and bootstrap-origin checks behave like the real app (dev port 2723).
    environmentOptions: {
      jsdom: { url: "http://localhost:2723/" },
    },
    include: ["src/**/*.test.ts"],
  },
});
