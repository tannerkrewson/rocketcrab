/**
 * Every member of the game-facing API object. Used by
 * the runtime bridge parity test so the injected `window.nova` script can
 * never drift from the documented API, and by the docs check.
 */
export const NOVA_API_SURFACE: readonly string[] = [
  "version",
  "defineGame",
  "ready",
  "log",
  "player",
  "players",
  "connectionStatus",
  "leaderId",
  "onPlayerJoin",
  "onPlayerLeave",
  "onConnectionChange",
  "onStart",
  "onEnd",
  "onError",
  "dispatch",
  "state",
  "controls",
  "files",
] as const;

/**
 * The reserved transport channel that carries validated protocol messages
 * between sessions.
 */
export const NOVA_PROTOCOL_CHANNEL = "nova.protocol";

/** True when an API member name carries a forbidden concept (host/room/…). */
export function isForbiddenSurfaceName(name: string): boolean {
  return /host|deploy|server|room|trystero|peer\b/i.test(name);
}
