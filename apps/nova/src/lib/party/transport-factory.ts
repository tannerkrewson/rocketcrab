import type { PartyTransportFactory } from "@rocketcrab/party";
import {
  TrysteroTransport,
  type ConnectionOutcomeInfo,
  type TerminalFailureInfo,
  type TrysteroJoinError,
  type TunnelStartInfo,
} from "@rocketcrab/trystero-transport";
import type { TurnServerConfigLike } from "./turn-creds";
import { reportConnection } from "../connection-log";

/** Options closed over by the factory at construction time (sync methods). */
export interface TrysteroPartyTransportFactoryOptions {
  /**
   * Minted short-lived TURN servers (Trystero `TurnServerConfig` shape).
   * Omit after a mint failure
   * (graceful degradation: the party proceeds without TURN).
   */
  readonly turnConfig?: readonly TurnServerConfigLike[];
  /** Both transports report categorized join failures here for player-facing notices. */
  readonly onJoinError?: (error: TrysteroJoinError) => void;
  /** A peer connection switched to the edge tunnel. */
  readonly onTunnel?: (info: TunnelStartInfo) => void;
  /** A tunneled peer connection failed terminally. */
  readonly onTunnelFailure?: (info: TerminalFailureInfo) => void;
}

/**
 * Test-only WebRTC failure switch. Read window.__NOVA_TEST_FORCE_TUNNEL__
 * only in dev/test builds so forced fallback cannot affect production.
 */
export function forceTunnelForTests(): boolean {
  if (!(import.meta.env.DEV || import.meta.env.MODE === "test")) return false;
  return (
    (globalThis as { __NOVA_TEST_FORCE_TUNNEL__?: unknown }).__NOVA_TEST_FORCE_TUNNEL__ === true
  );
}

/**
 * Send one connection-log beacon per peer attempt. error_code
 * stays empty because peer attempts have no typed room error of their own.
 */
function reportAttemptOutcome(info: ConnectionOutcomeInfo): void {
  reportConnection({
    outcome: info.outcome,
    error_code: "",
    ms_to_connect: info.msToConnect,
    signaling_ok: true,
  });
}

/** The transport factory real parties run over (dev/prod appId by env). */
export function createTrysteroPartyTransportFactory(
  options: TrysteroPartyTransportFactoryOptions = {},
): PartyTransportFactory {
  const turnConfig = options.turnConfig;
  const { onJoinError, onTunnel, onTunnelFailure } = options;
  const create = (identity: Parameters<PartyTransportFactory["createPrivateTransport"]>[0]) => {
    const transport = new TrysteroTransport({
      memberId: identity.memberId,
      displayName: identity.displayName,
      ...("password" in identity ? { password: identity.password } : {}),
      partySecret: identity.secret,
      forceRelayOnlyNoServers: forceTunnelForTests(),
      ...(turnConfig !== undefined ? { turnConfig } : {}),
      ...(onJoinError !== undefined ? { onJoinError } : {}),
      ...(onTunnel !== undefined ? { onTunnel } : {}),
      ...(onTunnelFailure !== undefined ? { onTunnelFailure } : {}),
      onOutcome: reportAttemptOutcome,
    });
    return transport;
  };
  return { createPrivateTransport: create };
}
