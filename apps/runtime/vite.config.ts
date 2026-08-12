import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

// Local HTTPS dev certs (scripts/gen-certs.mjs) — same mechanism as the
// nova app (apps/nova/vite.config.ts). `npm run dev:https` starts the dev
// server with `--mode https`; plain `npm run dev` stays on HTTP.
const CERT_DIR = fileURLToPath(new URL("../../.certs", import.meta.url));
const CERT = join(CERT_DIR, "localhost-cert.pem");
const KEY = join(CERT_DIR, "localhost-key.pem");

/** Vite `server.https` config in `https` mode; `undefined` (plain HTTP) otherwise. */
function httpsServerConfig(mode: string) {
  if (mode !== "https") {
    return undefined;
  }
  if (!existsSync(CERT) || !existsSync(KEY)) {
    throw new Error(
      "Local HTTPS certs are missing. Run `npm run gen-certs` first (see docs/architecture/deployment.md).",
    );
  }
  return { key: KEY, cert: CERT };
}

// Static origin for the isolated game runtime.
// In production this is deployed to a separate origin (runtime.nova.example).
// The dev server listens on a distinct port so both origins run locally.
// Intentionally NO CSP meta: the runtime page must keep ordinary web
// capabilities for game HTML (permissive runtime policy — compensated by the
// separate origin, secret-free content, no service workers, and the strict
// main-origin policy; docs/architecture/deployment.md).
export default defineConfig(({ mode }) => ({
  server: {
    port: 5174,
    https: httpsServerConfig(mode),
  },
}));
