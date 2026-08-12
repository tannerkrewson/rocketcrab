import type { ClassicGame, ClassicGameConnectResult } from "./types";

/** A player for URL building (classic `Player`). */
export interface ClassicGamePlayer {
  name: string;
  isHost: boolean;
}

/**
 * Builds the iframe URL for one player, ported from classic's
 * `useConnectedGame` (dev branch `utils/useConnectedGame.ts`).
 *
 * The automatic query params (`rocketcrab=true`, `name`, `ishost`) are added
 * first, renamed per the game's `renameParams`, then overridden by the
 * connect result's `customQueryParams`, and finally `afterQueryParams` is
 * appended verbatim. The host merges the `host` URL spec over `player`.
 */
export function buildClassicGameUrl(
  connected: ClassicGameConnectResult,
  game: Pick<ClassicGame, "renameParams">,
  player: ClassicGamePlayer,
): string {
  if (!connected?.player) return "";

  const { url, customQueryParams, afterQueryParams } = player.isHost
    ? { ...connected.player, ...connected.host }
    : connected.player;

  const paramKeys: Record<string, string> = {
    rocketcrab: "rocketcrab",
    name: "name",
    ishost: "ishost",
    ...game.renameParams,
  };

  const defaultParams: Record<string, string> = {
    rocketcrab: "true",
    name: player.name,
    ishost: player.isHost.toString(),
  };

  const params: Record<string, string> = {};
  for (const key of Object.keys(paramKeys)) {
    const targetKey = paramKeys[key];
    const value = defaultParams[key];
    if (targetKey !== undefined && value !== undefined) {
      params[targetKey] = value;
    }
  }
  Object.assign(params, customQueryParams);

  const query = new URLSearchParams(params).toString();
  return url + (query.length > 0 ? `?${query}` : "") + (afterQueryParams ?? "");
}

/**
 * POSTs JSON and parses the JSON response (classic's `postJson`). Nova
 * surfaces a readable error when the external room-creation endpoint fails
 * instead of failing silently.
 */
export async function postJson<T = unknown>(url: string, data: unknown = {}): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    throw new Error(`Couldn't reach ${new URL(url).host} to create a room (HTTP ${res.status}).`);
  }
  return (await res.json()) as T;
}

/** A random 8-byte room suffix (classic used `crypto.randomBytes(8)`). */
export function randomRoomId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
