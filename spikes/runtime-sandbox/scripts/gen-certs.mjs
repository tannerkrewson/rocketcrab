// Generates a throwaway self-signed cert for local HTTPS (host/runtime/evil
// dev servers). Idempotent: skips when certs already exist. The cert is
// gitignored — this is spike-only tooling, never production.
import { execSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const certDir = path.resolve(here, "../certs");
const cert = path.join(certDir, "cert.pem");
const key = path.join(certDir, "key.pem");

if (existsSync(cert) && existsSync(key)) {
  console.log("[gen-certs] certs already present, skipping");
  process.exit(0);
}

mkdirSync(certDir, { recursive: true });
execSync(
  `openssl req -x509 -newkey rsa:2048 -keyout ${key} -out ${cert} -days 30 -nodes -subj "/CN=localhost" -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"`,
  { stdio: "inherit" },
);
console.log(`[gen-certs] generated self-signed certs in ${certDir}`);
