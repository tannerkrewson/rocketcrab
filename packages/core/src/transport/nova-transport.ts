import type { ConnectionId, MemberId } from "@rocketcrab/protocol";
import type {
  TransportConnectionState,
  TransportEventMap,
  TransportJoinRequest,
  TransportPeerInfo,
  TransportSendOptions,
} from "./transport-types";

/**
 * Transport-neutral Nova transport (ADR-0003).
 *
 * The single interface shared by InMemoryTransport (U5, local test arena) and
 * TrysteroTransport (P1, real parties). Generated games never see this
 * interface (engineering rule 1); the game-facing Nova API (S1) sits above it
 * and must behave identically over both implementations (P1 acceptance: both
 * pass the same contract suite).
 *
 * The interface is React-free and does not reference Trystero: no room
 * objects, no peer objects, no relay configuration. Lifecycle events
 * (join/leave/reconnect/suspension) match what a real transport produces
 * (F5 findings; threat-model T15).
 */
export interface NovaTransport {
  /** Transport implementation identity, e.g. "in-memory" | "trystero". */
  readonly kind: string;
  /** Stable per-player identity within the party (ADR-0007). */
  readonly selfMemberId: MemberId;
  /** Current connection identity; changes when the transport reconnects. */
  readonly selfConnectionId: ConnectionId;
  readonly connectionState: TransportConnectionState;
  /** Peers currently connected, in join order. */
  readonly peers: readonly TransportPeerInfo[];

  /**
   * Subscribe to a transport event. Returns an unsubscribe function; calling
   * it removes this handler.
   */
  on<K extends keyof TransportEventMap>(event: K, handler: TransportEventMap[K]): () => void;

  /**
   * Join a session room. Resolves once connected (after any simulated
   * discovery latency). Rejects when the transport is not idle.
   */
  join(request: TransportJoinRequest): Promise<void>;

  /**
   * Leave the session cleanly. Connected peers observe `peer:left`; pending
   * outgoing messages are discarded. Resolves when the leave completes.
   */
  leave(): Promise<void>;

  /**
   * Simulate a dropped connection and re-establishment (F11 rejoin). The
   * member keeps its `memberId` and receives a fresh `connectionId`; peers
   * observe `peer:left` (old connection) then `peer:joined` (new connection),
   * and the local transport emits `peer:reconnected`.
   */
  reconnect(): Promise<void>;

  /**
   * Simulate background suspension (Mobile Safari backgrounding; T15).
   * The connection drops: peers observe `peer:left`, the local state becomes
   * "suspended", and incoming messages are buffered or dropped per the fault
   * profile. `resume()` reconnects.
   */
  suspend(): Promise<void>;

  /** Reconnect after {@link NovaTransport.suspend} (fresh connection ID). */
  resume(): Promise<void>;

  /**
   * Send a message: broadcast to every connected peer, or targeted at one
   * connection. Resolves when the message is accepted by the transport
   * (scheduled or fully queued), not when it is received. Rejects when the
   * transport is not connected or the payload fails validation.
   */
  send(options: TransportSendOptions): Promise<void>;
}
