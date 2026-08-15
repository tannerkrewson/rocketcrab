import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectionId, MemberId } from "@rocketcrab/protocol";
import type {
  NovaTransport,
  TransportConnectionState,
  TransportMessage,
  TransportPeerInfo,
  TransportReconnectEvent,
  TransferProgress,
} from "@rocketcrab/core";
import type { JoinRoomCallbacks } from "trystero";
import { TrysteroTransport } from "./trystero-transport";
import type { TrysteroTransportOptions } from "./trystero-transport";
import { GOOD_RELAYS, RELAY_FAILURE_WINDOW_MS } from "./relays";
import type { RelayDiagnostics } from "./relays";
import type { TrysteroJoinError } from "./errors";

/**
 * Deterministic adapter contract tests. The `trystero` module is fully
 * mocked, time comes from an injectable fake clock, and relay sockets are
 * controllable, so CI runs are exact (no real timers, no network).
 */

const RELAY = "wss://relay.damus.io";

const mocks = vi.hoisted(() => {
  const relaySockets: Record<string, { readyState: number }> = {};
  return {
    relaySockets,
    joinRoom: vi.fn(),
    selfId: "self-peer-id",
  };
});

vi.mock("trystero", () => ({
  joinRoom: mocks.joinRoom,
  getRelaySockets: () => mocks.relaySockets,
  selfId: mocks.selfId,
  defaultRelayUrls: ["wss://default.example"],
}));

/** Deterministic fake clock: timers only run when the test advances time. */
interface FakeClock {
  now: () => number;
  schedule: (callback: () => void, delayMs: number) => () => void;
  advance: (ms: number) => void;
}

function makeFakeClock(): FakeClock {
  let t = 0;
  let order = 0;
  const timers: Array<{ at: number; order: number; cb: () => void; active: boolean }> = [];
  return {
    now: () => t,
    schedule: (cb, delayMs) => {
      const timer = { at: t + delayMs, order: order++, cb, active: true };
      timers.push(timer);
      return () => {
        timer.active = false;
      };
    },
    advance: (ms: number) => {
      const deadline = t + ms;
      for (;;) {
        const due = timers
          .filter((timer) => timer.active && timer.at <= deadline)
          .sort((a, b) => a.at - b.at || a.order - b.order)[0];
        if (due === undefined) {
          break;
        }
        due.active = false;
        t = Math.max(t, due.at);
        due.cb();
      }
      t = deadline;
    },
  };
}

interface FakeAction {
  onMessage: ((data: unknown, context: { peerId: string; metadata?: unknown }) => void) | null;
  onReceiveProgress:
    | ((percent: number, context: { peerId: string; metadata?: unknown }) => void)
    | null;
  send: ReturnType<typeof vi.fn>;
}

function makeFakeAction(): FakeAction {
  return {
    onMessage: null,
    onReceiveProgress: null,
    send: vi.fn(async () => undefined),
  };
}

interface FakeRoom {
  onPeerJoin: ((peerId: string) => void) | null;
  onPeerLeave: ((peerId: string) => void) | null;
  leave: ReturnType<typeof vi.fn>;
  ping: ReturnType<typeof vi.fn>;
  makeAction: ReturnType<typeof vi.fn>;
  action: FakeAction;
}

function makeFakeRoom(): FakeRoom {
  const action = makeFakeAction();
  return {
    onPeerJoin: null,
    onPeerLeave: null,
    leave: vi.fn(async () => undefined),
    ping: vi.fn(async (_peerId: string) => 1),
    makeAction: vi.fn(
      (
        _namespace: string,
        config?: {
          onMessage?: (data: unknown, context: { peerId: string; metadata?: unknown }) => void;
          onReceiveProgress?: (
            percent: number,
            context: { peerId: string; metadata?: unknown },
          ) => void;
        },
      ) => {
        if (config?.onMessage !== undefined) {
          action.onMessage = config.onMessage;
        }
        if (config?.onReceiveProgress !== undefined) {
          action.onReceiveProgress = config.onReceiveProgress;
        }
        return action;
      },
    ),
    action,
  };
}

interface Setup {
  adapter: TrysteroTransport;
  clock: FakeClock;
}

function setup(options: Partial<TrysteroTransportOptions> = {}): Setup {
  const clock = makeFakeClock();
  const adapter = new TrysteroTransport({
    memberId: "member-a",
    displayName: "Ada",
    ...options,
    now: clock.now,
    schedule: clock.schedule,
  });
  return { adapter, clock };
}

/** Join with a relay that is already OPEN; settle via the relay poll. */
async function joinConnected(adapter: TrysteroTransport, clock: FakeClock): Promise<void> {
  const promise = adapter.join({ room: "ROOM", sessionId: "session-1" });
  clock.advance(1000);
  await promise;
}

