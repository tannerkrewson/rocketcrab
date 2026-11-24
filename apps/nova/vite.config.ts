import { TanStackRouterVite } from "@tanstack/router-plugin/vite";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";
import { defineConfig } from "vite";
import {
  CATALOG_CONNECT_ORIGINS,
  CATALOG_IMAGE_ORIGINS,
  EXTERNAL_FRAME_ORIGINS,
} from "./src/lib/catalog";

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
 * Strict SPA CSP shared by index.html and Cloudflare asset headers
 * (ADR-0001, ADR-0008).
 *
 * Only the configured runtime origin and static EXTERNAL_FRAME_ORIGINS
 * allowlist can be framed. Missing VITE_RUNTIME_ORIGIN intentionally blocks
 * the runtime instead of weakening the policy. The separate runtime origin
 * has no CSP meta tag so game HTML retains ordinary web capabilities
 * (docs/architecture/deployment.md).
 */
function cspMetaPlugin(): Plugin {
  return {
    name: "nova-csp-meta",
    apply: "build",
    transformIndexHtml(html) {
      const csp = buildCsp();
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
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "_headers",
        source: `/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: no-referrer\n  X-Frame-Options: DENY\n  Cross-Origin-Opener-Policy: same-origin\n  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()\n  Content-Security-Policy: ${buildCsp()}; frame-ancestors 'none'\n/assets/*\n  Cache-Control: public, max-age=31536000, immutable\n`,
      });
    },
  };
}

function buildCsp(): string {
  const rawOrigin = process.env.VITE_RUNTIME_ORIGIN?.trim() ?? "";
  if (rawOrigin === "") {
    console.warn(
      "[nova-csp-meta] VITE_RUNTIME_ORIGIN is not set: frame-src is omitted, so the " +
        "runtime iframe will be blocked by the strict CSP. The deploy script sets " +
        "this for every production deploy (docs/architecture/deployment.md).",
    );
  }
  const runtimeOrigin = rawOrigin === "" ? "" : new URL(rawOrigin).origin;
  const frameSources = [
    ...(runtimeOrigin === "" ? [] : [runtimeOrigin]),
    ...EXTERNAL_FRAME_ORIGINS,
  ];
  // Nova edge Worker (room relay + TURN mint), when the build sets one.
  const edgeOrigin = process.env.VITE_EDGE_ORIGIN?.trim() ?? "";
  const edgeConnectSrc = edgeOrigin === "" ? "" : ` ${new URL(edgeOrigin).origin}`;
  const csp = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    // Listed games' screenshots on their details pages.
    ["img-src 'self' data: blob:", ...CATALOG_IMAGE_ORIGINS].join(" "),
    "font-src 'self' data:",
    // Listed games' direct room creation and hosted Nova games' HTML.
    [`connect-src 'self' wss: ws:${edgeConnectSrc}`, ...CATALOG_CONNECT_ORIGINS].join(" "),
    "media-src 'self' blob:",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    ...(frameSources.length === 0 ? [] : [`frame-src ${frameSources.join(" ")}`]),
  ].join("; ");
  return csp;
}

// The TanStack Router Vite plugin MUST be registered before the React plugin.
// Route tests are colocated with routes (repo convention) and are excluded
// from route-tree generation via the ignore pattern.
export default defineConfig(({ mode }) => ({
  plugins: [
    TanStackRouterVite({
      target: "react",
      autoCodeSplitting: true,
      routeFileIgnorePattern: ".*\\.test\\.tsx$",
    }),
    react(),
    tailwindcss(),
    cspMetaPlugin(),
  ],
  server: {
    port: 2722,
    strictPort: true,
    https: httpsServerConfig(mode),
  },
}));
