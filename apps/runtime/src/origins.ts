/**
 * Origin derivation for the two-origin model (ADR-0001).
 *
 * The runtime app is served from its own origin (dev: `localhost:5174`,
 * production: a `runtime.*` subdomain — M2). The main Nova origin is derived
 * from the runtime's own location so the same build works on localhost and
 * on a LAN IP (F4 spike pattern):
 *
 * - dev (localhost / 127.0.0.1): swap the port to the main app's port;
 * - production: strip the `runtime.` hostname prefix.
 *
 * Production builds may pin either origin explicitly (M2): the deploy
 * workflow passes `VITE_MAIN_ORIGIN` when the runtime origin is NOT a
 * `runtime.` subdomain of the main origin (strategies (b)/(c),
 * docs/architecture/deployment.md).
 */

export const MAIN_ORIGIN_PORT = 5173;
export const RUNTIME_ORIGIN_PORT = 5174;
const RUNTIME_HOSTNAME_PREFIX = "runtime.";

/** Build-time pin for the main origin (M2 deploy workflow input). */
function mainOriginOverride(): string {
  const raw = import.meta.env.VITE_MAIN_ORIGIN;
  return typeof raw === "string" ? raw.trim() : "";
}

/** Build-time pin for the runtime origin (mirror of the nova build's pin). */
function runtimeOriginOverride(): string {
  const raw = import.meta.env.VITE_RUNTIME_ORIGIN;
  return typeof raw === "string" ? raw.trim() : "";
}

/** The main Nova origin for the runtime origin this page is served from. */
export function mainOriginForRuntimeOrigin(runtimeOrigin: string): string {
  const override = mainOriginOverride();
  if (override !== "") {
    return new URL(override).origin;
  }
  const url = new URL(runtimeOrigin);
  if (url.hostname === "localhost" || url.hostname === "127.0.0.1") {
    url.port = String(MAIN_ORIGIN_PORT);
    return url.origin;
  }
  if (url.hostname.startsWith(RUNTIME_HOSTNAME_PREFIX)) {
    url.hostname = url.hostname.slice(RUNTIME_HOSTNAME_PREFIX.length);
    return url.origin;
  }
  // Already the main origin (unusual deployment); fall back to itself.
  return url.origin;
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
