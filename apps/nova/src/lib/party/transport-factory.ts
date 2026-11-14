import type { PartyTransportFactory } from "@rocketcrab/party";
import {
  TrysteroTransport,
  type TerminalFailureInfo,
  type TrysteroJoinError,
  type TunnelStartInfo,
} from "@rocketcrab/trystero-transport";
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
   * peer/relay failures here so the shell can surface a friendly notice.
   */
  readonly onJoinError?: (error: TrysteroJoinError) => void;
  /** A peer connection switched to the edge tunnel (PLAN.md §7 stage 2). */
  readonly onTunnel?: (info: TunnelStartInfo) => void;
  /** A tunnelled peer connection failed terminally (PLAN.md §7 stage 4). */
  readonly onTunnelFailure?: (info: TerminalFailureInfo) => void;
}

/**
 * Test-only switch for the WebRTC-to-tunnel fallback (PLAN.md §5.6). A page
 * sets `window.__NOVA_TEST_FORCE_TUNNEL__ = true` (e2e uses `addInitScript`)
 * and its native WebRTC can no longer connect, so its pairs tunnel. The flag
 * is read only in dev and `MODE === "test"` builds; production builds fold
 * `import.meta.env.DEV` to `false`, so the flag is never read there.
 */
export function forceTunnelForTests(): boolean {
  if (!(import.meta.env.DEV || import.meta.env.MODE === "test")) return false;
  return (
    (globalThis as { __NOVA_TEST_FORCE_TUNNEL__?: unknown }).__NOVA_TEST_FORCE_TUNNEL__ === true
  );
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
      edgeOrigin: edgeOrigin(),
      ...("password" in identity ? { password: identity.password } : {}),
      partySecret: identity.secret,
      forceRelayOnlyNoServers: forceTunnelForTests(),
      ...(turnConfig !== undefined ? { turnConfig } : {}),
      ...(onJoinError !== undefined ? { onJoinError } : {}),
      ...(onTunnel !== undefined ? { onTunnel } : {}),
      ...(onTunnelFailure !== undefined ? { onTunnelFailure } : {}),
    });
    return transport;
  };
  return { createPrivateTransport: create };
}
