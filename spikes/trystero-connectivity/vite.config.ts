// F5 spike dev server. HTTPS is REQUIRED for real-device testing: Trystero
// uses WebCrypto (crypto.subtle.importKey / digest) which only exists in
// secure contexts. Plain HTTP works on `localhost` (a secure context — which
// is why the automated suite passed) but NOT on a LAN IP, where
// `crypto.subtle` is undefined and room creation fails with
// "Cannot read properties of undefined (reading 'importKey')".
// Certs are the same locally-trusted spike certs as the F4 spike
// (valid for localhost + LAN IP; install/trust once per device).
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  server: {
    port: 5199,
    strictPort: true,
    host: true, // bind 0.0.0.0 so a physical phone on the LAN can reach it
    https: {
      key: readFileSync(path.resolve(here, "certs/key.pem")),
      cert: readFileSync(path.resolve(here, "certs/cert.pem")),
    },
  },
});