function capturedCallbacks(): JoinRoomCallbacks {
  const callbacks = mocks.joinRoom.mock.calls[0]?.[2] as JoinRoomCallbacks | undefined;
  if (callbacks === undefined) {
    throw new Error("joinRoom was not called");
  }
  return callbacks;
}

/** Simulate a remote peer's identity handshake + join on one adapter. */
async function simulatePeerJoin(
  callbacks: JoinRoomCallbacks,
  room: FakeRoom,
  peerId: string,
  identity: { memberId: MemberId; connectionId: ConnectionId; displayName?: string },
): Promise<void> {
  await callbacks.onPeerHandshake!(
    peerId,
    async () => undefined,
    async () => ({ data: { v: 1, ...identity } }),
    false,
  );
  room.onPeerJoin!(peerId);
}

beforeEach(() => {
  mocks.joinRoom.mockReset();
  for (const key of Object.keys(mocks.relaySockets)) {
    delete mocks.relaySockets[key];
  }
});

afterEach(() => {
  mocks.joinRoom.mockReset();
});

describe("TrysteroTransport construction", () => {
  it("implements the NovaTransport interface shape", () => {
    const { adapter } = setup();
    const transport: NovaTransport = adapter;
    expect(transport.kind).toBe("trystero");
    expect(transport.selfMemberId).toBe("member-a");
    expect(transport.connectionState).toBe("idle");
    expect(transport.peers).toEqual([]);
  });

  it("defaults the appId to the environment-specific dev ID", () => {
    const { adapter } = setup();
    expect(adapter.appId).toBe("rocketcrab-nova-dev");
    const prod = new TrysteroTransport({ memberId: "member-p", env: { PROD: true } });
    expect(prod.appId).toBe("rocketcrab-nova-prod");
    const explicit = new TrysteroTransport({ memberId: "member-x", appId: "rocketcrab-e2e" });
    expect(explicit.appId).toBe("rocketcrab-e2e");
  });

  it("uses the page's Trystero peer ID as the initial connectionId", () => {
    const { adapter } = setup();
    expect(adapter.selfConnectionId).toBe("self-peer-id");
  });
});

