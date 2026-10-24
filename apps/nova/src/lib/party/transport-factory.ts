import type { PartyTransportFactory } from "@rocketcrab/party";
import { TrysteroTransport, type TrysteroJoinError } from "@rocketcrab/trystero-transport";
import type { TurnServerConfigLike } from "./turn-creds";

/**
 * Optional build-time relay override (`VITE_TRYSTERO_RELAYS`, comma-separated).
 * Invalid entries are ignored; an empty/invalid value falls back to the
 * adapter's reviewed pinned set. This changes only signaling discovery, not
 * transport semantics; it is not a runtime fetch or a game-facing surface.
 */
export function configuredRelays(): string[] {
  const raw = import.meta.env.VITE_TRYSTERO_RELAYS;
  if (typeof raw !== "string") return [];
  const relays: string[] = [];
  for (const entry of raw.split(",")) {
    const value = entry.trim();
    if (value === "") continue;
    try {
      const url = new URL(value);
      if ((url.protocol === "wss:" || url.protocol === "ws:") && url.hostname !== "") {
        relays.push(url.toString());
      }
    } catch {
      // Ignore malformed entries rather than breaking the entire build config.
    }
  }
  return [...new Set(relays)];
}

/** Options closed over by the factory at construction time (sync methods). */
export interface TrysteroPartyTransportFactoryOptions {
  /**
   * Minted short-lived TURN servers (Trystero `TurnServerConfig` shape).
   * Omit for builds without VITE_TURN_CREDS_ORIGIN or after a mint failure
   * (graceful degradation: the party proceeds without TURN).
   */
  readonly turnConfig?: readonly TurnServerConfigLike[];
  /** Explicit relay list (tests/deploy override); defaults to build env or pinned set. */
  readonly relays?: readonly string[];
  /**
   * Join-error observer (5cl.1): both transports report categorized
   * peer/relay failures here so the shell can surface a friendly notice
   * (e.g. the no-TURN `peer_connection_failed` signature).
   */
  readonly onJoinError?: (error: TrysteroJoinError) => void;
}

export interface RefreshablePartyTransportFactory extends PartyTransportFactory {
  updateTurnConfig(servers: readonly TurnServerConfigLike[]): void;
}

/** The transport factory real parties run over (dev/prod appId by env). */
export function createTrysteroPartyTransportFactory(
  options: TrysteroPartyTransportFactoryOptions = {},
): RefreshablePartyTransportFactory {
  let turnConfig = options.turnConfig;
  const { onJoinError } = options;
  const relays = options.relays ?? configuredRelays();
  const transports = new Set<TrysteroTransport>();
  const create = (identity: Parameters<PartyTransportFactory["createPrivateTransport"]>[0]) => {
    const transport = new TrysteroTransport({
      memberId: identity.memberId,
      displayName: identity.displayName,
      ...("password" in identity ? { password: identity.password } : {}),
      ...(relays.length > 0 ? { relays } : {}),
      ...(turnConfig !== undefined ? { turnConfig } : {}),
      ...(onJoinError !== undefined ? { onJoinError } : {}),
    });
    transports.add(transport);
    return transport;
  };
  return {
    updateTurnConfig(servers) {
      turnConfig = servers;
      for (const transport of transports) {
        transport.updateTurnConfig(servers);
      }
    },
    createPrivateTransport: create,
  };
}
