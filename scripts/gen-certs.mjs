// Generates throwaway self-signed certs for local HTTPS development of both
// origins (M2, `npm run dev:https`). The certs are gitignored — local
// tooling only, never production. Idempotent: skips when certs already
// exist. Generalised from the F4 spike's dev-cert generator
// (spike removed in release cleanup).
//
// Usage:
//   node scripts/gen-certs.mjs                # localhost only
//   node scripts/gen-certs.mjs 192.168.1.10   # also trust a LAN IP for physical devices
//
// After generation, `npm run dev:https` serves both origins over HTTPS:
// the nova app on https://localhost:5173 and the runtime origin on
// https://localhost:5174 (the two-origin derivation swaps ports in dev).
import { execSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const certDir = path.resolve(here, "../.certs");
const cert = path.join(certDir, "localhost-cert.pem");
const key = path.join(certDir, "localhost-key.pem");
// Optional LAN IP for physical-device testing (e.g. `node scripts/gen-certs.mjs 192.168.1.10`).
const lanIp = process.argv[2] ?? "";

if (existsSync(cert) && existsSync(key)) {
  console.log("[gen-certs] certs already present, skipping");
  process.exit(0);
}

mkdirSync(certDir, { recursive: true });
const san = `DNS:localhost,IP:127.0.0.1${lanIp ? `,IP:${lanIp}` : ""}`;
execSync(
  `openssl req -x509 -newkey rsa:2048 -keyout ${key} -out ${cert} -days 30 -nodes -subj "/CN=localhost" -addext "subjectAltName=${san}"`,
  { stdio: "inherit" },
);
console.log(`[gen-certs] generated self-signed certs in ${certDir}`);
