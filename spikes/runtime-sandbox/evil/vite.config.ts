// Third, UNRELATED origin (origin C) used only to prove that a bootstrap
// attempt from a wrong origin is rejected. SPIKE only.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: here,
  server: {
    port: 5275,
    strictPort: true,
    host: true,
    https: {
      key: readFileSync(path.resolve(here, "../certs/key.pem")),
      cert: readFileSync(path.resolve(here, "../certs/cert.pem")),
    },
  },
});
