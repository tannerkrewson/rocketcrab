import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  NovaTransport,
  TransportMessage,
  TransportPeerInfo,
  TransportSendOptions,
} from "@rocketcrab/core";
import { InMemoryTransportHub } from "@rocketcrab/testing";
import type { InMemoryTransport } from "@rocketcrab/testing";
import { TrysteroTransport } from "./trystero-transport";

/**
 * Shared contract suite (P1 acceptance: the adapter passes the same contract
 * suite as InMemoryTransport). The SAME scenarios run against the in-memory
 * arena transport (U5) and the Trystero adapter (mocked, deterministic), and
 * assert identical observable behavior: connection-state sequences,
 * peer join/leave mapping, broadcast/targeted delivery with envelope fields,
 * and send rejection when not connected.
 */

/** A single transport client behind the shared contract. */
interface Client {
  readonly name: string;
  readonly transport: NovaTransport;
  /** Join the shared room. */
  join(): Promise<void>;
  leave(): Promise<void>;
  send(channel: string, payload: unknown, options?: Partial<TransportSendOptions>): Promise<void>;
  /** Make `this` observe `peer` as a connected peer. */
  observe(peer: Client): Promise<void>;
  /** Deliver all in-flight messages. */
  flush(): Promise<void>;
  dispose(): Promise<void>;
}

/** A world that can create clients for one transport implementation. */
interface World {
  readonly name: string;
  createClient(name: string, memberId: string, displayName?: string): Promise<Client>;
  /** Simulate remote-side effects of `leaver` leaving (no-op when automatic). */
  notifyPeerLeft(leaver: Client, observer: Client): Promise<void>;
  /** Tear down the whole world. */
  dispose(): Promise<void>;
}

// ---------------------------------------------------------------------------
// InMemoryTransport world (U5)
// ---------------------------------------------------------------------------

class InMemoryWorld implements World {
  readonly name = "in-memory";
  private readonly hub = new InMemoryTransportHub();
  private readonly transports: InMemoryTransport[] = [];
  private joined = false;

  async createClient(name: string, memberId: string, displayName?: string): Promise<Client> {
    const transport = this.hub.createTransport({ memberId, displayName });
    this.transports.push(transport);
    return {
      name,
      transport,
      join: async () => {
        await transport.join({ room: "ROOM", sessionId: "session-1" });
        this.joined = true;
      },
      leave: async () => {
        await transport.leave();
      },
      send: async (channel, payload, options) => {
        await transport.send({ channel, payload, ...options });
      },
      observe: async () => {
        // the hub pairs transports that join the same room automatically
        if (!this.joined) {
          throw new Error("InMemoryWorld.observe: peers must join first");
        }
      },
      flush: async () => {
        this.hub.drain();
      },
      dispose: async () => {
        await transport.leave();
      },
    };
  }

  async notifyPeerLeft(): Promise<void> {
    // the hub notifies remaining members when a transport leaves
  }

  async dispose(): Promise<void> {
    this.hub.dispose();
  }
}

// ---------------------------------------------------------------------------
// TrysteroTransport world (mocked, deterministic)
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => {
  const relaySockets: Record<string, { readyState: number }> = {};
  return { relaySockets, joinRoom: vi.fn(), selfId: "contract-self" };
});

// Per-page Trystero peer IDs: the real selfId is a per-module constant, but
// every simulated client shares this module, so the mock hands out a fresh
// peer ID per client (set before construction).
const selfIdHolder = vi.hoisted(() => ({ value: "contract-self" }));

vi.mock("trystero", () => ({
  joinRoom: mocks.joinRoom,
  getRelaySockets: () => mocks.relaySockets,
  get selfId() {
    return selfIdHolder.value;
  },
  defaultRelayUrls: ["wss://default.example"],
}));

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

interface FakeRoom {
  onPeerJoin: ((peerId: string) => void) | null;
  onPeerLeave: ((peerId: string) => void) | null;
  leave: ReturnType<typeof vi.fn>;
  makeAction: ReturnType<typeof vi.fn>;
  action: FakeAction;
}

