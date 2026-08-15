/**
 * Real-party transport factory (P4; ADR-0003/0004/0011).
 *
 * The party layer (P2) is transport-neutral: it drives {@link NovaTransport}
 * through a {@link PartyTransportFactory}. For real parties both transports
 * are {@link TrysteroTransport} instances — the rendezvous room carries no
 * password, the private party room carries the derived session password so
 * room admission stays at the transport level (F8). The appId defaults to
 * the environment-specific `rocketcrab-nova-dev` / `-prod` (never colliding
 * between dev and prod rooms; `app-id.ts`).
 *
 * TURN credentials (P0, beads rocketcrab-23s): the factory methods are
 * SYNC (TrysteroTransport construction is synchronous), so the engine mints
 * short-lived credentials ONCE at setup start and closes over them here as
 * `turnConfig` for BOTH transports (the rendezvous and the private room —
 * each room's WebRTC needs the relayed path, and both transports are
 * created fresh per party). Without minted credentials the factory behaves
 * exactly as before: no TURN.
 */
import type { PartyTransportFactory } from "@rocketcrab/party";
import { TrysteroTransport, type TrysteroJoinError } from "@rocketcrab/trystero-transport";
import type { TurnServerConfigLike } from "./turn-creds";

/** Options closed over by the factory at construction time (sync methods). */
export interface TrysteroPartyTransportFactoryOptions {
  /**
   * Minted short-lived TURN servers (Trystero `TurnServerConfig` shape).
   * Omit for builds without VITE_TURN_CREDS_ORIGIN or after a mint failure
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
  const { turnConfig, onJoinError } = options;
  return {
    createRendezvousTransport(identity) {
      return new TrysteroTransport({
        memberId: identity.memberId,
        displayName: identity.displayName,
        ...(turnConfig !== undefined ? { turnConfig } : {}),
        ...(onJoinError !== undefined ? { onJoinError } : {}),
      });
    },
    createPrivateTransport(identity) {
      return new TrysteroTransport({
        memberId: identity.memberId,
        displayName: identity.displayName,
        password: identity.password,
        ...(turnConfig !== undefined ? { turnConfig } : {}),
        ...(onJoinError !== undefined ? { onJoinError } : {}),
      });
    },
  };
}
