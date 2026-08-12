/**
 * Host-side mirror of the runtime's origin derivation (ADR-0001; the
 * original lives in apps/runtime/src/origins.ts and must stay in sync):
 * the runtime app is served from its own origin (dev `localhost:5174`,
 * production a `runtime.*` subdomain), so the Nova shell derives the runtime
 * origin from its own location.
 */

export const RUNTIME_ORIGIN_PORT = 5174;
const RUNTIME_HOSTNAME_PREFIX = "runtime.";

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