describe("TrysteroTransport join", () => {
  it("joins a room with pinned GOOD_RELAYS and redundancy 5", async () => {
    const { adapter, clock } = setup();
    mocks.relaySockets[RELAY] = { readyState: 0 };
    const room = makeFakeRoom();
    mocks.joinRoom.mockReturnValue(room);
    console.log(
      "DBG2 after set: impl=",
      typeof mocks.joinRoom.getMockImplementation?.(),
      "room?",
      room !== undefined,
    );
    const states: TransportConnectionState[] = [];
    adapter.on("connection:state", (state) => {
      states.push(state);
    });

    const promise = adapter.join({ room: "ROOM", sessionId: "session-1" });
    console.log(
      "DBG calls:",
      mocks.joinRoom.mock.calls.length,
      "returned:",
      JSON.stringify(mocks.joinRoom.mock.results[0]?.value ?? "none"),
    );
    expect(adapter.connectionState).toBe("joining");
    mocks.relaySockets[RELAY] = { readyState: 1 };
    clock.advance(1000);
    await promise;

    expect(adapter.connectionState).toBe("connected");
    expect(adapter.roomName).toBe("ROOM");
    expect(adapter.sessionId).toBe("session-1");
    expect(states).toEqual(["joining", "connected"]);
    expect(mocks.joinRoom).toHaveBeenCalledTimes(1);
    const [config, roomName] = mocks.joinRoom.mock.calls[0]!;
    expect(roomName).toBe("ROOM");
    expect(config.appId).toBe("rocketcrab-nova-dev");
    expect(config.relayConfig).toEqual({ urls: [...GOOD_RELAYS], redundancy: 5 });
  });

  it("rejects a second join while connected", async () => {
    const { adapter, clock } = setup();
    mocks.relaySockets[RELAY] = { readyState: 1 };
    mocks.joinRoom.mockReturnValue(makeFakeRoom());
    await joinConnected(adapter, clock);
    await expect(adapter.join({ room: "ROOM2", sessionId: "session-2" })).rejects.toMatchObject({
      category: "already_joined",
    });
  });

  it("fails with relay_unreachable when no relay opens (F5/S9 finding)", async () => {
    const { adapter, clock } = setup({ relayConnectTimeoutMs: 5000 });
    const room = makeFakeRoom();
    mocks.joinRoom.mockReturnValue(room);
    mocks.relaySockets[RELAY] = { readyState: 0 };

    const promise = adapter.join({ room: "ROOM", sessionId: "session-1" });
    clock.advance(5000);
    await expect(promise).rejects.toMatchObject({ category: "relay_unreachable" });
    expect(adapter.connectionState).toBe("idle");
    expect(adapter.sessionId).toBeNull();
    // fail fast: the room is left so a rejected joiner stops churning offers (F4)
    expect(room.leave).toHaveBeenCalled();
  });

  it("fails with join_timeout when the overall timeout elapses", async () => {
    const { adapter, clock } = setup({ relayConnectTimeoutMs: 20_000, joinTimeoutMs: 10_000 });
    const room = makeFakeRoom();
    mocks.joinRoom.mockReturnValue(room);
    mocks.relaySockets[RELAY] = { readyState: 0 };

    const promise = adapter.join({ room: "ROOM", sessionId: "session-1" });
    clock.advance(10_000);
    await expect(promise).rejects.toMatchObject({ category: "join_timeout" });
    expect(adapter.connectionState).toBe("idle");
  });

  it("recovers after a failed join (retry policy)", async () => {
    const { adapter, clock } = setup({ relayConnectTimeoutMs: 5000 });
    mocks.joinRoom.mockReturnValue(makeFakeRoom());
    mocks.relaySockets[RELAY] = { readyState: 0 };
    const first = adapter.join({ room: "ROOM", sessionId: "session-1" });
    clock.advance(5000);
    await expect(first).rejects.toMatchObject({ category: "relay_unreachable" });

    mocks.relaySockets[RELAY] = { readyState: 1 };
    const second = adapter.join({ room: "ROOM", sessionId: "session-1" });
    clock.advance(1000);
    await second;
    expect(adapter.connectionState).toBe("connected");
    expect(mocks.joinRoom).toHaveBeenCalledTimes(2);
  });

  it("cancels a pending join when leave() runs mid-join", async () => {
    const { adapter } = setup();
    void adapter;
    mocks.joinRoom.mockReturnValue(makeFakeRoom());
    mocks.relaySockets[RELAY] = { readyState: 0 };
    const joinPromise = adapter.join({ room: "ROOM", sessionId: "session-1" });
    const leavePromise = adapter.leave();
    await expect(joinPromise).rejects.toMatchObject({ category: "cancelled" });
    await leavePromise;
    expect(adapter.connectionState).toBe("idle");
  });

  it("passes the TURN configuration hook through (never hardcoded)", async () => {
    const turnConfig = [{ urls: "turn:example.com:3478", username: "u", credential: "c" }];
    const { adapter, clock } = setup({ turnConfig });
    mocks.relaySockets[RELAY] = { readyState: 1 };
    mocks.joinRoom.mockReturnValue(makeFakeRoom());
    await joinConnected(adapter, clock);
    void clock;
    const [config] = mocks.joinRoom.mock.calls[0]!;
    expect(config.turnConfig).toEqual(turnConfig);
  });
});

describe("TrysteroTransport peer mapping", () => {
  it("exchanges identity in the handshake and maps peer:joined", async () => {
    const { adapter, clock } = setup();
    const room = makeFakeRoom();
    mocks.joinRoom.mockReturnValue(room);
    mocks.relaySockets[RELAY] = { readyState: 1 };
    await joinConnected(adapter, clock);

    const callbacks = capturedCallbacks();
    let sentIdentity: unknown;
    await callbacks.onPeerHandshake!(
      "peer-1",
      async (data) => {
        sentIdentity = data;
      },
      async () => ({
        data: { v: 1, memberId: "member-b", connectionId: "conn-b", displayName: "Bea" },
      }),
      false,
    );
    // we announce our own memberId + connectionId
    expect(sentIdentity).toEqual({
      v: 1,
      memberId: "member-a",
      connectionId: "self-peer-id",
      displayName: "Ada",
    });

    const joined: TransportPeerInfo[] = [];
    adapter.on("peer:joined", (peer) => {
      joined.push(peer);
    });
    room.onPeerJoin!("peer-1");
    expect(joined).toEqual([
      {
        memberId: "member-b",
        connectionId: "conn-b",
        displayName: "Bea",
        joinedAt: expect.any(Number),
      },
    ]);
    expect(adapter.peers).toHaveLength(1);
    expect(adapter.peers[0]!.memberId).toBe("member-b");
  });

  it("fails the peer when the identity handshake is malformed (T10)", async () => {
    const { adapter, clock } = setup();
    const room = makeFakeRoom();
    mocks.joinRoom.mockReturnValue(room);
    mocks.relaySockets[RELAY] = { readyState: 1 };
    await joinConnected(adapter, clock);

    const callbacks = capturedCallbacks();
    await expect(
      callbacks.onPeerHandshake!(
        "peer-1",
        async () => undefined,
        async () => ({ data: { v: 1, memberId: 42, connectionId: "" } }),
        false,
      ),
    ).rejects.toThrow(/invalid identity handshake/);
  });

  it("maps peer:left and cleans up the identity maps", async () => {
    const { adapter, clock } = setup();
    const room = makeFakeRoom();
    mocks.joinRoom.mockReturnValue(room);
    mocks.relaySockets[RELAY] = { readyState: 1 };
    await joinConnected(adapter, clock);
    await simulatePeerJoin(capturedCallbacks(), room, "peer-1", {
      memberId: "member-b",
      connectionId: "conn-b",
    });

    const left: TransportPeerInfo[] = [];
    adapter.on("peer:left", (peer) => {
      left.push(peer);
    });
    room.onPeerLeave!("peer-1");
    expect(left).toEqual([
      { memberId: "member-b", connectionId: "conn-b", joinedAt: expect.any(Number) },
    ]);
    expect(adapter.peers).toHaveLength(0);
    // the old connectionId can no longer be targeted
    await expect(
      adapter.send({ channel: "raw", payload: "x", targetConnectionId: "conn-b" }),
    ).rejects.toMatchObject({ category: "not_connected" });
  });
});

