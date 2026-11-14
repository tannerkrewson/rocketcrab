/**
 * WebSocket URLs on the Nova edge Worker. Both signaling (`/signal/:room`) and
 * the WebRTC fallback tunnel (`/tunnel/:pairId`, PLAN.md §5) hang off the same
 * origin as `VITE_EDGE_ORIGIN`, with the scheme mapped http→ws and https→wss.
 */

const PAIR_ID_PATTERN = /^[0-9a-f]{64}$/;

/** The `ws:`/`wss:` URL for `path` on an HTTP(S) edge origin. */
export function edgeSocketUrl(edgeOrigin: string, path: string): string {
  const origin = new URL(edgeOrigin);
  if ((origin.protocol !== "http:" && origin.protocol !== "https:") || origin.origin === "null") {
    throw new Error("Edge origin must use HTTP or HTTPS.");
  }
  const url = new URL(path, origin);
  url.protocol = origin.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

/** Tunnel socket for one pair. `pairId` is the 64-char lowercase hex from `computeTunnelPairing`. */
export function tunnelUrl(edgeOrigin: string, pairId: string): string {
  if (!PAIR_ID_PATTERN.test(pairId))
    throw new Error("Tunnel pair ID must be 64 lowercase hex characters.");
  return edgeSocketUrl(edgeOrigin, `/tunnel/${pairId}`);
}
