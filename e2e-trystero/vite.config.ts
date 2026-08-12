// P1 e2e harness dev server. Same-machine loopback runs work over plain HTTP
// on localhost (a secure context, so Trystero's WebCrypto is available — F9).
// When locally-trusted certs are present at certs/key.pem + certs/cert.pem
// (same spike certs as F5, valid for localhost + LAN IP), the server serves
// HTTPS so the harness can also be opened from a physical phone on the LAN.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const here = path.dirname(fileURLToPath(import.meta.url));
const keyPath = path.resolve(here, "certs/key.pem");
const certPath = path.resolve(here, "certs/cert.pem");
const hasCerts = existsSync(keyPath) && existsSync(certPath);

export default defineConfig({
  server: {
    port: 5200,
    strictPort: true,
    host: true, // bind 0.0.0.0 so a physical phone on the LAN can reach it
    ...(hasCerts
      ? {
          https: {
            key: readFileSync(keyPath),
            cert: readFileSync(certPath),
          },
        }
      : {}),
  },
});
