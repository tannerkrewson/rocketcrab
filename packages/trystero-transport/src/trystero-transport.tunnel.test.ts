import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectionId } from "@rocketcrab/protocol";
import { TrysteroTransport } from "./trystero-transport";
import * as fallback from "./fallback-peer-connection";

/**
 * Wiring of the WebRTC-to-tunnel fallback into the adapter (PLAN.md §5.6).
 * Trystero's `joinRoom` is mocked, so these tests inspect the config the
 * adapter builds and the `rtcPolyfill` class it hands to Trystero.
 */

const SECRET = "A".repeat(43);

const mocks = vi.hoisted(() => ({
  joinRoom: vi.fn(),
  signalUrl: vi.fn(async () => "wss://relay.example/signal/x"),
}));

vi.mock("./signal-url", () => ({ signalUrl: mocks.signalUrl }));
// Spy on the wrapper factory (behaviour unchanged) to see the options it gets.
vi.mock("./fallback-peer-connection", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./fallback-peer-connection")>();
  return {
    ...actual,
    createFallbackPeerConnectionClass: vi.fn(actual.createFallbackPeerConnectionClass),
  };
});
vi.mock("@trystero-p2p/ws-relay", () => ({
  scale: (config: unknown) => ({ name: "scale", config }),
  joinRoom: mocks.joinRoom,
  getRelaySockets: () => ({}),
  defaultRelayUrls: [],
}));

/** Records every native connection the wrapper creates. */
class FakeNativePeerConnection {
  static constructed: unknown[] = [];
  constructor(configuration?: unknown) {
    FakeNativePeerConnection.constructed.push(configuration);
  }
  addEventListener(): void {}
  removeEventListener(): void {}
}

class FakeWebSocket {}

function configOfLastJoin(): Record<string, unknown> {
  const calls = mocks.joinRoom.mock.calls;
  return calls[calls.length - 1]![0] as Record<string, unknown>;
}

/** Start a join without completing it, then tear it down. */
async function joinAndAbandon(adapter: TrysteroTransport, room = "ROOM"): Promise<void> {
  // Trystero's room is never wired here, so the join fails on the stub and
  // is observed through the config the adapter passed to joinRoom.
  mocks.joinRoom.mockClear();
  mocks.joinRoom.mockReturnValue({
    leave: async () => undefined,
    getPeers: () => ({}),
  });
  const pending = adapter.join({ room, sessionId: "session-1" }).catch(() => undefined);
  await vi.waitFor(() => expect(mocks.joinRoom).toHaveBeenCalled());
  await adapter.leave();
  await pending;
}

beforeEach(() => {
  mocks.joinRoom.mockReset();
  FakeNativePeerConnection.constructed = [];
  vi.stubGlobal("RTCPeerConnection", FakeNativePeerConnection);
  vi.stubGlobal("WebSocket", FakeWebSocket);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("tunnel fallback polyfill", () => {
  it("passes rtcPolyfill to joinRoom when WebRTC and a party secret exist", async () => {
    const adapter = new TrysteroTransport({
      memberId: "member-a",
      edgeOrigin: "https://edge.example",
      partySecret: SECRET,
    });
    await joinAndAbandon(adapter);
    const config = configOfLastJoin();
    expect(typeof config.rtcPolyfill).toBe("function");
  });

  it("creates a fresh polyfill for each join", async () => {
    const adapter = new TrysteroTransport({
      memberId: "member-a",
      edgeOrigin: "https://edge.example",
      partySecret: SECRET,
    });
    await joinAndAbandon(adapter, "ROOM-1");
    const first = configOfLastJoin().rtcPolyfill;
    await joinAndAbandon(adapter, "ROOM-2");
    const second = configOfLastJoin().rtcPolyfill;
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(second).not.toBe(first);
  });

  it("omits rtcPolyfill without a party secret", async () => {
    const adapter = new TrysteroTransport({
      memberId: "member-a",
      edgeOrigin: "https://e.test",
    });
    await joinAndAbandon(adapter);
    expect(configOfLastJoin()).not.toHaveProperty("rtcPolyfill");
  });

  it("omits rtcPolyfill when there is no RTCPeerConnection (non-browser)", async () => {
    vi.stubGlobal("RTCPeerConnection", undefined);
    const adapter = new TrysteroTransport({
      memberId: "member-a",
      edgeOrigin: "https://edge.example",
      partySecret: SECRET,
    });
    await joinAndAbandon(adapter);
    expect(configOfLastJoin()).not.toHaveProperty("rtcPolyfill");
  });

  it("keeps the caller's ICE configuration when the tunnel is not forced", async () => {
    const adapter = new TrysteroTransport({
      memberId: "member-a",
      edgeOrigin: "https://edge.example",
      partySecret: SECRET,
      rtcConfig: { iceServers: [{ urls: "stun:stun.example:3478" }] },
    });
    await joinAndAbandon(adapter);
    const Polyfill = configOfLastJoin().rtcPolyfill as new (c?: RTCConfiguration) => unknown;
    new Polyfill({ iceServers: [{ urls: "stun:stun.example:3478" }] });
    expect(FakeNativePeerConnection.constructed[0]).toEqual({
      iceServers: [{ urls: "stun:stun.example:3478" }],
    });
  });

  it("forces the native connection to relay-only with no ICE servers when requested", async () => {
    const adapter = new TrysteroTransport({
      memberId: "member-a",
      edgeOrigin: "https://edge.example",
      partySecret: SECRET,
      forceRelayOnlyNoServers: true,
    });
    await joinAndAbandon(adapter);
    const Polyfill = configOfLastJoin().rtcPolyfill as new (c?: RTCConfiguration) => unknown;
    new Polyfill({ iceServers: [{ urls: "stun:stun.example:3478" }] });
    expect(FakeNativePeerConnection.constructed[0]).toEqual({
      iceServers: [],
      iceTransportPolicy: "relay",
    });
  });

  it("gives the polyfill the same room name that was joined", async () => {
    const adapter = new TrysteroTransport({
      memberId: "member-a",
      edgeOrigin: "https://edge.example",
      partySecret: SECRET,
    });
    await joinAndAbandon(adapter, "party:room-under-test");
    const factory = vi.mocked(fallback.createFallbackPeerConnectionClass);
    const lastCall = factory.mock.calls[factory.mock.calls.length - 1]!;
    expect(lastCall[0].roomId).toBe("party:room-under-test");
    expect(lastCall[0].roomId).toBe(mocks.joinRoom.mock.calls[0]![1]);
  });

  it("reports no tunnelled peers for unknown connection IDs", () => {
    const adapter = new TrysteroTransport({
      memberId: "member-a",
      partySecret: SECRET,
    });
    expect(adapter.isPeerTunnelled("nobody" as ConnectionId)).toBe(false);
  });
});
