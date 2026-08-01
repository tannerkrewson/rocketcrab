// Host application (origin A). SPIKE only — U3 builds the real one.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: here,
  server: {
    port: 5273,
    strictPort: true,
    host: true, // bind 0.0.0.0 so a physical phone on the LAN can reach it
    https: {
      key: readFileSync(path.resolve(here, "../certs/key.pem")),
      cert: readFileSync(path.resolve(here, "../certs/cert.pem")),
    },
  },
});
