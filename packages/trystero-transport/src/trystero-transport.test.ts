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
import type { RoomError } from "@trystero-p2p/ws-relay";
import { TrysteroTransport } from "./trystero-transport";
import type { TrysteroTransportOptions } from "./trystero-transport";
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
    signalUrl: vi.fn(async () => "wss://relay.damus.io"),
  };
});

vi.mock("./signal-url", () => ({ signalUrl: mocks.signalUrl }));
vi.mock("@trystero-p2p/ws-relay", () => ({
  scale: (config: unknown) => ({ name: "scale", config }),
  joinRoom: mocks.joinRoom,
  getRelaySockets: () => mocks.relaySockets,
  defaultRelayUrls: ["wss://relay.damus.io"],
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
  joinHandler: ((peer: { peerId: string; userId: string }) => void) | null;
  leaveHandler: ((peer: { peerId: string; userId: string }) => void) | null;
  errorHandler: ((error: RoomError) => void) | null;
  stateHandler:
    | ((
        value: unknown,
        context: { peerId: string; userId: string; self: boolean; removed: boolean },
      ) => void)
    | null;
  peers: Record<string, { userId: string }>;
  values: Record<string, unknown>;
  metas: Record<string, { peerId: string; userId: string; online: boolean }>;
  ownIdentity: unknown;
  leave: ReturnType<typeof vi.fn>;
  ping: ReturnType<typeof vi.fn>;
  getPeers: ReturnType<typeof vi.fn>;
  makeAction: ReturnType<typeof vi.fn>;
  action: FakeAction;
  acknowledgement: FakeAction;
}

function makeFakeRoom(): FakeRoom {
  const action = makeFakeAction();
  const acknowledgement = makeFakeAction();
  const wrapAction = (fake: FakeAction) => ({
    send: fake.send,
    onMessage: (handler: NonNullable<FakeAction["onMessage"]>) => {
      fake.onMessage = handler;
      return () => {
        fake.onMessage = null;
      };
    },
    onReceiveProgress: (handler: NonNullable<FakeAction["onReceiveProgress"]>) => {
      fake.onReceiveProgress = handler;
      return () => {
        fake.onReceiveProgress = null;
      };
    },
  });
  const room: FakeRoom = {
    joinHandler: null,
    leaveHandler: null,
    errorHandler: null,
    stateHandler: null,
    peers: {},
    values: {},
    metas: {},
    ownIdentity: undefined,
    leave: vi.fn(async () => undefined),
    ping: vi.fn(async (_peerId: string) => 1),
    getPeers: vi.fn(() => room.peers),
    makeAction: vi.fn((namespace: string) =>
      wrapAction(namespace === "nova.identity.ack" ? acknowledgement : action),
    ),
    action,
    acknowledgement,
    ...{
      getSelf: async () => ({ peerId: mocks.selfId }),
      onPeerJoin: (handler: FakeRoom["joinHandler"]) => {
        room.joinHandler = handler;
        return () => {
          room.joinHandler = null;
        };
      },
      onPeerLeave: (handler: FakeRoom["leaveHandler"]) => {
        room.leaveHandler = handler;
        return () => {
          room.leaveHandler = null;
        };
      },
      onError: (handler: FakeRoom["errorHandler"]) => {
        room.errorHandler = handler;
        return () => {
          room.errorHandler = null;
        };
      },
      makeUserState: () => ({
        get: (userId: string) => room.values[userId],
        getMeta: (userId: string) => room.metas[userId],
        set: async (value: unknown) => {
          room.ownIdentity = value;
        },
        onChange: (handler: FakeRoom["stateHandler"]) => {
          room.stateHandler = handler;
          return () => {
            room.stateHandler = null;
          };
        },
      }),
    },
  };
  return room;
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

function capturedCallbacks(): undefined {
  return undefined;
}

/** Deliver a peer's published state and acknowledgement through 0.27 listeners. */
async function simulatePeerJoin(
  _legacy: undefined,
  room: FakeRoom,
  peerId: string,
  identity: { memberId: MemberId; connectionId: ConnectionId; displayName?: string },
  selfConnectionId = mocks.selfId,
): Promise<void> {
  const userId = `user-${peerId}`;
  room.peers[peerId] = { userId };
  room.values[userId] = { v: 1, transportVersion: 5, ...identity };
  room.metas[userId] = { peerId, userId, online: true };
  room.joinHandler!({ peerId, userId });
  room.acknowledgement.onMessage!(selfConnectionId, { peerId });
  await Promise.resolve();
}

async function flushSetup(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

beforeEach(() => {
  mocks.signalUrl.mockReset().mockResolvedValue(RELAY);
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
    expect(adapter.appId).toBe("rocketcrab-nova-v027-dev");
    const prod = new TrysteroTransport({ memberId: "member-p", env: { PROD: true } });
    expect(prod.appId).toBe("rocketcrab-nova-v027-prod");
    const explicit = new TrysteroTransport({ memberId: "member-x", appId: "rocketcrab-e2e" });
    expect(explicit.appId).toBe("rocketcrab-e2e");
  });

  it("provides a provisional connectionId before room identity is initialized", () => {
    const { adapter } = setup();
    expect(adapter.selfConnectionId).toBeTruthy();
  });
});

describe("deferred signaling derivation", () => {
  it("preserves a new join started synchronously by an idle listener after derivation failure", async () => {
    const { adapter } = setup();
    mocks.joinRoom.mockReturnValue(makeFakeRoom());
    mocks.relaySockets[RELAY] = { readyState: 1 };
    mocks.signalUrl.mockRejectedValueOnce(new Error("digest failed"));
    let retry: Promise<void> | undefined;
    adapter.on("connection:state", (state) => {
      if (state === "idle" && !retry)
        retry = adapter.join({ room: "NEW", sessionId: "new-session" });
    });
    await expect(adapter.join({ room: "OLD", sessionId: "old-session" })).rejects.toMatchObject({
      category: "invalid_state",
    });
    expect(retry).toBeDefined();
    await retry;
    expect(adapter.roomName).toBe("NEW");
    expect(adapter.sessionId).toBe("new-session");
    await adapter.leave();
  });

  it("does not start stale resume derivation after a joining listener leaves and starts a new join", async () => {
    const { adapter, clock } = setup();
    mocks.joinRoom.mockReturnValue(makeFakeRoom());
    mocks.relaySockets[RELAY] = { readyState: 1 };
    await joinConnected(adapter, clock);
    await adapter.suspend();
    let finish!: (url: string) => void;
    mocks.signalUrl.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    let retry: Promise<void> | undefined;
    let triggered = false;
    adapter.on("connection:state", (state) => {
      if (state === "joining" && !triggered) {
        triggered = true;
        void adapter.leave();
        retry = adapter.join({ room: "NEW", sessionId: "new-session" });
      }
    });
    await expect(adapter.resume()).rejects.toMatchObject({ category: "cancelled" });
    expect(retry).toBeDefined();
    const cancelled = expect(retry).rejects.toMatchObject({ category: "cancelled" });
    await adapter.leave();
    await cancelled;
    finish(RELAY);
    await flushSetup();
    expect(mocks.joinRoom).toHaveBeenCalledTimes(1);
  });

  it("counts derivation time against the overall join deadline", async () => {
    const { adapter, clock } = setup({ joinTimeoutMs: 5000, relayConnectTimeoutMs: 20_000 });
    mocks.joinRoom.mockReturnValue(makeFakeRoom());
    mocks.relaySockets[RELAY] = { readyState: 0 };
    let finish!: (url: string) => void;
    mocks.signalUrl.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const pending = adapter.join({ room: "ROOM", sessionId: "session-1" });
    const rejected = expect(pending).rejects.toMatchObject({ category: "join_timeout" });
    clock.advance(4000);
    finish(RELAY);
    await flushSetup();
    clock.advance(1000);
    await rejected;
  });

  for (const operation of ["join", "reconnect", "resume"] as const) {
    for (const outcome of ["cancelled", "join_timeout"] as const) {
      it(`${operation} settles when derivation is ${outcome}`, async () => {
        const { adapter, clock } = setup({ joinTimeoutMs: 5000 });
        mocks.joinRoom.mockReturnValue(makeFakeRoom());
        mocks.relaySockets[RELAY] = { readyState: 1 };
        if (operation !== "join") {
          await joinConnected(adapter, clock);
          if (operation === "resume") await adapter.suspend();
        }
        let finish!: (url: string) => void;
        mocks.signalUrl.mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              finish = resolve;
            }),
        );
        const pending =
          operation === "join"
            ? adapter.join({ room: "ROOM", sessionId: "session-1" })
            : adapter[operation]();
        const rejected = expect(pending).rejects.toMatchObject({ category: outcome });
        await flushSetup();
        const calls = mocks.joinRoom.mock.calls.length;
        if (outcome === "cancelled") await adapter.leave();
        else clock.advance(5000);
        await rejected;
        finish(RELAY);
        await flushSetup();
        expect(mocks.joinRoom).toHaveBeenCalledTimes(calls);
      });
    }
  }
});