describe("TrysteroTransport send", () => {
  async function joinedWithPeer(): Promise<{
    adapter: TrysteroTransport;
    clock: FakeClock;
    room: FakeRoom;
  }> {
    const { adapter, clock } = setup();
    const room = makeFakeRoom();
    mocks.joinRoom.mockReturnValue(room);
    mocks.relaySockets[RELAY] = { readyState: 1 };
    await joinConnected(adapter, clock);
    await simulatePeerJoin(capturedCallbacks(), room, "peer-1", {
      memberId: "member-b",
      connectionId: "conn-b",
      displayName: "Bea",
    });
    return { adapter, clock, room };
  }

  it("broadcasts to every peer (target null)", async () => {
    const { adapter, room } = await joinedWithPeer();
    await adapter.send({ channel: "raw", payload: { hello: 1 } });
    expect(room.action.send).toHaveBeenCalledWith(
      { hello: 1 },
      expect.objectContaining({ target: null }),
    );
  });

  it("targets one connection by connectionId", async () => {
    const { adapter, room } = await joinedWithPeer();
    await adapter.send({
      channel: "raw",
      payload: "to-b",
      targetConnectionId: "conn-b",
    });
    const [payload, options] = room.action.send.mock.calls[0]!;
    expect(payload).toBe("to-b");
    expect(options.target).toBe("peer-1");
    // the wire envelope is attached as metadata
    expect(options.metadata).toMatchObject({
      v: 1,
      channel: "raw",
      sessionId: "session-1",
      messageId: expect.any(String),
    });
  });

  it("rejects sends to an unknown connection", async () => {
    const { adapter } = await joinedWithPeer();
    await expect(
      adapter.send({ channel: "raw", payload: "x", targetConnectionId: "ghost" }),
    ).rejects.toMatchObject({ category: "not_connected" });
  });

  it("rejects sends when not connected", async () => {
    const { adapter } = setup();
    await expect(adapter.send({ channel: "raw", payload: "x" })).rejects.toMatchObject({
      category: "not_connected",
    });
  });

  it("passes binary payloads through unchanged", async () => {
    const { adapter, room } = await joinedWithPeer();
    const bytes = new Uint8Array([1, 2, 3, 250]);
    await adapter.send({ channel: "raw", payload: bytes, binary: true });
    const [payload, options] = room.action.send.mock.calls[0]!;
    expect(payload).toBe(bytes);
    expect(options.metadata.binary).toBe(true);
  });

  it("assigns monotonic delivery sequences per (connection, channel)", async () => {
    const { adapter, room } = await joinedWithPeer();
    await adapter.send({ channel: "raw", payload: "one" });
    await adapter.send({ channel: "raw", payload: "two" });
    await adapter.send({ channel: "other", payload: "one" });
    expect(room.action.send.mock.calls[0]![1].metadata.deliverySeq).toBe(1);
    expect(room.action.send.mock.calls[1]![1].metadata.deliverySeq).toBe(2);
    expect(room.action.send.mock.calls[2]![1].metadata.deliverySeq).toBe(1);
  });

  it("validates structured payloads when a validator is configured (T10)", async () => {
    const { adapter, clock } = setup({
      validate: (payload: unknown) =>
        typeof payload === "string" ? { ok: true } : { ok: false, error: "not a string" },
    });
    const room = makeFakeRoom();
    mocks.joinRoom.mockReturnValue(room);
    mocks.relaySockets[RELAY] = { readyState: 1 };
    await joinConnected(adapter, clock);
    const reasons: string[] = [];
    adapter.on("message:invalid", (_message, reason) => {
      reasons.push(reason);
    });
    await expect(adapter.send({ channel: "raw", payload: { nope: true } })).rejects.toMatchObject({
      category: "invalid_state",
    });
    expect(reasons).toEqual(["not a string"]);
    await adapter.send({ channel: "raw", payload: "ok" });
    expect(room.action.send).toHaveBeenCalledTimes(1);
  });
});

