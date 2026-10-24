/** Nostr relay diagnostics. Selection/redundancy belongs to Trystero unless an
 * operator supplies overrides. The old probe-era pinned relay list is gone. */

/** WebSocket readyState values (same as the DOM constants). */
export const WS_CONNECTING = 0;
export const WS_OPEN = 1;
export const WS_CLOSING = 2;
export const WS_CLOSED = 3;

/** One relay's socket state as observed by the adapter. */
export interface RelayState {
  readonly url: string;
  /** Raw WebSocket readyState (0=CONNECTING, 1=OPEN, 2=CLOSING, 3=CLOSED). */
  readonly readyState: number;
  /** True when the socket is OPEN (signaling available on this relay). */
  readonly connected: boolean;
  /**
   * True when this relay has recently been observed rejecting Trystero
   * traffic (an OK:false reply or a NOTICE — the same signals Trystero's
   * console "relay failure" warnings watch). An OPEN relay can be
   * `connected` but not `usable` (rocketcrab-ont.1: relay.nostr.info
   * rejects every kind, damus/offchain.pub throttle after a few events).
   */
  readonly degraded: boolean;
}

/** Snapshot of every configured relay's socket + rejection state. */
export interface RelayDiagnostics {
  readonly relays: readonly RelayState[];
  /** Number of configured relays. */
  readonly total: number;
  /** Number of relays whose socket is currently OPEN. */
  readonly connectedCount: number;
  /** Number of OPEN relays not observed rejecting/throttling (usable). */
  readonly usableCount: number;
  /** Number of relays with a failure observation inside the window. */
  readonly degradedCount: number;
  /** True when no relay is OPEN (no signaling; Trystero keeps retrying). */
  readonly signalingDown: boolean;
  /**
   * True when usable relays are below the configured redundancy (or below
   * `total` when redundancy is unknown): signaling is up but thinner than
   * the party needs (rocketcrab-ont.1).
   */
  readonly degraded: boolean;
  /** Epoch-ms timestamp of the snapshot. */
  readonly at: number;
}

/**
 * How long a relay-failure observation keeps a relay marked `degraded`
 * (ms). Failure observations decay so a relay that recovers is no longer
 * counted against the usable set.
 */
export const RELAY_FAILURE_WINDOW_MS = 60_000;

/**
 * True when a relay message signals rejection of Trystero traffic: a
 * NOTICE, or an OK reply that refuses an event submission (`payload ===
 * false`). These are the exact signals Trystero's own message handler
 * warns about (`Trystero: relay failure from <url> - ...`); the adapter
 * observes them per-socket to mark relays `degraded`.
 */
export function isRelayFailureSignal(data: unknown): boolean {
  if (!Array.isArray(data)) {
    return false;
  }
  const [msgType, , payload] = data;
  return msgType === "NOTICE" || (msgType === "OK" && payload === false);
}

/**
 * Snapshot the raw socket map into relay diagnostics. `failures` maps a
 * relay URL to the epoch-ms of its most recent failure observation; a
 * relay whose last failure is inside {@link RELAY_FAILURE_WINDOW_MS} is
 * marked `degraded`. `redundancy` (the transport's configured value) feeds
 * the overall `degraded` flag when provided.
 */
export function snapshotRelays(
  sockets: Record<string, { readonly readyState: number }>,
  at: number,
  failures?: ReadonlyMap<string, number>,
  redundancy?: number,
): RelayDiagnostics {
  const relays: RelayState[] = Object.entries(sockets).map(([url, socket]) => {
    const connected = socket.readyState === WS_OPEN;
    const lastFailureAt = failures?.get(url);
    const degraded = lastFailureAt !== undefined && at - lastFailureAt < RELAY_FAILURE_WINDOW_MS;
    return { url, readyState: socket.readyState, connected, degraded };
  });
  const connectedCount = relays.filter((relay) => relay.connected).length;
  const usableCount = relays.filter((relay) => relay.connected && !relay.degraded).length;
  const degradedCount = relays.filter((relay) => relay.degraded).length;
  return {
    relays,
    total: relays.length,
    connectedCount,
    usableCount,
    degradedCount,
    signalingDown: connectedCount === 0,
    degraded: usableCount < (redundancy ?? relays.length),
    at,
  };
}

/** Compare two snapshots for change reporting (avoids event spam). */
export function relayDiagnosticsEqual(a: RelayDiagnostics, b: RelayDiagnostics): boolean {
  if (
    a.total !== b.total ||
    a.connectedCount !== b.connectedCount ||
    a.usableCount !== b.usableCount ||
    a.degradedCount !== b.degradedCount
  ) {
    return false;
  }
  return a.relays.every((relay, index) => {
    const other = b.relays[index];
    return (
      other !== undefined &&
      relay.url === other.url &&
      relay.readyState === other.readyState &&
      relay.degraded === other.degraded
    );
  });
}
