/**
 * Origin of the Nova edge Worker (deploy/edge): external-game room relay at `/`, TURN
 * mint at `/turn`, and party signaling at `/signal`. Baked in at build time
 * from VITE_EDGE_ORIGIN and allowlisted in CSP connect-src. When unset,
 * relay-backed external games and party signaling cannot connect.
 */
export function edgeOrigin(): string {
  const raw = import.meta.env.VITE_EDGE_ORIGIN;
  return typeof raw === "string" ? raw.trim().replace(/\/+$/, "") : "";
}
