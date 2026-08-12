/**
 * Host-side mirror of the runtime's origin derivation (ADR-0001; the
 * original lives in apps/runtime/src/origins.ts and must stay in sync):
 * the runtime app is served from its own origin (dev `localhost:5174`,
 * production a `runtime.*` subdomain), so the Nova shell derives the runtime
 * origin from its own location.
 *
 * Production builds may pin the origin and base path explicitly (M2): the
 * deploy workflow bakes the exact runtime origin into the iframe URL and
 * the strict CSP frame-src (docs/architecture/deployment.md). Pinning is
 * required whenever the runtime origin is NOT a `runtime.` subdomain of the
 * main origin (strategies (b)/(c)).
 */

export const RUNTIME_ORIGIN_PORT = 5174;
const RUNTIME_HOSTNAME_PREFIX = "runtime.";

/** Build-time pin for the runtime origin (M2 deploy workflow input). */
function runtimeOriginOverride(): string {
  const raw = import.meta.env.VITE_RUNTIME_ORIGIN;
  return typeof raw === "string" ? raw.trim() : "";
}

/** Build-time base path of the runtime site (project-site layouts, M2). */
function runtimeBaseOverride(): string {
  const raw = import.meta.env.VITE_RUNTIME_BASE;
  return typeof raw === "string" ? raw.trim() : "";
}

/** The runtime origin for the main Nova origin this page is served from. */
export function runtimeOriginForMainOrigin(mainOrigin: string): string {
  const override = runtimeOriginOverride();
  if (override !== "") {
    return new URL(override).origin;
  }
  const url = new URL(mainOrigin);
  if (url.hostname === "localhost" || url.hostname === "127.0.0.1") {
    url.port = String(RUNTIME_ORIGIN_PORT);
    return url.origin;
  }
  url.hostname = `${RUNTIME_HOSTNAME_PREFIX}${url.hostname}`;
  return url.origin;
}

/**
 * Base path of the runtime site ("/" by default; e.g. "/runtime/" when the
 * runtime is a GitHub Pages project site on another account, M2 strategy
 * (b)). Normalised to start and end with "/" so it can be concatenated
 * directly onto the runtime origin for the iframe URL.
 */
export function runtimeBasePath(): string {
  const raw = runtimeBaseOverride();
  if (raw === "" || raw === "/") {
    return "/";
  }
  const withLeading = raw.startsWith("/") ? raw : `/${raw}`;
  return withLeading.endsWith("/") ? withLeading : `${withLeading}/`;
}
