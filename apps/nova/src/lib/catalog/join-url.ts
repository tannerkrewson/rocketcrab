import type { ExternalPlayer, ExternalRoom } from "./types.ts";

/** Query parameter names a game may rename (Fishbowl uses `hideshare`). */
type AutomaticParam = "rocketcrab" | "name" | "ishost";

export interface RocketcrabUrlOptions {
  /** Rename the automatic rocketcrab/name/ishost parameters. */
  readonly rename?: Partial<Record<AutomaticParam, string>>;
  /** Extra parameters; they override the automatic ones. */
  readonly params?: Readonly<Record<string, string>>;
  /** Appended after the query string, e.g. "#host". */
  readonly hash?: string;
}

/**
 * The rocketcrab join convention: `?rocketcrab=true&name=…&ishost=…`, which
 * games built for rocketcrab read to skip their own lobby.
 */
export function rocketcrabUrl(
  base: string,
  player: ExternalPlayer,
  options: RocketcrabUrlOptions = {},
): string {
  const values: Record<AutomaticParam, string> = {
    rocketcrab: "true",
    name: player.name,
    ishost: String(player.isHost),
  };
  const params: Record<string, string> = {};
  for (const key of ["rocketcrab", "name", "ishost"] as const) {
    params[options.rename?.[key] ?? key] = values[key];
  }
  Object.assign(params, options.params);
  return `${base}?${new URLSearchParams(params).toString()}${options.hash ?? ""}`;
}

/** Read one field of a room another player announced, or fail clearly. */
export function roomField(room: ExternalRoom, key: string): string {
  const value = room[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`The game room is missing its ${key}.`);
  }
  return value;
}

/** The common case: the room is a URL, joined with the rocketcrab parameters. */
export function joinRoomUrl(room: ExternalRoom, player: ExternalPlayer): string {
  return rocketcrabUrl(roomField(room, "url"), player);
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
