// Localhost HTTP is a secure context, so WebCrypto works without TLS.
// Trusted certs/key.pem and certs/cert.pem enable HTTPS for LAN phones.
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