describe("TrysteroTransport message delivery", () => {
  async function joinedWithPeer(): Promise<{
    adapter: TrysteroTransport;
    room: FakeRoom;
  }> {
    const { adapter, clock } = setup();
    const room = makeFakeRoom();
    mocks.joinRoom.mockReturnValue(room);
    mocks.relaySockets[RELAY] = { readyState: 1 };
    await joinConnected(adapter, clock);
    await simulatePeerJoin(capturedCallbacks(), room, "peer-1", {
      memberId: "member-b",
      connectionId: "conn-b",
      displayName: "Bea",
    });
    return { adapter, room };
  }

  it("rebuilds the TransportMessage from wire metadata + peer identity", async () => {
    const { adapter, room } = await joinedWithPeer();
    const received: TransportMessage[] = [];
    adapter.on("message:received", (message) => {
      received.push(message);
    });
    const payload = { type: "action.dispatch", seq: 3 };
    room.action.onMessage!(payload, {
      peerId: "peer-1",
      metadata: {
        v: 1,
        messageId: "m-1",
        sentAt: 1234,
        channel: "raw",
        sessionId: "session-1",
        seq: 3,
        version: 1,
        deliverySeq: 2,
      },
    });
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({
      version: 1,
      sessionId: "session-1",
      channel: "raw",
      senderMemberId: "member-b",
      senderConnectionId: "conn-b",
      messageId: "m-1",
      sentAt: 1234,
      seq: 3,
      deliverySeq: 2,
      reliability: "reliable",
      ordering: "ordered",
      binary: false,
      payload,
    });
  });

  it("delivers binary payloads as detached Uint8Array copies", async () => {
    const { adapter, room } = await joinedWithPeer();
    const received: TransportMessage[] = [];
    adapter.on("message:received", (message) => {
      received.push(message);
    });
    const bytes = new Uint8Array([9, 8, 7]);
    room.action.onMessage!(bytes, {
      peerId: "peer-1",
      metadata: {
        v: 1,
        messageId: "m-2",
        sentAt: 1,
        channel: "raw",
        sessionId: "session-1",
        binary: true,
      },
    });
    expect(received[0]!.binary).toBe(true);
    expect(received[0]!.payload).toEqual(new Uint8Array([9, 8, 7]));
    expect(received[0]!.payload).not.toBe(bytes);
  });

  it("drops messages with malformed metadata (T10)", async () => {
    const { adapter, room } = await joinedWithPeer();
    const received: TransportMessage[] = [];
    adapter.on("message:received", (message) => {
      received.push(message);
    });
    room.action.onMessage!({ x: 1 }, { peerId: "peer-1", metadata: { v: 99 } });
    expect(received).toHaveLength(0);
  });
});

describe("TrysteroTransport transfer progress", () => {
  async function joinedWithPeer(): Promise<{
    adapter: TrysteroTransport;
    room: FakeRoom;
  }> {
    const { adapter, clock } = setup();
    const room = makeFakeRoom();
    mocks.joinRoom.mockReturnValue(room);
    mocks.relaySockets[RELAY] = { readyState: 1 };
    await joinConnected(adapter, clock);
    await simulatePeerJoin(capturedCallbacks(), room, "peer-1", {
      memberId: "member-b",
      connectionId: "conn-b",
    });
    return { adapter, room };
  }

  it("maps send-side progress percentages to transfer:progress", async () => {
    const { adapter, room } = await joinedWithPeer();
    const progress: TransferProgress[] = [];
    const payload = "x".repeat(200);
    await adapter.send({
      channel: "raw",
      payload,
      onProgress: (p) => {
        progress.push(p);
      },
    });
    const sendOptions = room.action.send.mock.calls[0]![1] as {
      onProgress: (percent: number) => void;
    };
    sendOptions.onProgress(0.5);
    expect(progress).toEqual([
      {
        direction: "send",
        messageId: expect.any(String),
        channel: "raw",
        bytesTransferred: 100,
        totalBytes: 200,
        fraction: 0.5,
      },
    ]);
  });

  it("maps receive-side progress to transfer:progress", async () => {
    const { adapter, room } = await joinedWithPeer();
    const progress: TransferProgress[] = [];
    adapter.on("transfer:progress", (p) => {
      progress.push(p);
    });
    room.action.onReceiveProgress!(0.25, {
      peerId: "peer-1",
      metadata: {
        v: 1,
        messageId: "m-9",
        sentAt: 1,
        channel: "game-source",
        sessionId: "session-1",
        totalBytes: 800,
      },
    });
    expect(progress).toEqual([
      {
        direction: "receive",
        messageId: "m-9",
        channel: "game-source",
        bytesTransferred: 200,
        totalBytes: 800,
        fraction: 0.25,
      },
    ]);
  });
});

