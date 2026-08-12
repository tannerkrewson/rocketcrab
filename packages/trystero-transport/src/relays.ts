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
}

/** Snapshot of every configured relay's socket state. */
export interface RelayDiagnostics {
  readonly relays: readonly RelayState[];
  /** Number of configured relays. */
  readonly total: number;
  /** Number of relays whose socket is currently OPEN. */
  readonly connectedCount: number;
  /** True when no relay is OPEN (no signaling; Trystero keeps retrying). */
  readonly signalingDown: boolean;
  /** Epoch-ms timestamp of the snapshot. */
  readonly at: number;
}

/** Snapshot the raw socket map into relay diagnostics. */
export function snapshotRelays(
  sockets: Record<string, { readonly readyState: number }>,
  at: number,
): RelayDiagnostics {
  const relays: RelayState[] = Object.entries(sockets).map(([url, socket]) => ({
    url,
    readyState: socket.readyState,
    connected: socket.readyState === WS_OPEN,
  }));
  const connectedCount = relays.filter((relay) => relay.connected).length;
  return {
    relays,
    total: relays.length,
    connectedCount,
    signalingDown: connectedCount === 0,
    at,
  };
}

/** Compare two snapshots for change reporting (avoids event spam). */
export function relayDiagnosticsEqual(a: RelayDiagnostics, b: RelayDiagnostics): boolean {
  if (a.total !== b.total || a.connectedCount !== b.connectedCount) {
    return false;
  }
  return a.relays.every((relay, index) => {
    const other = b.relays[index];
    return other !== undefined && relay.url === other.url && relay.readyState === other.readyState;
  });
}
