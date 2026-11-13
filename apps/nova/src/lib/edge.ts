/**
 * Origin of the Nova edge Worker (deploy/edge): Classic relay at `/`, TURN
 * mint at `/turn`. Baked in at build time from VITE_EDGE_ORIGIN (the deploy
 * workflow defaults it to production) and allowlisted in the CSP
 * connect-src. "" when unset: Classic relay games show a readable error and
 * parties run without TURN.
 */
export function edgeOrigin(): string {
  const raw = import.meta.env.VITE_EDGE_ORIGIN;
  return typeof raw === "string" ? raw.trim().replace(/\/+$/, "") : "";
}