describe("TrysteroTransport join errors", () => {
  it("fails a pending join with password_mismatch (F8)", async () => {
    const { adapter, clock } = setup();
    void clock;
    const room = makeFakeRoom();
    mocks.joinRoom.mockReturnValue(room);
    mocks.relaySockets[RELAY] = { readyState: 0 };
    const promise = adapter.join({ room: "ROOM", sessionId: "session-1" });
    capturedCallbacks().onJoinError!({
      error: "incorrect room password when decrypting offer",
      appId: "rocketcrab-nova-dev",
      roomId: "ROOM",
      peerId: "peer-1",
    });
    await expect(promise).rejects.toMatchObject({ category: "password_mismatch" });
    expect(adapter.connectionState).toBe("idle");
    expect(room.leave).toHaveBeenCalled();
  });

  it("delivers post-join errors to the observer and diagnostics (F5)", async () => {
    const seen: TrysteroJoinError[] = [];
    const { adapter, clock } = setup({ onJoinError: (error) => seen.push(error) });
    mocks.joinRoom.mockReturnValue(makeFakeRoom());
    mocks.relaySockets[RELAY] = { readyState: 1 };
    await joinConnected(adapter, clock);
    capturedCallbacks().onJoinError!({
      error:
        "could not connect to peer p2 after exchanging SDP; configure TURN servers with turnConfig or rtcConfig.iceServers",
      appId: "rocketcrab-nova-dev",
      roomId: "ROOM",
      peerId: "p2",
    });
    expect(seen).toHaveLength(1);
    expect(seen[0]!.category).toBe("peer_connection_failed");
    // the connection stays up: one bad peer must not kill the session
    expect(adapter.connectionState).toBe("connected");
    expect(adapter.getDiagnostics().joinErrors).toEqual(seen);
  });
});

describe("TrysteroTransport relay diagnostics", () => {
  it("polls relay sockets and reports state changes", async () => {
    const { adapter, clock } = setup();
    const room = makeFakeRoom();
    mocks.joinRoom.mockReturnValue(room);
    mocks.relaySockets[RELAY] = { readyState: 0 };
    const changes: RelayDiagnostics[] = [];
    adapter.onRelayStateChange((diagnostics) => {
      changes.push(diagnostics);
    });
    const promise = adapter.join({ room: "ROOM", sessionId: "session-1" });
    // first poll: CONNECTING
    expect(adapter.getRelayDiagnostics()?.signalingDown).toBe(true);
    mocks.relaySockets[RELAY] = { readyState: 1 };
    clock.advance(1000);
    await promise;
    expect(adapter.getRelayDiagnostics()?.connectedCount).toBe(1);
    expect(adapter.getRelayDiagnostics()?.signalingDown).toBe(false);

    mocks.relaySockets[RELAY] = { readyState: 3 };
    clock.advance(1000);
    expect(adapter.getRelayDiagnostics()?.signalingDown).toBe(true);
    expect(changes.length).toBeGreaterThanOrEqual(2);
  });

  it("stops polling after leave (engineering rule 22 cleanup)", async () => {
    const { adapter, clock } = setup();
    mocks.joinRoom.mockReturnValue(makeFakeRoom());
    mocks.relaySockets[RELAY] = { readyState: 1 };
    await joinConnected(adapter, clock);
    expect(adapter.getRelayDiagnostics()).not.toBeNull();
    await adapter.leave();
    // advance far past several poll intervals: nothing should blow up and the
    // monitor must not reschedule (no new relay-state events)
    clock.advance(10_000);
    expect(adapter.getRelayDiagnostics()).toBeNull();
  });

  it("marks a rejecting relay degraded and reports usable count (rocketcrab-ont.1)", async () => {
    const { adapter, clock } = setup({ redundancy: 1 });
    mocks.joinRoom.mockReturnValue(makeFakeRoom());
    // A real WebSocket-like relay socket: message listeners wire on poll.
    const listeners = new Set<(event: { data: unknown }) => void>();
    const socket = {
      readyState: 1,
      addEventListener: (_type: string, handler: (event: { data: unknown }) => void) => {
        listeners.add(handler);
      },
      fire: (data: unknown) => {
        for (const handler of listeners) {
          handler({ data });
        }
      },
    };
    mocks.relaySockets[RELAY] = socket;
    const changes: RelayDiagnostics[] = [];
    adapter.onRelayStateChange((diagnostics) => {
      changes.push(diagnostics);
    });
    const promise = adapter.join({ room: "ROOM", sessionId: "session-1" });
    // first poll wires the listener and settles the join (socket OPEN)
    clock.advance(1000);
    await promise;
    expect(adapter.getRelayDiagnostics()?.usableCount).toBe(1);

    // The relay rejects an event submission (the same signal Trystero's
    // console "relay failure from ..." warning watches).
    socket.fire(["OK", "event-1", false, "blocked: kind 22774 not permitted"]);
    clock.advance(1000);
    const degraded = adapter.getRelayDiagnostics();
    expect(degraded?.connectedCount).toBe(1);
    expect(degraded?.usableCount).toBe(0);
    expect(degraded?.degradedCount).toBe(1);
    expect(degraded?.relays[0]).toMatchObject({ connected: true, degraded: true });
    // usable 0 < redundancy 5 → overall degraded
    expect(degraded?.degraded).toBe(true);
    // the change was pushed through onRelayStateChange
    expect(changes.some((entry) => entry.usableCount === 0 && entry.degraded)).toBe(true);

    // NOTICE is a failure signal too.
    socket.fire(["NOTICE", "sub", "rate limited"]);
    clock.advance(1000);
    expect(adapter.getRelayDiagnostics()?.usableCount).toBe(0);

    // An accepted event is NOT a failure; the degraded flag still decays
    // only after the failure window passes.
    socket.fire(["OK", "event-2", true, "saved"]);
    clock.advance(1000);
    expect(adapter.getRelayDiagnostics()?.usableCount).toBe(0);
    clock.advance(RELAY_FAILURE_WINDOW_MS);
    expect(adapter.getRelayDiagnostics()?.usableCount).toBe(1);
    expect(adapter.getRelayDiagnostics()?.relays[0]?.degraded).toBe(false);
    expect(adapter.getRelayDiagnostics()?.degraded).toBe(false);
  });
});