function makeFakeRoom(): FakeRoom {
  const action: FakeAction = {
    onMessage: null,
    onReceiveProgress: null,
    send: vi.fn(async () => undefined),
  };
  return {
    onPeerJoin: null,
    onPeerLeave: null,
    leave: vi.fn(async () => undefined),
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

class TrysteroClientImpl implements Client {
  readonly name: string;
  readonly adapter: TrysteroTransport;
  readonly room: FakeRoom;
  /** client → the peerId that `this` observes for that client. */
  readonly peerIds = new Map<Client, string>();
  private deliveredSends = 0;
  private readonly clock: FakeClock;
  private ownCallbacks: Parameters<typeof mocks.joinRoom>[2] | null = null;

  constructor(name: string, memberId: string, displayName: string | undefined, clock: FakeClock) {
    this.name = name;
    this.clock = clock;
    this.adapter = new TrysteroTransport({
      memberId,
      displayName,
      now: clock.now,
      schedule: clock.schedule,
    });
    this.room = makeFakeRoom();
  }

  get transport(): NovaTransport {
    return this.adapter;
  }

  async join(): Promise<void> {
    mocks.joinRoom.mockReturnValue(this.room);
    const promise = this.adapter.join({ room: "ROOM", sessionId: "session-1" });
    this.clock.advance(1000);
    await promise;
    const call = mocks.joinRoom.mock.calls.at(-1);
    if (call === undefined) {
      throw new Error("TrysteroClientImpl: joinRoom was never called");
    }
    this.ownCallbacks = call[2];
  }

  async leave(): Promise<void> {
    await this.adapter.leave();
  }

  async send(
    channel: string,
    payload: unknown,
    options?: Partial<TransportSendOptions>,
  ): Promise<void> {
    await this.adapter.send({ channel, payload, ...options });
  }

  /** Simulate `peer` completing the identity handshake + join toward us. */
  async observe(peer: Client): Promise<void> {
    const other = peer as TrysteroClientImpl;
    const peerId = `peer-${other.name}`;
    const callbacks = this.ownCallbacks;
    if (callbacks === null) {
      throw new Error("TrysteroClientImpl.observe: join() first");
    }
    await callbacks.onPeerHandshake!(
      peerId,
      async () => undefined,
      async () => ({
        data: {
          v: 1,
          memberId: other.adapter.selfMemberId,
          connectionId: other.adapter.selfConnectionId,
          displayName: other.adapter.displayName,
        },
      }),
      false,
    );
    this.room.onPeerJoin!(peerId);
    this.peerIds.set(peer, peerId);
  }

  async flush(): Promise<void> {
    const calls = this.room.action.send.mock.calls;
    for (let i = this.deliveredSends; i < calls.length; i += 1) {
      const [data, options] = calls[i] as [
        unknown,
        { target?: string | string[] | null; metadata?: unknown },
      ];
      const peerIdTargets =
        options.target === null || options.target === undefined
          ? []
          : Array.isArray(options.target)
            ? options.target
            : [options.target];
      const isBroadcast = options.target === null || options.target === undefined;
      for (const [peer, peerId] of this.peerIds) {
        const targeted = peerIdTargets.includes(peerId);
        if (!isBroadcast && !targeted) {
          continue;
        }
        const target = peer as TrysteroClientImpl;
        // the context peerId must be the sender's peerId AS THE TARGET SEES IT
        const senderPeerId = target.peerIds.get(this);
        target.room.action.onMessage!(data, {
          peerId: senderPeerId ?? peerId,
          metadata: options.metadata,
        });
      }
    }
    this.deliveredSends = calls.length;
  }

  async dispose(): Promise<void> {
    await this.adapter.leave();
  }
}

class TrysteroWorld implements World {
  readonly name = "trystero";
  private readonly clock = makeFakeClock();
  private readonly clients: TrysteroClientImpl[] = [];

  async createClient(name: string, memberId: string, displayName?: string): Promise<Client> {
    // each simulated page gets its own Trystero peer ID (per-page constant)
    selfIdHolder.value = `contract-self-${name}`;
    const client = new TrysteroClientImpl(name, memberId, displayName, this.clock);
    this.clients.push(client);
    return client;
  }

  async notifyPeerLeft(leaver: Client, observer: Client): Promise<void> {
    const observerImpl = observer as TrysteroClientImpl;
    const peerId = observerImpl.peerIds.get(leaver);
    if (peerId !== undefined) {
      observerImpl.room.onPeerLeave!(peerId);
    }
  }

  async dispose(): Promise<void> {
    await Promise.all(this.clients.map((client) => client.adapter.leave()));
  }
}

// ---------------------------------------------------------------------------
// Shared scenarios
// ---------------------------------------------------------------------------

function collect(
  transport: NovaTransport,
  event: "peer:joined" | "peer:left",
): TransportPeerInfo[] {
  const events: TransportPeerInfo[] = [];
  transport.on(event, (peer) => {
    events.push(peer);
  });
  return events;
}

function collectMessages(transport: NovaTransport): TransportMessage[] {
  const messages: TransportMessage[] = [];
  transport.on("message:received", (message) => {
    messages.push(message);
  });
  return messages;
}

function joinPair(world: World): Promise<{ a: Client; b: Client }> {
  return (async () => {
    const a = await world.createClient("a", "member-a", "Ada");
    const b = await world.createClient("b", "member-b", "Bea");
    await a.join();
    await b.join();
    await a.observe(b);
    await b.observe(a);
    await a.flush();
    await b.flush();
    return { a, b };
  })();
}

const worlds: Array<() => World> = [() => new InMemoryWorld(), () => new TrysteroWorld()];

for (const createWorld of worlds) {
  describe(`contract suite: ${createWorld().name}`, () => {
    let world: World;

    beforeEach(() => {
      world = createWorld();
      mocks.joinRoom.mockReset();
      for (const key of Object.keys(mocks.relaySockets)) {
        delete mocks.relaySockets[key];
      }
      mocks.relaySockets["wss://relay.damus.io"] = { readyState: 1 };
    });

    afterEach(async () => {
      mocks.joinRoom.mockReset();
      await world.dispose();
    });

    it("joins with joining → connected and reports peers in join order", async () => {
      const { a, b } = await joinPair(world);
      expect(a.transport.connectionState).toBe("connected");
      expect(b.transport.connectionState).toBe("connected");
      expect(a.transport.peers.map((peer) => peer.memberId)).toEqual(["member-b"]);
      expect(b.transport.peers.map((peer) => peer.memberId)).toEqual(["member-a"]);
      await a.dispose();
      await b.dispose();
    });

    it("broadcasts structured messages to every peer with envelope fields", async () => {
      const { a, b } = await joinPair(world);
      const receivedB = collectMessages(b.transport);
      await a.send("raw", { type: "action.dispatch", seq: 1, payload: { card: "ace" } });
      await a.flush();
      await b.flush();
      expect(receivedB).toHaveLength(1);
      expect(receivedB[0]).toMatchObject({
        channel: "raw",
        sessionId: "session-1",
        senderMemberId: "member-a",
        binary: false,
        payload: { type: "action.dispatch", seq: 1, payload: { card: "ace" } },
      });
      expect(receivedB[0]!.senderConnectionId).toBeTruthy();
      expect(receivedB[0]!.messageId).toBeTruthy();
      await a.dispose();
      await b.dispose();
    });

    it("targets sends at one connection only", async () => {
      const third = await world.createClient("c", "member-c");
      await third.join();
      const { a, b } = await joinPair(world);
      await a.observe(third);
      await third.observe(a);
      const receivedB = collectMessages(b.transport);
      const receivedC = collectMessages(third.transport);

      // target b by connectionId (a's view of b)
      const bConnectionId = a.transport.peers.find((p) => p.memberId === "member-b")!.connectionId;
      await a.send("raw", "to-b", { targetConnectionId: bConnectionId });
      await a.flush();
      await b.flush();
      await third.flush();

      expect(receivedB).toHaveLength(1);
      expect(receivedB[0]!.payload).toBe("to-b");
      expect(receivedC).toHaveLength(0);
      await a.dispose();
      await b.dispose();
      await third.dispose();
    });

    it("leaving emits peer:left and rejects further sends", async () => {
      const { a, b } = await joinPair(world);
      const leftOnB = collect(b.transport, "peer:left");
      await a.leave();
      await world.notifyPeerLeft(a, b);
      await b.flush();
      expect(leftOnB).toHaveLength(1);
      expect(leftOnB[0]!.memberId).toBe("member-a");
      expect(b.transport.peers).toHaveLength(0);
      await expect(a.send("raw", "x")).rejects.toThrow(/not connected/);
      await b.dispose();
    });

    it("rejects sends before joining", async () => {
      const client = await world.createClient("solo", "member-solo");
      await expect(client.send("raw", "x")).rejects.toThrow(/not connected/);
      await client.dispose();
    });
  });
}
