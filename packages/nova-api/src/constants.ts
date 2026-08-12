/**
 * Shared Nova API constants.
 */

/**
 * Every member of the game-facing API object (S1 surface manifest). Used by
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
  "onPlayerJoin",
  "onPlayerLeave",
  "onConnectionChange",
  "onStart",
  "onEnd",
  "onError",
  "dispatch",
  "state",
  "raw",
  "simulation",
  "media",
] as const;

/**
 * The reserved transport channel that carries validated protocol messages
 * between sessions. Raw-mode games may not create a channel with this name
 * (S1: reserved channel names fail with a clear error).
 */
export const NOVA_PROTOCOL_CHANNEL = "nova.protocol";

/** True when a raw channel name collides with a reserved protocol name. */
export function isReservedChannelName(name: string): boolean {
  return name === NOVA_PROTOCOL_CHANNEL;
}

/** True when an API member name carries a forbidden concept (host/room/…). */
export function isForbiddenSurfaceName(name: string): boolean {
  return /host|deploy|server|room|trystero|peer\b/i.test(name);
}