describe("TrysteroTransport leave / reconnect / suspend", () => {
  it("leaves cleanly: releases room handlers and rejects sends", async () => {
    const { adapter, clock } = setup();
    const room = makeFakeRoom();
    mocks.joinRoom.mockReturnValue(room);
    mocks.relaySockets[RELAY] = { readyState: 1 };
    await joinConnected(adapter, clock);
    await simulatePeerJoin(capturedCallbacks(), room, "peer-1", {
      memberId: "member-b",
      connectionId: "conn-b",
    });

    await adapter.leave();
    expect(room.leave).toHaveBeenCalledTimes(1);
    expect(room.onPeerJoin).toBeNull();
    expect(room.onPeerLeave).toBeNull();
    expect(room.action.onMessage).toBeNull();
    expect(room.action.onReceiveProgress).toBeNull();
    expect(adapter.connectionState).toBe("disconnected");
    expect(adapter.peers).toHaveLength(0);
    expect(adapter.sessionId).toBeNull();
    await expect(adapter.send({ channel: "raw", payload: "x" })).rejects.toMatchObject({
      category: "not_connected",
    });
    // leave() is idempotent
    await adapter.leave();
    expect(adapter.connectionState).toBe("disconnected");
  });

  it("reconnects with a fresh connectionId and emits peer:reconnected", async () => {
    const { adapter, clock } = setup();
    const room = makeFakeRoom();
    mocks.joinRoom.mockReturnValue(room);
    mocks.relaySockets[RELAY] = { readyState: 1 };
    await joinConnected(adapter, clock);
    await simulatePeerJoin(capturedCallbacks(), room, "peer-1", {
      memberId: "member-b",
      connectionId: "conn-b",
    });
    const oldConnectionId = adapter.selfConnectionId;
    const reconnected: TransportReconnectEvent[] = [];
    adapter.on("peer:reconnected", (event) => {
      reconnected.push(event);
    });

    const promise = adapter.reconnect();
    // reconnect() awaits room.leave() before re-wiring; flush the microtask
    // so the relay monitor is running when the clock advances.
    await Promise.resolve();
    clock.advance(1000);
    await promise;

    expect(room.leave).toHaveBeenCalled();
    expect(mocks.joinRoom).toHaveBeenCalledTimes(2);
    expect(adapter.connectionState).toBe("connected");
    expect(adapter.selfConnectionId).toBe("self-peer-id#1");
    expect(adapter.peers).toHaveLength(0); // peers must re-handshake
    expect(reconnected).toEqual([
      {
        memberId: "member-a",
        oldConnectionId,
        newConnectionId: "self-peer-id#1",
      },
    ]);
  });

  it("rejects reconnect when not connected", async () => {
    const { adapter } = setup();
    await expect(adapter.reconnect()).rejects.toMatchObject({ category: "invalid_state" });
  });

  it("suspend drops the connection; resume rejoins with a fresh ID", async () => {
    const { adapter, clock } = setup();
    const room = makeFakeRoom();
    mocks.joinRoom.mockReturnValue(room);
    mocks.relaySockets[RELAY] = { readyState: 1 };
    await joinConnected(adapter, clock);
    await simulatePeerJoin(capturedCallbacks(), room, "peer-1", {
      memberId: "member-b",
      connectionId: "conn-b",
    });
    const oldConnectionId = adapter.selfConnectionId;
    const reconnected: TransportReconnectEvent[] = [];
    adapter.on("peer:reconnected", (event) => {
      reconnected.push(event);
    });

    await adapter.suspend();
    expect(room.leave).toHaveBeenCalled();
    expect(adapter.connectionState).toBe("suspended");
    expect(adapter.peers).toHaveLength(0);

    const promise = adapter.resume();
    clock.advance(1000);
    await promise;
    expect(adapter.connectionState).toBe("connected");
    expect(adapter.selfConnectionId).toBe("self-peer-id#1");
    expect(adapter.sessionId).toBe("session-1");
    expect(reconnected).toEqual([
      {
        memberId: "member-a",
        oldConnectionId,
        newConnectionId: "self-peer-id#1",
      },
    ]);
  });

  it("rejects resume without a prior suspend", async () => {
    const { adapter, clock } = setup();
    mocks.relaySockets[RELAY] = { readyState: 1 };
    mocks.joinRoom.mockReturnValue(makeFakeRoom());
    await joinConnected(adapter, clock);
    await expect(adapter.resume()).rejects.toMatchObject({ category: "invalid_state" });
  });
});

