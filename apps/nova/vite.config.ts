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
} from "./src/lib/catalog/index.ts";

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
      "Local HTTPS certs are missing. Run `npm run gen-certs` first (see deploy/README.md).",
    );
  }
  return { key: KEY, cert: CERT };
}

/**
 * Strict SPA CSP shared by index.html and Cloudflare asset headers.
 *
 * Only the configured runtime origin and static EXTERNAL_FRAME_ORIGINS
 * allowlist can be framed. Missing VITE_RUNTIME_ORIGIN intentionally blocks
 * the runtime instead of weakening the policy. The separate runtime origin
 * has no CSP meta tag so game HTML retains ordinary web capabilities
 * (deploy/README.md).
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
      const origin = runtimeOrigin();
      const mediaAllowlist = origin ? `(self "${origin}")` : "()";
      this.emitFile({
        type: "asset",
        fileName: "_headers",
        source: `/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: no-referrer\n  X-Frame-Options: DENY\n  Cross-Origin-Opener-Policy: same-origin\n  Permissions-Policy: camera=${mediaAllowlist}, microphone=${mediaAllowlist}, geolocation=(), payment=(), usb=()\n  Content-Security-Policy: ${buildCsp()}; frame-ancestors 'none'\n/assets/*\n  Cache-Control: public, max-age=31536000, immutable\n`,
      });
    },
  };
}

function runtimeOrigin(): string {
  const rawOrigin = process.env.VITE_RUNTIME_ORIGIN?.trim();
  return rawOrigin ? new URL(rawOrigin).origin : "";
}

function buildCsp(): string {
  const origin = runtimeOrigin();
  if (origin === "") {
    console.warn(
      "[nova-csp-meta] VITE_RUNTIME_ORIGIN is not set: frame-src has no runtime origin, so the " +
        "runtime iframe will be blocked by the strict CSP. The deploy script sets " +
        "this for every production deploy (deploy/README.md).",
    );
  }
  const challengeOrigin = "https://challenges.cloudflare.com";
  const frameSources = [
    ...(origin === "" ? [] : [origin]),
    challengeOrigin,
    ...EXTERNAL_FRAME_ORIGINS,
  ];
  // Explicit same-host WebSocket source for Safari versions where 'self'
  // does not match wss:. The deploy script already pins the app for the runtime.
  const mainOrigin = process.env.VITE_MAIN_ORIGIN?.trim();
  const socketSource = mainOrigin
    ? [new URL(mainOrigin).origin.replace(/^http/, "ws") + "/api/"]
    : [];
  const analyticsEnabled =
    /^G-[A-Z0-9]+$/.test(process.env.VITE_GA_MEASUREMENT_ID?.trim() ?? "") && Boolean(mainOrigin);
  const tagOrigin = analyticsEnabled ? ["https://www.googletagmanager.com"] : [];
  const analyticsOrigins = analyticsEnabled ? [...tagOrigin, "https://*.google-analytics.com"] : [];
  const clarityOrigins =
    /^[a-z0-9]+$/.test(process.env.VITE_CLARITY_PROJECT_ID?.trim() ?? "") && mainOrigin
      ? ["https://*.clarity.ms"]
      : [];
  const csp = [
    "default-src 'self'",
    ["script-src 'self'", challengeOrigin, ...tagOrigin, ...clarityOrigins].join(" "),
    "style-src 'self' 'unsafe-inline'",
    // Listed games' screenshots on their details pages.
    [
      "img-src 'self' data: blob:",
      ...CATALOG_IMAGE_ORIGINS,
      ...analyticsOrigins,
      ...clarityOrigins,
    ].join(" "),
    "font-src 'self' data:",
    // Listed games' direct room creation and hosted Nova games' HTML.
    [
      "connect-src 'self'",
      ...socketSource,
      ...CATALOG_CONNECT_ORIGINS,
      ...analyticsOrigins,
      ...clarityOrigins,
      ...(analyticsEnabled ? ["https://www.google.com", "https://analytics.google.com"] : []),
    ].join(" "),
    "media-src 'self' blob:",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    `frame-src ${frameSources.join(" ")}`,
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
  build: {
    rolldownOptions: {
      // Hash-only names: content blockers drop files named like trackers
      // (a shared chunk once took the name `clarity-*.js` and blanked the app).
      output: {
        entryFileNames: "assets/[hash].js",
        chunkFileNames: "assets/[hash].js",
        assetFileNames: "assets/[hash][extname]",
      },
    },
  },
  server: {
    port: 2722,
    strictPort: true,
    https: httpsServerConfig(mode),
    proxy: {
      "^/api(?:/|$)": {
        target: mode === "https" ? "https://127.0.0.1:2724" : "http://127.0.0.1:2724",
        secure: false, // The local Worker uses a development certificate.
        ws: true,
      },
    },
  },
}));
