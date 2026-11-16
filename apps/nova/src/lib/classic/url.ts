import type { ClassicGame, ClassicGameConnectResult } from "./types";

export interface ClassicGamePlayer {
  name: string;
  isHost: boolean;
}

/**
 * Build a player's iframe URL. Automatic parameters are renamed, then
 * overridden by customQueryParams; afterQueryParams is appended verbatim.
 * The host URL spec overrides the player spec for the host only.
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

/** POST JSON, surfacing readable room-creation errors on failure. */
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

export function randomRoomId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