describe("TrysteroTransport ping / quality", () => {
  it("pings a peer by connectionId through room.ping", async () => {
    const { adapter, clock } = setup();
    const room = makeFakeRoom();
    mocks.joinRoom.mockReturnValue(room);
    mocks.relaySockets[RELAY] = { readyState: 1 };
    await joinConnected(adapter, clock);
    await simulatePeerJoin(capturedCallbacks(), room, "peer-1", {
      memberId: "member-b",
      connectionId: "conn-b",
    });
    room.ping.mockResolvedValue(4);
    await expect(adapter.ping("conn-b")).resolves.toBe(4);
    expect(room.ping).toHaveBeenCalledWith("peer-1");
    await expect(adapter.ping("ghost")).resolves.toBeNull();
  });

  it("samples connection quality for every peer", async () => {
    const { adapter, clock } = setup();
    const room = makeFakeRoom();
    mocks.joinRoom.mockReturnValue(room);
    mocks.relaySockets[RELAY] = { readyState: 1 };
    await joinConnected(adapter, clock);
    await simulatePeerJoin(capturedCallbacks(), room, "peer-1", {
      memberId: "member-b",
      connectionId: "conn-b",
    });
    room.ping.mockResolvedValue(7);
    const samples = await adapter.sampleQuality();
    expect(samples).toEqual([
      {
        connectionId: "conn-b",
        memberId: "member-b",
        pingMs: 7,
        sampledAt: expect.any(Number),
      },
    ]);
    expect(adapter.getDiagnostics().lastQuality).toEqual(samples);
  });

  it("returns null ping when the peer does not answer", async () => {
    const { adapter, clock } = setup();
    const room = makeFakeRoom();
    mocks.joinRoom.mockReturnValue(room);
    mocks.relaySockets[RELAY] = { readyState: 1 };
    await joinConnected(adapter, clock);
    await simulatePeerJoin(capturedCallbacks(), room, "peer-1", {
      memberId: "member-b",
      connectionId: "conn-b",
    });
    room.ping.mockRejectedValue(new Error("peer disconnected"));
    await expect(adapter.ping("conn-b")).resolves.toBeNull();
  });
});

describe("TrysteroTransport event unsubscription", () => {
  it("supports unsubscribing from events", async () => {
    const { adapter, clock } = setup();
    const room = makeFakeRoom();
    mocks.joinRoom.mockReturnValue(room);
    mocks.relaySockets[RELAY] = { readyState: 1 };
    await joinConnected(adapter, clock);
    const received: TransportMessage[] = [];
    const unsubscribe = adapter.on("message:received", (message) => {
      received.push(message);
    });
    room.action.onMessage!(
      { type: "action.dispatch" },
      {
        peerId: "peer-1",
        metadata: { v: 1, messageId: "m-1", sentAt: 1, channel: "raw", sessionId: "session-1" },
      },
    );
    expect(received).toHaveLength(1);
    unsubscribe();
    room.action.onMessage!(
      { type: "action.dispatch" },
      {
        peerId: "peer-1",
        metadata: { v: 1, messageId: "m-2", sentAt: 2, channel: "raw", sessionId: "session-1" },
      },
    );
    expect(received).toHaveLength(1);
  });
});
