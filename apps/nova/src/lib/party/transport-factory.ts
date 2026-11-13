import type { PartyTransportFactory } from "@rocketcrab/party";
import { TrysteroTransport, type TrysteroJoinError } from "@rocketcrab/trystero-transport";
import type { TurnServerConfigLike } from "./turn-creds";
import { edgeOrigin } from "../edge";

/** Options closed over by the factory at construction time (sync methods). */
export interface TrysteroPartyTransportFactoryOptions {
  /**
   * Minted short-lived TURN servers (Trystero `TurnServerConfig` shape).
   * Omit for builds without VITE_EDGE_ORIGIN or after a mint failure
   * (graceful degradation: the party proceeds without TURN).
   */
  readonly turnConfig?: readonly TurnServerConfigLike[];
  /**
   * Join-error observer (5cl.1): both transports report categorized
   * peer/relay failures here so the shell can surface a friendly notice
   * (e.g. the no-TURN `peer_connection_failed` signature).
   */
  readonly onJoinError?: (error: TrysteroJoinError) => void;
}

/** The transport factory real parties run over (dev/prod appId by env). */
export function createTrysteroPartyTransportFactory(
  options: TrysteroPartyTransportFactoryOptions = {},
): PartyTransportFactory {
  const turnConfig = options.turnConfig;
  const { onJoinError } = options;
  const create = (identity: Parameters<PartyTransportFactory["createPrivateTransport"]>[0]) => {
    const transport = new TrysteroTransport({
      memberId: identity.memberId,
      displayName: identity.displayName,
      edgeOrigin: edgeOrigin(),
      ...("password" in identity ? { password: identity.password } : {}),
      ...(turnConfig !== undefined ? { turnConfig } : {}),
      ...(onJoinError !== undefined ? { onJoinError } : {}),
    });
    return transport;
  };
  return { createPrivateTransport: create };
}
