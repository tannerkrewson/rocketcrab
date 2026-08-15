import { describe, expect, it } from "vitest";
import {
  GOOD_RELAYS,
  RELAY_FAILURE_WINDOW_MS,
  WS_CLOSED,
  WS_CONNECTING,
  WS_OPEN,
  isRelayFailureSignal,
  relayDiagnosticsEqual,
  snapshotRelays,
} from "./relays";

describe("snapshotRelays", () => {
  it("derives connected/signalingDown from socket readyStates", () => {
    const diagnostics = snapshotRelays(
      {
        "wss://relay.damus.io": { readyState: WS_OPEN },
        "wss://nos.lol": { readyState: WS_CONNECTING },
        "wss://dead.example": { readyState: WS_CLOSED },
      },
      1000,
    );
    expect(diagnostics.total).toBe(3);
    expect(diagnostics.connectedCount).toBe(1);
    expect(diagnostics.signalingDown).toBe(false);
    expect(diagnostics.relays).toEqual([
      { url: "wss://relay.damus.io", readyState: WS_OPEN, connected: true, degraded: false },
      { url: "wss://nos.lol", readyState: WS_CONNECTING, connected: false, degraded: false },
      { url: "wss://dead.example", readyState: WS_CLOSED, connected: false, degraded: false },
    ]);
    expect(diagnostics.at).toBe(1000);
  });

  it("reports signalingDown when every relay is closed", () => {
    const diagnostics = snapshotRelays({ "wss://relay.damus.io": { readyState: WS_CLOSED } }, 0);
    expect(diagnostics.connectedCount).toBe(0);
    expect(diagnostics.signalingDown).toBe(true);
  });

  it("handles an empty socket map (no relay initialized yet)", () => {
    const diagnostics = snapshotRelays({}, 0);
    expect(diagnostics.total).toBe(0);
    expect(diagnostics.signalingDown).toBe(true);
  });

  it("marks relays with recent failure observations degraded (rocketcrab-ont.1)", () => {
    const failures = new Map([
      ["wss://relay.nostr.info", 99_500], // inside the window
      ["wss://relay.damus.io", 50_000], // inside the window but the socket is closed
      ["wss://offchain.pub", 10_000], // stale: outside the window
    ]);
    const diagnostics = snapshotRelays(
      {
        "wss://relay.nostr.info": { readyState: WS_OPEN },
        "wss://relay.damus.io": { readyState: WS_CLOSED },
        "wss://offchain.pub": { readyState: WS_OPEN },
        "wss://nos.lol": { readyState: WS_OPEN },
      },
      100_000,
      failures,
    );
    const byUrl = new Map(diagnostics.relays.map((relay) => [relay.url, relay]));
    // OPEN + rejecting: connected but NOT usable.
    expect(byUrl.get("wss://relay.nostr.info")).toMatchObject({
      connected: true,
      degraded: true,
    });
    // A closed relay that recently failed is degraded but not connected.
    expect(byUrl.get("wss://relay.damus.io")).toMatchObject({
      connected: false,
      degraded: true,
    });
    // A failure outside the window has decayed: the relay is usable again.
    expect(byUrl.get("wss://offchain.pub")).toMatchObject({
      connected: true,
      degraded: false,
    });
    expect(byUrl.get("wss://nos.lol")).toMatchObject({ connected: true, degraded: false });
    expect(diagnostics.connectedCount).toBe(3);
    expect(diagnostics.usableCount).toBe(2);
    expect(diagnostics.degradedCount).toBe(2);
  });

  it("reports overall degraded when usable relays fall below redundancy", () => {
    const failures = new Map([
      ["wss://relay.nostr.info", 0],
      ["wss://relay.damus.io", 0],
      ["wss://offchain.pub", 0],
    ]);
    const sockets = {
      "wss://relay.nostr.info": { readyState: WS_OPEN },
      "wss://relay.damus.io": { readyState: WS_OPEN },
      "wss://offchain.pub": { readyState: WS_OPEN },
      "wss://nos.lol": { readyState: WS_OPEN },
      "wss://relay.primal.net": { readyState: WS_OPEN },
      "wss://nostr.mom": { readyState: WS_OPEN },
      "wss://relay.snort.social": { readyState: WS_OPEN },
    };
    // 7 open sockets but 3 rejecting: usable 4 < redundancy 5 → degraded.
    const degraded = snapshotRelays(sockets, 1_000, failures, 5);
    expect(degraded.usableCount).toBe(4);
    expect(degraded.degraded).toBe(true);
    // Without redundancy the baseline is `total`: 4 usable < 7 → degraded.
    expect(snapshotRelays(sockets, 1_000, failures).degraded).toBe(true);
    // All healthy: usable 7 ≥ redundancy 5 → not degraded.
    expect(snapshotRelays(sockets, 1_000, new Map(), 5).degraded).toBe(false);
  });

  it("decays degraded flags after the failure window", () => {
    const failures = new Map([["wss://relay.damus.io", 5_000]]);
    const sockets = { "wss://relay.damus.io": { readyState: WS_OPEN } };
    const before = snapshotRelays(sockets, 5_000 + RELAY_FAILURE_WINDOW_MS - 1, failures);
    expect(before.usableCount).toBe(0);
    const after = snapshotRelays(sockets, 5_000 + RELAY_FAILURE_WINDOW_MS, failures);
    expect(after.usableCount).toBe(1);
    expect(after.degradedCount).toBe(0);
    expect(after.degraded).toBe(false);
  });
});

