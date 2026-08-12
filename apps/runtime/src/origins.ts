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
 */

export const MAIN_ORIGIN_PORT = 5173;
export const RUNTIME_ORIGIN_PORT = 5174;
const RUNTIME_HOSTNAME_PREFIX = "runtime.";

/** The main Nova origin for the runtime origin this page is served from. */
export function mainOriginForRuntimeOrigin(runtimeOrigin: string): string {
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
  const url = new URL(mainOrigin);
  if (url.hostname === "localhost" || url.hostname === "127.0.0.1") {
    url.port = String(RUNTIME_ORIGIN_PORT);
    return url.origin;
  }
  url.hostname = `${RUNTIME_HOSTNAME_PREFIX}${url.hostname}`;
  return url.origin;
}
