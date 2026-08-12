import { TanStackRouterVite } from "@tanstack/router-plugin/vite";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";
import { defineConfig } from "vite";

// Local HTTPS dev certs (scripts/gen-certs.mjs). `npm run dev:https` starts
// the dev server with `--mode https`; the server uses HTTPS only then, so
// plain `npm run dev` keeps working for contributors and e2e.
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

/**
 * Strict SPA CSP baked into the built index.html (M2; ADR-0001, ADR-0008).
 *
 * GitHub Pages cannot send custom response headers, so the main origin's
 * strict policy is delivered as a CSP meta tag produced at build time. The
 * runtime iframe is allowed only from the configured runtime origin
 * (`VITE_RUNTIME_ORIGIN`, set by the deploy workflow); without it,
 * `frame-src` falls back to `default-src 'self'` and the runtime frame is
 * blocked — a loud misconfiguration, never a silent loosening. The runtime
 * origin has NO CSP meta on purpose: it must keep ordinary web capabilities
 * for game HTML (permissive runtime policy, docs/architecture/deployment.md).
 */
function cspMetaPlugin(): Plugin {
  return {
    name: "nova-csp-meta",
    apply: "build",
    transformIndexHtml(html) {
      const rawOrigin = process.env.VITE_RUNTIME_ORIGIN?.trim() ?? "";
      if (rawOrigin === "") {
        console.warn(
          "[nova-csp-meta] VITE_RUNTIME_ORIGIN is not set: frame-src is omitted, so the " +
            "runtime iframe will be blocked by the strict CSP. The deploy workflow sets " +
            "this for every production deploy (docs/architecture/deployment.md).",
        );
      }
      const runtimeOrigin = rawOrigin === "" ? "" : new URL(rawOrigin).origin;
      const csp = [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "font-src 'self' data:",
        "connect-src 'self' wss: ws:",
        "media-src 'self' blob:",
        "worker-src 'self' blob:",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        ...(runtimeOrigin === "" ? [] : [`frame-src ${runtimeOrigin}`]),
      ].join("; ");
      return {
        html,
        tags: [
          {
            tag: "meta",
            attrs: { "http-equiv": "Content-Security-Policy", content: csp },
            injectTo: "head-prepend",
          },
        ],
      };
    },
  };
}

// The TanStack Router Vite plugin MUST be registered before the React plugin.
// Route tests are colocated with routes (repo convention) and are excluded
// from route-tree generation via the ignore pattern.
export default defineConfig(({ mode }) => ({
  plugins: [
    TanStackRouterVite({ target: "react", routeFileIgnorePattern: ".*\\.test\\.tsx$" }),
    react(),
    tailwindcss(),
    cspMetaPlugin(),
  ],
  server: {
    port: 5173,
    https: httpsServerConfig(mode),
  },
}));