describe("isRelayFailureSignal", () => {
  it("flags NOTICE and OK:false (event rejected)", () => {
    expect(isRelayFailureSignal(["NOTICE", "sub", "rate limited"])).toBe(true);
    expect(isRelayFailureSignal(["OK", "event-1", false, "blocked: kind not permitted"])).toBe(
      true,
    );
  });

  it("ignores accepted events, EVENT payloads, and garbage", () => {
    expect(isRelayFailureSignal(["OK", "event-1", true, "saved"])).toBe(false);
    expect(isRelayFailureSignal(["EVENT", "sub", { content: "x" }])).toBe(false);
    expect(isRelayFailureSignal(["EOSE", "sub"])).toBe(false);
    expect(isRelayFailureSignal("NOT JSON")).toBe(false);
    expect(isRelayFailureSignal(null)).toBe(false);
    expect(isRelayFailureSignal(["OK", "event-1"])).toBe(false); // no verdict payload
  });
});

describe("relayDiagnosticsEqual", () => {
  it("detects readyState changes", () => {
    const before = snapshotRelays({ "wss://relay.damus.io": { readyState: WS_CONNECTING } }, 0);
    const after = snapshotRelays({ "wss://relay.damus.io": { readyState: WS_OPEN } }, 1000);
    expect(relayDiagnosticsEqual(before, after)).toBe(false);
  });

  it("ignores the timestamp", () => {
    const before = snapshotRelays({ "wss://relay.damus.io": { readyState: WS_OPEN } }, 0);
    const after = snapshotRelays({ "wss://relay.damus.io": { readyState: WS_OPEN } }, 9999);
    expect(relayDiagnosticsEqual(before, after)).toBe(true);
  });

  it("detects degraded flag changes", () => {
    const failures = new Map([["wss://relay.damus.io", 0]]);
    const healthy = snapshotRelays({ "wss://relay.damus.io": { readyState: WS_OPEN } }, 1_000);
    const rejecting = snapshotRelays(
      { "wss://relay.damus.io": { readyState: WS_OPEN } },
      1_000,
      failures,
    );
    expect(relayDiagnosticsEqual(healthy, rejecting)).toBe(false);
    expect(relayDiagnosticsEqual(rejecting, rejecting)).toBe(true);
  });

  it("keeps GOOD_RELAYS verified-reachable (F10 pinning)", () => {
    expect(GOOD_RELAYS.length).toBeGreaterThanOrEqual(5);
    for (const url of GOOD_RELAYS) {
      expect(url).toMatch(/^wss:\/\//);
    }
  });
});
