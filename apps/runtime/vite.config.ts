import { defineConfig } from "vite";

// Static origin for the isolated game runtime.
// In production this is deployed to a separate origin (runtime.nova.example).
// The dev server listens on a distinct port so both origins run locally.
export default defineConfig({
  server: {
    port: 5174,
  },
});
