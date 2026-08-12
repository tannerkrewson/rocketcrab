import { describe, expect, it } from "vitest";
import {
  GOOD_RELAYS,
  WS_CLOSED,
  WS_CONNECTING,
  WS_OPEN,
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
      { url: "wss://relay.damus.io", readyState: WS_OPEN, connected: true },
      { url: "wss://nos.lol", readyState: WS_CONNECTING, connected: false },
      { url: "wss://dead.example", readyState: WS_CLOSED, connected: false },
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

  it("keeps GOOD_RELAYS verified-reachable (F10 pinning)", () => {
    expect(GOOD_RELAYS.length).toBeGreaterThanOrEqual(5);
    for (const url of GOOD_RELAYS) {
      expect(url).toMatch(/^wss:\/\//);
    }
  });
});