describe("TrysteroTransport join", () => {
  it("joins with the room-scoped signaling relay", async () => {
    const { adapter, clock } = setup();
    mocks.relaySockets[RELAY] = { readyState: 0 };
    const room = makeFakeRoom();
    mocks.joinRoom.mockReturnValue(room);
    const states: TransportConnectionState[] = [];
    adapter.on("connection:state", (state) => {
      states.push(state);
    });

    const promise = adapter.join({ room: "ROOM", sessionId: "session-1" });
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
    expect(config.appId).toBe("rocketcrab-nova-v027-dev");
    expect(config.relayConfig).toEqual({ urls: [RELAY] });
    expect(config.maxReceiveBytes).toBe(8 * 1024 * 1024);
    expect(config.use).toEqual([{ name: "scale", config: { maxDirectPeers: 9 } }]);
    expect(config.maxUsers).toBeUndefined();
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
    await flushSetup();
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
    await flushSetup();
    clock.advance(10_000);
    await expect(promise).rejects.toMatchObject({ category: "join_timeout" });
    expect(adapter.connectionState).toBe("idle");
  });

  it("recovers after a failed join (retry policy)", async () => {
    const { adapter, clock } = setup({ relayConnectTimeoutMs: 5000 });
    mocks.joinRoom.mockReturnValue(makeFakeRoom());
    mocks.relaySockets[RELAY] = { readyState: 0 };
    const first = adapter.join({ room: "ROOM", sessionId: "session-1" });
    await flushSetup();
    clock.advance(5000);
    await expect(first).rejects.toMatchObject({ category: "relay_unreachable" });

    mocks.relaySockets[RELAY] = { readyState: 1 };
    const second = adapter.join({ room: "ROOM", sessionId: "session-1" });
    clock.advance(1000);
    await second;
    expect(adapter.connectionState).toBe("connected");
    expect(mocks.joinRoom).toHaveBeenCalledTimes(2);
  });

  it("times out waiting for failed teardown and retains the barrier for the next retry", async () => {
    const { adapter, clock } = setup({ relayConnectTimeoutMs: 1000, joinTimeoutMs: 5000 });
    const oldRoom = makeFakeRoom();
    let finishLeave!: () => void;
    oldRoom.leave.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishLeave = resolve;
        }),
    );
    mocks.joinRoom.mockReturnValueOnce(oldRoom).mockReturnValue(makeFakeRoom());
    mocks.relaySockets[RELAY] = { readyState: 0 };
    const first = adapter.join({ room: "ROOM", sessionId: "session-1" });
    await flushSetup();
    clock.advance(1000);
    await expect(first).rejects.toMatchObject({ category: "relay_unreachable" });
    const retry = adapter.join({ room: "ROOM", sessionId: "session-1" });
    const timeout = expect(retry).rejects.toMatchObject({ category: "join_timeout" });
    clock.advance(5000);
    await timeout;
    expect(mocks.joinRoom).toHaveBeenCalledTimes(1);
    mocks.relaySockets[RELAY] = { readyState: 1 };
    const next = adapter.join({ room: "ROOM", sessionId: "session-1" });
    expect(mocks.joinRoom).toHaveBeenCalledTimes(1);
    finishLeave();
    await next;
    expect(mocks.joinRoom).toHaveBeenCalledTimes(2);
    await adapter.leave();
  });

  it("shares the retry deadline between teardown and digest", async () => {
    const { adapter, clock } = setup({ relayConnectTimeoutMs: 1000, joinTimeoutMs: 5000 });
    const oldRoom = makeFakeRoom();
    let finishLeave!: () => void;
    oldRoom.leave.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishLeave = resolve;
        }),
    );
    mocks.joinRoom.mockReturnValue(oldRoom);
    mocks.relaySockets[RELAY] = { readyState: 0 };
    const first = adapter.join({ room: "ROOM", sessionId: "session-1" });
    await flushSetup();
    clock.advance(1000);
    await expect(first).rejects.toMatchObject({ category: "relay_unreachable" });
    let finishDigest!: (url: string) => void;
    mocks.signalUrl.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishDigest = resolve;
        }),
    );
    const retry = adapter.join({ room: "ROOM", sessionId: "session-1" });
    const timeout = expect(retry).rejects.toMatchObject({ category: "join_timeout" });
    clock.advance(4000);
    finishLeave();
    await flushSetup();
    clock.advance(1000);
    await timeout;
    finishDigest(RELAY);
    await flushSetup();
    expect(mocks.joinRoom).toHaveBeenCalledTimes(1);
  });

  it("waits for failed room teardown before an immediate retry", async () => {
    const { adapter, clock } = setup({ relayConnectTimeoutMs: 5000 });
    const oldRoom = makeFakeRoom();
    const newRoom = makeFakeRoom();
    let finishLeave!: () => void;
    oldRoom.leave.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishLeave = resolve;
        }),
    );
    mocks.joinRoom.mockReturnValueOnce(oldRoom).mockReturnValueOnce(newRoom);
    mocks.relaySockets[RELAY] = { readyState: 0 };
    const first = adapter.join({ room: "ROOM", sessionId: "session-1" });
    await flushSetup();
    clock.advance(5000);
    await expect(first).rejects.toMatchObject({ category: "relay_unreachable" });
    mocks.relaySockets[RELAY] = { readyState: 1 };
    const retry = adapter.join({ room: "ROOM", sessionId: "session-1" });
    expect(mocks.joinRoom).toHaveBeenCalledTimes(1);
    finishLeave();
    await retry;
    expect(mocks.joinRoom).toHaveBeenCalledTimes(2);
    expect(adapter.connectionState).toBe("connected");
    await adapter.leave();
  });

  it("holds idle leave until a failed room is released before a new adapter joins", async () => {
    const { adapter, clock } = setup({ relayConnectTimeoutMs: 1000 });
    const oldRoom = makeFakeRoom();
    let finishLeave!: () => void;
    oldRoom.leave.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishLeave = resolve;
        }),
    );
    mocks.joinRoom.mockReturnValueOnce(oldRoom).mockReturnValue(makeFakeRoom());
    mocks.relaySockets[RELAY] = { readyState: 0 };
    const first = adapter.join({ room: "ROOM", sessionId: "session-1" });
    await flushSetup();
    clock.advance(1000);
    await expect(first).rejects.toMatchObject({ category: "relay_unreachable" });
    expect(adapter.connectionState).toBe("idle");
    let released = false;
    const leaving = adapter.leave().then(() => {
      released = true;
    });
    await flushSetup();
    expect(released).toBe(false);
    expect(mocks.joinRoom).toHaveBeenCalledTimes(1);
    const nextAdapter = setup().adapter;
    const rejoin = leaving.then(() => nextAdapter.join({ room: "ROOM", sessionId: "session-1" }));
    await flushSetup();
    expect(mocks.joinRoom).toHaveBeenCalledTimes(1);
    mocks.relaySockets[RELAY] = { readyState: 1 };
    finishLeave();
    await rejoin;
    expect(released).toBe(true);
    expect(mocks.joinRoom).toHaveBeenCalledTimes(2);
    await nextAdapter.leave();
  });

  it("reports a rejected failed-room teardown and does not retry into the room", async () => {
    const { adapter, clock } = setup({ relayConnectTimeoutMs: 1000 });
    const room = makeFakeRoom();
    room.leave.mockRejectedValueOnce(new Error("teardown failed"));
    mocks.joinRoom.mockReturnValue(room);
    mocks.relaySockets[RELAY] = { readyState: 0 };
    const first = adapter.join({ room: "ROOM", sessionId: "session-1" });
    await flushSetup();
    clock.advance(1000);
    await expect(first).rejects.toMatchObject({ category: "relay_unreachable" });
    await expect(adapter.leave()).rejects.toThrow("teardown failed");
    await expect(adapter.join({ room: "ROOM", sessionId: "session-1" })).rejects.toMatchObject({
      category: "invalid_state",
    });
    expect(mocks.joinRoom).toHaveBeenCalledTimes(1);
  });

  it("cancels a retry while waiting for failed room teardown", async () => {
    const { adapter, clock } = setup({ relayConnectTimeoutMs: 5000 });
    const room = makeFakeRoom();
    let finishLeave!: () => void;
    room.leave.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishLeave = resolve;
        }),
    );
    mocks.joinRoom.mockReturnValue(room);
    mocks.relaySockets[RELAY] = { readyState: 0 };
    const first = adapter.join({ room: "ROOM", sessionId: "session-1" });
    await flushSetup();
    clock.advance(5000);
    await expect(first).rejects.toMatchObject({ category: "relay_unreachable" });
    const retry = adapter.join({ room: "ROOM", sessionId: "session-1" });
    const cancelled = expect(retry).rejects.toMatchObject({ category: "cancelled" });
    const leaving = adapter.leave();
    await cancelled; // settles while the original teardown is still stalled
    let leaveSettled = false;
    void leaving.then(() => {
      leaveSettled = true;
    });
    await flushSetup();
    expect(leaveSettled).toBe(false);
    expect(mocks.joinRoom).toHaveBeenCalledTimes(1);
    mocks.relaySockets[RELAY] = { readyState: 1 };
    const next = adapter.join({ room: "ROOM", sessionId: "session-1" });
    expect(mocks.joinRoom).toHaveBeenCalledTimes(1); // barrier is retained
    finishLeave();
    await leaving;
    await next;
    expect(mocks.joinRoom).toHaveBeenCalledTimes(2);
    await adapter.leave();
  });

  it("does not create a room if a joining-state listener immediately leaves", async () => {
    const { adapter } = setup();
    mocks.joinRoom.mockReturnValue(makeFakeRoom());
    adapter.on("connection:state", (state) => {
      if (state === "joining") void adapter.leave();
    });
    await expect(adapter.join({ room: "ROOM", sessionId: "session-1" })).rejects.toMatchObject({
      category: "cancelled",
    });
    expect(mocks.joinRoom).not.toHaveBeenCalled();
    expect(adapter.connectionState).toBe("idle");
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
  it("times out unadmitted peers and cancels admission timers on leave", async () => {
    const onJoinError = vi.fn();
    const { adapter, clock } = setup({ onJoinError, handshakeTimeoutMs: 5000 });
    const room = makeFakeRoom();
    mocks.joinRoom.mockReturnValue(room);
    mocks.relaySockets[RELAY] = { readyState: 1 };
    await joinConnected(adapter, clock);
    room.peers.slow = { userId: "slow-user" };
    room.joinHandler!({ peerId: "slow", userId: "slow-user" });
    clock.advance(4999);
    expect(onJoinError).not.toHaveBeenCalled();
    clock.advance(1);
    expect(onJoinError).toHaveBeenCalledOnce();
    expect(onJoinError).toHaveBeenCalledWith(
      expect.objectContaining({ category: "handshake_timeout", peerId: "slow" }),
    );
    expect(adapter.peers).toEqual([]);
    room.peers.departed = { userId: "departed-user" };
    room.joinHandler!({ peerId: "departed", userId: "departed-user" });
    room.leaveHandler!({ peerId: "departed", userId: "departed-user" });
    room.peers.closed = { userId: "closed-user" };
    room.joinHandler!({ peerId: "closed", userId: "closed-user" });
    await adapter.leave();
    clock.advance(5000);
    expect(onJoinError).toHaveBeenCalledOnce();
  });

  it("exchanges identity in the handshake and maps peer:joined", async () => {
    const { adapter, clock } = setup();
    const room = makeFakeRoom();
    mocks.joinRoom.mockReturnValue(room);
    mocks.relaySockets[RELAY] = { readyState: 1 };
    await joinConnected(adapter, clock);

    expect(room.ownIdentity).toEqual({
      v: 1,
      transportVersion: 5,
      memberId: "member-a",
      connectionId: "self-peer-id",
      displayName: "Ada",
    });

    const joined: TransportPeerInfo[] = [];
    adapter.on("peer:joined", (peer) => {
      joined.push(peer);
    });
    await simulatePeerJoin(capturedCallbacks(), room, "peer-1", {
      memberId: "member-b",
      connectionId: "conn-b",
      displayName: "Bea",
    });
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

  it.each([undefined, 1, 2, 3, 4])(
    "rejects incompatible transport version %s before actions",
    async (transportVersion) => {
      const onJoinError = vi.fn();
      const { adapter, clock } = setup({ onJoinError });
      const room = makeFakeRoom();
      mocks.joinRoom.mockReturnValue(room);
      mocks.relaySockets[RELAY] = { readyState: 1 };
      await joinConnected(adapter, clock);
      room.peers["old-peer"] = { userId: "old-user" };
      room.metas["old-user"] = { peerId: "old-peer", userId: "old-user", online: true };
      room.values["old-user"] = {
        v: 1,
        memberId: "old",
        connectionId: "old-conn",
        ...(transportVersion === undefined ? {} : { transportVersion }),
      };
      room.joinHandler!({ peerId: "old-peer", userId: "old-user" });
      expect(adapter.peers).toEqual([]);
      expect(onJoinError).toHaveBeenCalledWith(
        expect.objectContaining({ category: "incompatible_version", isFatal: true }),
      );
    },
  );

  it("fails the peer when the identity handshake is malformed (T10)", async () => {
    const onJoinError = vi.fn();
    const { adapter, clock } = setup({ onJoinError });
    const room = makeFakeRoom();
    mocks.joinRoom.mockReturnValue(room);
    mocks.relaySockets[RELAY] = { readyState: 1 };
    await joinConnected(adapter, clock);
    room.peers["peer-1"] = { userId: "user-1" };
    room.metas["user-1"] = { peerId: "peer-1", userId: "user-1", online: true };
    room.values["user-1"] = { v: 1, memberId: 42, connectionId: "" };
    room.joinHandler!({ peerId: "peer-1", userId: "user-1" });
    expect(onJoinError).toHaveBeenCalledWith(expect.objectContaining({ category: "rejected" }));
    expect(adapter.peers).toEqual([]);
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
    room.leaveHandler!({ peerId: "peer-1", userId: "user-peer-1" });
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

  it("delegates whole requests, limits, progress, timeout and abort to Trystero", async () => {
    const { adapter, room } = await joinedWithPeer();
    const config: Record<string, any> = {};
    const rpc = {
      request: vi.fn(),
      onRequest: (handler: unknown) => {
        config.onRequest = handler;
        return () => {
          config.onRequest = null;
        };
      },
      onReceive: (handler: unknown) => {
        config.onReceive = handler;
        return () => {
          config.onReceive = null;
        };
      },
      onReceiveProgress: (handler: unknown) => {
        config.onReceiveProgress = handler;
        return () => {
          config.onReceiveProgress = null;
        };
      },
    };
    room.makeAction.mockImplementationOnce(() => rpc);
    const handler = vi.fn(() => new Uint8Array([1, 2]));
    const unsubscribe = adapter.handleRequest("source", handler);
    const controller = new AbortController();
    const progress = vi.fn();
    rpc.request.mockImplementation(async () => {
      expect(
        config.onReceive?.({
          peerId: "peer-1",
          byteLength: 2,
          kind: "response",
          signal: controller.signal,
        }),
      ).toBe(true);
      expect(
        config.onReceive?.({
          peerId: "peer-1",
          byteLength: 3,
          kind: "response",
          signal: controller.signal,
        }),
      ).toBe(false);
      expect(
        config.onReceive?.({
          peerId: "stranger",
          byteLength: 1,
          kind: "response",
          signal: controller.signal,
        }),
      ).toBe(false);
      expect(
        config.onReceive?.({
          peerId: "peer-1",
          byteLength: 16385,
          kind: "request",
          signal: controller.signal,
        }),
      ).toBe(false);
      config.onReceiveProgress?.(0.5, { peerId: "peer-1" });
      return new Uint8Array([1, 2]);
    });
    const options = {
      channel: "source",
      payload: { game: "g" },
      targetConnectionId: "conn-b",
      timeoutMs: 1234,
      maxResponseBytes: 2,
      signal: controller.signal,
      onProgress: progress,
    };
    const pending = adapter.request(options);
    await expect(adapter.request(options)).rejects.toThrow("already active");
    await expect(pending).resolves.toEqual(new Uint8Array([1, 2]));
    expect(rpc.request).toHaveBeenCalledWith(
      { game: "g" },
      { target: "peer-1", timeoutMs: 1234, signal: controller.signal },
    );
    expect(progress).toHaveBeenCalledWith(0.5);
    await config.onRequest?.({}, { peerId: "peer-1", signal: controller.signal });
    expect(handler).toHaveBeenCalledWith(
      {},
      { senderMemberId: "member-b", senderConnectionId: "conn-b", signal: controller.signal },
    );
    unsubscribe();
    await expect(
      config.onRequest?.({}, { peerId: "peer-1", signal: controller.signal }),
    ).rejects.toThrow();
    await adapter.leave();
    expect(config.onRequest).toBeNull();
    expect(config.onReceive).toBeNull();
    expect(config.onReceiveProgress).toBeNull();
  });

  it("broadcasts only to admitted peers, never unadmitted or rejected peers", async () => {
    const { adapter, room } = await joinedWithPeer();
    room.peers.pending = { userId: "pending-user" };
    room.peers.rejected = { userId: "rejected-user" };
    room.metas["rejected-user"] = { peerId: "rejected", userId: "rejected-user", online: true };
    room.values["rejected-user"] = { v: 1, memberId: 42, connectionId: "" };
    room.joinHandler!({ peerId: "rejected", userId: "rejected-user" });
    await adapter.send({ channel: "raw", payload: { hello: 1 } });
    expect(room.action.send).toHaveBeenCalledTimes(1);
    expect(room.action.send).toHaveBeenCalledWith(
      { hello: 1 },
      expect.objectContaining({ target: "peer-1" }),
    );
  });

  it("continues a broadcast to other admitted peers when one disconnects", async () => {
    const { adapter, room } = await joinedWithPeer();
    await simulatePeerJoin(capturedCallbacks(), room, "peer-2", {
      memberId: "member-c",
      connectionId: "conn-c",
    });
    room.action.send.mockImplementation(async (_payload, options) => {
      if (options.target === "peer-1")
        throw Object.assign(new Error("disconnected"), { kind: "disconnected" });
    });
    await expect(adapter.send({ channel: "raw", payload: "hello" })).resolves.toBeUndefined();
    expect(room.action.send.mock.calls.map((call) => call[1].target)).toEqual(["peer-1", "peer-2"]);
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
    await simulatePeerJoin(capturedCallbacks(), room, "peer-1", {
      memberId: "member-b",
      connectionId: "conn-b",
    });
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
    await flushSetup();
    room.errorHandler!({
      code: "decrypt-failed",
      stage: "offer",
      message: "decrypt failed",
      appId: "app",
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
    const room = makeFakeRoom();
    mocks.joinRoom.mockReturnValue(room);
    mocks.relaySockets[RELAY] = { readyState: 1 };
    await joinConnected(adapter, clock);
    room.errorHandler!({
      code: "peer-connect-failed",
      turnConfigured: false,
      message: "connection failed",
      appId: "app",
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
    const changes: boolean[] = [];
    adapter.onRelayStateChange((connected) => {
      changes.push(connected);
    });
    const promise = adapter.join({ room: "ROOM", sessionId: "session-1" });
    // Wait for signaling derivation and identity initialization.
    await flushSetup();
    // first poll: CONNECTING
    expect(adapter.getSignalingConnected()).toBe(false);
    mocks.relaySockets[RELAY] = { readyState: 1 };
    clock.advance(1000);
    await promise;
    expect(adapter.getSignalingConnected()).toBe(true);

    mocks.relaySockets[RELAY] = { readyState: 3 };
    clock.advance(1000);
    expect(adapter.getSignalingConnected()).toBe(false);
    expect(changes).toEqual([false, true, false]);
  });

  it("stops polling after leave (engineering rule 22 cleanup)", async () => {
    const { adapter, clock } = setup();
    mocks.joinRoom.mockReturnValue(makeFakeRoom());
    mocks.relaySockets[RELAY] = { readyState: 1 };
    await joinConnected(adapter, clock);
    expect(adapter.getSignalingConnected()).toBe(true);
    await adapter.leave();
    // advance far past several poll intervals: nothing should blow up and the
    // monitor must not reschedule (no new relay-state events)
    clock.advance(10_000);
    expect(adapter.getSignalingConnected()).toBeNull();
  });

  it("ignores other rooms' sockets when checking signaling", async () => {
    const { adapter, clock } = setup({ relayConnectTimeoutMs: 5000 });
    const room = makeFakeRoom();
    mocks.joinRoom.mockReturnValue(room);
    mocks.relaySockets[RELAY] = { readyState: 0 };
    mocks.relaySockets["ws://other-room"] = { readyState: 1 };
    const promise = adapter.join({ room: "ROOM", sessionId: "session-1" });
    await flushSetup();
    clock.advance(5000);
    await expect(promise).rejects.toMatchObject({ category: "relay_unreachable" });
    expect(room.leave).toHaveBeenCalled();
  });
});

describe("TrysteroTransport leave / reconnect / suspend", () => {
  it("does not rejoin after leave races with reconnect's asynchronous room teardown", async () => {
    const { adapter, clock } = setup();
    const room = makeFakeRoom();
    mocks.joinRoom.mockReturnValue(room);
    mocks.relaySockets[RELAY] = { readyState: 1 };
    await joinConnected(adapter, clock);
    let finishLeave!: () => void;
    room.leave.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishLeave = resolve;
        }),
    );
    const reconnecting = adapter.reconnect();
    void reconnecting.catch(() => undefined);
    await adapter.leave();
    finishLeave();
    await Promise.resolve();
    await Promise.resolve();
    const joinCalls = mocks.joinRoom.mock.calls.length;
    if (adapter.connectionState === "joining") await adapter.leave();
    expect(joinCalls).toBe(1);
  });

  it("does not resume or restore suspended state while teardown races with leave", async () => {
    const { adapter, clock } = setup();
    const room = makeFakeRoom();
    mocks.joinRoom.mockReturnValue(room);
    mocks.relaySockets[RELAY] = { readyState: 1 };
    await joinConnected(adapter, clock);
    let finishLeave!: () => void;
    room.leave.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishLeave = resolve;
        }),
    );
    const suspending = adapter.suspend();
    const rejected = expect(suspending).rejects.toMatchObject({ category: "cancelled" });
    await expect(adapter.resume()).rejects.toMatchObject({ category: "invalid_state" });
    await adapter.leave();
    finishLeave();
    await rejected;
    expect(adapter.connectionState).toBe("disconnected");
    expect(mocks.joinRoom).toHaveBeenCalledTimes(1);
  });

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
    expect(room.joinHandler).toBeNull();
    expect(room.leaveHandler).toBeNull();
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
    await simulatePeerJoin(capturedCallbacks(), room, "peer-1", {
      memberId: "member-b",
      connectionId: "conn-b",
    });
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
