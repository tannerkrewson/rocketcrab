/**
 * Nostr relay configuration and relay-state diagnostics (P1 deliverables;
 * F5 findings F10 / F5).
 *
 * Trystero's `defaultRelayUrls` include dead/flaky community relays (F10:
 * e.g. `strfry.openhoofd.nl` fails TLS), so the adapter pins the verified
 * `GOOD_RELAYS` set probed during the F5 spike (2026-08-01, 100–370 ms) with
 * redundancy 5, exactly as the spike driver does. Relay URLs stay
 * configurable via the adapter options.
 *
 * Relay-state diagnostics are produced by polling `getRelaySockets()`
 * (raw WebSocket readyStates — the only observables Trystero exposes for
 * relay health; F5 finding F5). The adapter uses the same snapshot both for
 * diagnostics and for its own join-time relay-reachability check.
 */

/** WebSocket readyState values (same as the DOM constants). */
export const WS_CONNECTING = 0;
export const WS_OPEN = 1;
export const WS_CLOSING = 2;
export const WS_CLOSED = 3;

/**
 * Verified-reachable public Nostr relays (probed 2026-08-01 during the F5
 * spike from the dev machine's network; see the spike driver's GOOD_RELAYS
 * and `docs/testing/trystero-connectivity-findings.md` F10).
 */
export const GOOD_RELAYS: readonly string[] = [
  "wss://relay.damus.io",
  "wss://nos.lol",
  "wss://relay.primal.net",
  "wss://nostr.mom",
  "wss://relay.snort.social",
  "wss://offchain.pub",
  "wss://relay.nostr.info",
];

/** Relay redundancy used for Nostr room creation (F5 recommendation). */
export const DEFAULT_RELAY_REDUNDANCY = 5;

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
