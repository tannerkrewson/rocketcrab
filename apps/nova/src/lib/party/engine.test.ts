import { beforeEach, describe, expect, it } from "vitest";
// The complete S4 example game document, verbatim (Vite ?raw import).
import EXAMPLE_GAME_SOURCE from "../../../../../examples/games/nova-quiz.html?raw";
import { parseInviteFragment, type PartyTransportFactory } from "@rocketcrab/party";
import type { NovaTransport, TransportEventMap } from "@rocketcrab/core";
import { InMemoryTransportHub } from "@rocketcrab/testing";
import type { ChannelPort } from "../runtime-host";
import { PartyEngine, type PartyRuntimeSeams } from "./engine";
import { createMemoryLifecycleSource } from "./lifecycle";
import { clearPartyRecovery, readPartyRecovery } from "./party-recovery";

/**
 * P4 party-engine integration tests: the complete user-facing party flow
 * over the in-memory transport with a fake clock (deterministic) and fake
 * runtime bridges (the same seams RuntimeHostClient exposes). Covers the
 * acceptance criteria: two players create/join/receive a game and reach the
 * play shell, start is gated on readiness (and on source verification),
 * a failed peer never freezes the lobby, invite joins bypass the code,
 * greeter migration after the creator leaves, reconnect after connection
 * loss, and cleanup removes every transport room and runtime frame.
 */

const GAME = {
  gameId: "game_rocket_1",
  title: "Rocket Rumble",
  mode: "state" as const,
  source: "<!doctype html><html><body><p>rockets</p></body></html>",
};

// ---------------------------------------------------------------------------
// Fake clock + world (same pattern as the party package tests)
// ---------------------------------------------------------------------------

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

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function settle(world: World): Promise<void> {
  for (let i = 0; i < 10; i += 1) {
    world.hub.drain();
    await flush();
  }
}

function mockDerive(secret: string) {
  return Promise.resolve({
    secret,
    roomId: `party:test:${secret.slice(0, 12)}`,
    password: `pwd-${secret.slice(0, 16)}`,
    sessionId: `session-${secret.slice(0, 12)}`,
  });
}

// ---------------------------------------------------------------------------
// Fake runtime bridge (same pattern as EditorPage.test.tsx)
// ---------------------------------------------------------------------------

interface FakePort extends ChannelPort {
  sent: unknown[];
  closed: boolean;
}

function createFakePort(): FakePort {
  const port: FakePort = {
    sent: [],
    closed: false,
    onmessage: null,
    onmessageerror: null,
    postMessage(message: unknown): void {
      port.sent.push(message);
    },
    close(): void {
      port.closed = true;
    },
  };
  return port;
}

function deliver(port: FakePort, message: unknown): void {
  port.onmessage?.({ data: message } as MessageEvent);
}

interface HostHarness {
  seams: PartyRuntimeSeams;
  frames: HTMLIFrameElement[];
  port1: FakePort;
  ready(): void;
  register(title: string): void;
  apiCall(method: string, payload: unknown): void;
}

function createHostHarness(): HostHarness {
  const frames: HTMLIFrameElement[] = [];
  const ports: FakePort[] = [];
  const harness: HostHarness = {
    seams: {
      createChannel() {
        const port1 = createFakePort();
        const port2 = createFakePort();
        ports.push(port1);
        return { port1, port2 };
      },
      async waitForFrameLoad(iframe) {
        frames.push(iframe);
      },
    },
    frames,
    get port1() {
      return ports.at(-1) as FakePort;
    },
    ready() {
      deliver(harness.port1, {
        version: 1,
        runtimeInstanceId: "runtime-1",
        messageId: "message-ready",
        sentAt: 1_700_000_000_000,
        type: "runtime.ready",
        status: "ready",
      });
    },
    register(title: string) {
      deliver(harness.port1, {
        version: 1,
        runtimeInstanceId: "runtime-1",
        messageId: "message-reg",
        sentAt: 1_700_000_000_001,
        type: "game.registration",
        gameId: GAME.gameId,
        title,
        gameMode: "state",
      });
    },
    apiCall(method: string, payload: unknown) {
      deliver(harness.port1, {
        version: 1,
        runtimeInstanceId: "runtime-1",
        messageId: "message-call",
        sentAt: 1_700_000_000_002,
        type: "game.apiCall",
        method,
        payload,
      });
    },
  };
  return harness;
}

// ---------------------------------------------------------------------------
// Player + flow helpers
// ---------------------------------------------------------------------------

interface Player {
  engine: PartyEngine;
  harness: HostHarness;
  container: HTMLDivElement;
  memberId: string;
  displayName: string;
}

interface World {
  clock: FakeClock;
  hub: InMemoryTransportHub;
  transports: Array<ReturnType<InMemoryTransportHub["createTransport"]>>;
  factory: PartyTransportFactory;
}

function makeWorld(): World {
  const clock = makeFakeClock();
  const hub = new InMemoryTransportHub({ schedule: clock.schedule, now: clock.now });
  const transports: World["transports"] = [];
  const factory: PartyTransportFactory = {
    createRendezvousTransport: (identity) => {
      const transport = hub.createTransport(identity);
      transports.push(transport);
      return transport;
    },
    createPrivateTransport: (identity) => {
      const transport = hub.createTransport(identity);
      transports.push(transport);
      return transport;
    },
  };
  return { clock, hub, transports, factory };
}

function makePlayer(
  world: World,
  id: string,
  overrides: ConstructorParameters<typeof PartyEngine>[0] = {},
): Player {
  const harness = createHostHarness();
  const memberId = `member-${id}`;
  const engine = new PartyEngine({
    transportFactory: world.factory,
    schedule: world.clock.schedule,
    derive: mockDerive,
    seams: harness.seams,
    identity: { memberId, displayName: `Player ${id}` },
    collisionListenMs: 1_000,
    collisionRetries: 2,
    discoveryTimeoutMs: 20_000,
    admissionTimeoutMs: 30_000,
    advertIntervalMs: 5_000,
    ...overrides,
  });
  const container = document.createElement("div");
  engine.setContainer(container);
  return { engine, harness, container, memberId, displayName: `Player ${id}` };
}

/** Create a party, advancing through the collision-listen window. */
async function runCreate(player: Player, world: World): Promise<string> {
  const promise = player.engine.createParty({
    gameId: GAME.gameId,
    title: GAME.title,
    mode: GAME.mode,
    source: GAME.source,
  });
  for (let i = 0; i < 8; i += 1) {
    await flush();
    world.clock.advance(1_000);
  }
  await settle(world);
  await promise;
  const code = player.engine.getState().code;
  expect(code).toMatch(/^[A-Z]{4}$/);
  return code as string;
}

/** Join by code up to the point the greeter must approve. */
function startJoin(
  player: Player,
  world: World,
  code: string,
): { join: Promise<void>; settled: Promise<void> } {
  const join = player.engine.joinByCode(code);
  const settled = (async () => {
    await flush();
    world.clock.advance(5_000); // the greeter's advert fires
    await settle(world);
    world.clock.advance(2_000); // the advert settle window closes
    await settle(world);
  })();
  return { join, settled };
}

/** Make the local game register: ready + registration → auto-ready. */
async function registerLocalGame(player: Player, world: World): Promise<void> {
  player.harness.ready();
  player.harness.register(GAME.title);
  await settle(world);
}

function memberOf(state: ReturnType<PartyEngine["getState"]>, memberId: string) {
  const member = state.members.find((candidate) => candidate.memberId === memberId);
  if (member === undefined) {
    throw new Error(`no member ${memberId} in ${state.members.map((m) => m.memberId).join(",")}`);
  }
  return member;
}

beforeEach(() => {
  document.body.innerHTML = "";
  clearPartyRecovery();
});

describe("party engine — two phones end to end", () => {
  it("creates, joins, transfers the game, gets ready, starts, and ends", async () => {
    const world = makeWorld();
    const a = makePlayer(world, "a");
    const b = makePlayer(world, "b");

    // Creator: party is live, lobby shows the code + invite.
    const code = await runCreate(a, world);
    const creatorState = a.engine.getState();
    expect(creatorState.phase).toBe("lobby");
    expect(creatorState.role).toBe("creator");
    expect(creatorState.members).toHaveLength(1);
    expect(creatorState.inviteUrl).toContain(`/join#code=${code}&secret=`);
    expect(creatorState.greeterMemberId).toBe(a.memberId);
    expect(creatorState.amGreeter).toBe(true);

    // The creator's game boots and registers → ready.
    await registerLocalGame(a, world);
    expect(a.engine.getState().members[0]?.ready).toBe(true);

    // Joiner: joins by the four-letter code; the creator approves.
    const { join: joinPromise, settled } = startJoin(b, world, code);
    await settled;
    const pending = a.engine.getState().pendingJoinRequests;
    expect(pending).toHaveLength(1);
    expect(pending[0]?.displayName).toBe(b.displayName);
    a.engine.respondToJoinRequest(pending[0]?.memberId ?? "", true);
    await settle(world);
    await joinPromise;

    // Both lobbies show two connected members.
    expect(b.engine.getState().phase).toBe("lobby");
    expect(b.engine.getState().role).toBe("joiner");
    expect(a.engine.getState().members).toHaveLength(2);
    expect(b.engine.getState().members).toHaveLength(2);

    // The game transfers to the joiner (P3) and its frame boots.
    await settle(world);
    expect(memberOf(b.engine.getState(), b.memberId).transferState).toBe("complete");
    await registerLocalGame(b, world);

    // Ready propagates BOTH ways (the late-attach ready race is covered).
    const aReady = memberOf(a.engine.getState(), a.memberId).ready;
    const bReady = memberOf(a.engine.getState(), b.memberId).ready;
    expect(aReady).toBe(true);
    expect(bReady).toBe(true);
    expect(memberOf(b.engine.getState(), a.memberId).ready).toBe(true);

    // Start is enabled on both phones; the creator starts.
    expect(a.engine.getState().canStart).toBe(true);
    expect(b.engine.getState().canStart).toBe(true);
    a.engine.startGame();
    await settle(world);
    expect(a.engine.getState().phase).toBe("playing");
    expect(b.engine.getState().phase).toBe("playing");

    // Emergency teardown: the game ends for everyone and returns to lobby.
    a.engine.endGame("host_closed");
    await settle(world);
    expect(a.engine.getState().phase).toBe("lobby");
    expect(b.engine.getState().phase).toBe("lobby");
    expect(a.engine.getState().endedReason).toBe("host_closed");
    expect(b.engine.getState().endedReason).toBe("host_closed");

    // Cleanup: leaving removes every transport room and destroys frames.
    await a.engine.leaveParty();
    await b.engine.leaveParty();
    await settle(world);
    expect(a.engine.getState().phase).toBe("idle");
    expect(b.engine.getState().phase).toBe("idle");
    expect(world.hub.roomNames().every((room) => world.hub.membersOf(room).length === 0)).toBe(
      true,
    );
    expect(a.harness.frames[0]?.isConnected).toBe(false);
    expect(b.harness.frames[0]?.isConnected).toBe(false);
  });

  it("joins by invite link secret without the four-letter code (ADR-0011)", async () => {
    const world = makeWorld();
    const a = makePlayer(world, "a");
    const b = makePlayer(world, "b");
    await runCreate(a, world);
    await registerLocalGame(a, world);

    const inviteUrl = a.engine.getState().inviteUrl;
    expect(inviteUrl).not.toBeNull();
    const invite = parseInviteFragment(new URL(inviteUrl as string).hash);
    expect(invite).not.toBeNull();
    expect(invite?.secret).toBeDefined();

    const joinPromise = b.engine.joinByInvite({
      secret: invite?.secret as string,
      code: invite?.code,
    });
    await settle(world);
    await joinPromise;
    expect(b.engine.getState().phase).toBe("lobby");
    expect(b.engine.getState().code).toBe(a.engine.getState().code);
    await settle(world);
    expect(memberOf(b.engine.getState(), b.memberId).transferState).toBe("complete");
  });
});

describe("party engine — readiness and start gating", () => {
  it("prevents starting until every player is ready; force-start works once verified", async () => {
    const world = makeWorld();
    const a = makePlayer(world, "a");
    const b = makePlayer(world, "b");
    const code = await runCreate(a, world);
    await registerLocalGame(a, world);

    const { join: joinPromise, settled } = startJoin(b, world, code);
    await settled;
    a.engine.respondToJoinRequest(b.memberId, true);
    await settle(world);
    await joinPromise;
    await settle(world);
    expect(memberOf(b.engine.getState(), b.memberId).transferState).toBe("complete");

    // The joiner has the game but is NOT ready: start is blocked, but
    // force-start is available (the source is verified on both sides).
    const blocked = a.engine.getState();
    expect(blocked.canStart).toBe(false);
    expect(blocked.canForceStart).toBe(true);
    expect(blocked.startBlockedReason).toMatch(/load and register/i);

    // Force-start begins the game anyway.
    a.engine.startGame(true);
    await settle(world);
    expect(a.engine.getState().phase).toBe("playing");
    expect(b.engine.getState().phase).toBe("playing");
  });

  it("a player whose game never loads does not freeze the lobby", async () => {
    const world = makeWorld();
    const a = makePlayer(world, "a");
    const b = makePlayer(world, "b");
    const code = await runCreate(a, world);
    await registerLocalGame(a, world);

    const { join: joinPromise, settled } = startJoin(b, world, code);
    await settled;
    a.engine.respondToJoinRequest(b.memberId, true);
    await settle(world);
    await joinPromise;
    await settle(world);

    // The joiner received the game but its runtime never boots (no ready
    // delivered): the creator's lobby keeps working — members are listed,
    // start is blocked with a clear reason, and the creator can still leave.
    const state = a.engine.getState();
    expect(state.members).toHaveLength(2);
    expect(state.canStart).toBe(false);
    expect(state.startBlockedReason).toMatch(/load and register/i);
    expect(state.notices.some((notice) => notice.level === "info")).toBe(true);

    await a.engine.leaveParty();
    await b.engine.leaveParty();
    await settle(world);
    expect(world.hub.roomNames().every((room) => world.hub.membersOf(room).length === 0)).toBe(
      true,
    );
  });

  it("rejects a join request; the joiner sees a clear error and can retry", async () => {
    const world = makeWorld();
    const a = makePlayer(world, "a");
    const b = makePlayer(world, "b");
    const code = await runCreate(a, world);

    const { join: joinPromise, settled } = startJoin(b, world, code);
    await settled;
    const pending = a.engine.getState().pendingJoinRequests;
    expect(pending).toHaveLength(1);
    a.engine.respondToJoinRequest(pending[0]?.memberId ?? "", false);
    await settle(world);
    await expect(joinPromise).resolves.toBeUndefined();

    expect(b.engine.getState().phase).toBe("error");
    expect(b.engine.getState().lastError).toMatch(/rejected/i);
    expect(a.engine.getState().members).toHaveLength(1);
  });

  it("creates a party without a game; the lobby blocks start until one is picked (7.6)", async () => {
    const world = makeWorld();
    const a = makePlayer(world, "a");
    const promise = a.engine.createParty(); // no game preselected
    for (let i = 0; i < 8; i += 1) {
      await flush();
      world.clock.advance(1_000);
    }
    await settle(world);
    await promise;

    let state = a.engine.getState();
    expect(state.phase).toBe("lobby");
    expect(state.role).toBe("creator");
    expect(state.game).toBeNull();
    expect(state.canStart).toBe(false);
    expect(state.canForceStart).toBe(false);
    expect(state.startBlockedReason).toMatch(/pick a game/i);

    // Picking a game from the lobby registers + announces the source.
    await a.engine.selectGame({
      gameId: GAME.gameId,
      title: GAME.title,
      mode: GAME.mode,
      source: GAME.source,
    });
    await settle(world);
    state = a.engine.getState();
    expect(state.game).toEqual({ gameId: GAME.gameId, title: GAME.title, mode: GAME.mode });
    expect(a.harness.frames).toHaveLength(1); // the lobby preview frame booted

    await a.engine.leaveParty();
    await settle(world);
    expect(world.hub.roomNames().every((room) => world.hub.membersOf(room).length === 0)).toBe(
      true,
    );
  });

  it("a join for a nonexistent code fails fast and can be retried from the error phase (7.10)", async () => {
    const world = makeWorld();
    const b = makePlayer(world, "b", { earlyMissTimeoutMs: 1_000 });

    const join = b.engine.joinByCode("ZZZZ");
    await flush();
    world.clock.advance(1_000); // the early-miss window closes: no peer at all
    await settle(world);
    await join;

    const failed = b.engine.getState();
    expect(failed.phase).toBe("error");
    expect(failed.lastError).toMatch(/no party is advertising/i);

    // The old code threw "already active" when retrying from the error
    // phase; a retry must now start clean and reach the same clear error.
    const retry = b.engine.joinByCode("ZZZZ");
    await flush();
    world.clock.advance(1_000);
    await settle(world);
    await retry;
    expect(b.engine.getState().phase).toBe("error");
    expect(b.engine.getState().lastError).toMatch(/no party is advertising/i);

    // Dismissing the error returns to the idle entry UI without a toast.
    b.engine.dismissError();
    expect(b.engine.getState().phase).toBe("idle");
  });

  it("setDisplayName updates the local display name (7.5)", async () => {
    const world = makeWorld();
    const a = makePlayer(world, "a");
    await runCreate(a, world);

    a.engine.setDisplayName("Grace");
    expect(a.engine.getState().displayName).toBe("Grace");
    expect(a.engine.getState().members.find((m) => m.isSelf)?.displayName).toBe("Grace");

    await a.engine.leaveParty();
    await settle(world);
    // The saved name survives a page reload: a fresh engine on the same
    // localStorage picks it up through the identity module (tested in
    // identity.test.ts); here we only verify the engine persists it.
    expect(window.localStorage.getItem("nova:player:name:v1")).toBe("Grace");
  });
});

describe("party engine — roles, reconnect, and cleanup", () => {
  it("the creator can leave; the joiner becomes the greeter (migration)", async () => {
    const world = makeWorld();
    const a = makePlayer(world, "a");
    const b = makePlayer(world, "b");
    const code = await runCreate(a, world);
    const { join: joinPromise, settled } = startJoin(b, world, code);
    await settled;
    a.engine.respondToJoinRequest(b.memberId, true);
    await settle(world);
    await joinPromise;
    await settle(world);

    // The creator leaves; the joiner's party session elects it greeter.
    await a.engine.leaveParty();
    await settle(world);
    expect(a.engine.getState().phase).toBe("idle");
    const bState = b.engine.getState();
    expect(bState.greeterMemberId).toBe(b.memberId);
    expect(bState.amGreeter).toBe(true);
    await b.engine.leaveParty();
    await settle(world);
    expect(world.hub.roomNames().every((room) => world.hub.membersOf(room).length === 0)).toBe(
      true,
    );
  });

  it("connection loss shows the reconnect screen; resume returns to the lobby", async () => {
    const world = makeWorld();
    const a = makePlayer(world, "a");
    await runCreate(a, world);

    const privateTransport = world.transports.find((t) => t.selfMemberId === a.memberId);
    expect(privateTransport).toBeDefined();
    await privateTransport?.suspend();
    await settle(world);
    expect(a.engine.getState().phase).toBe("reconnecting");

    await privateTransport?.resume();
    await settle(world);
    expect(a.engine.getState().phase).toBe("lobby");
  });

  it("leave cleans up every room and destroys the runtime frame", async () => {
    const world = makeWorld();
    const a = makePlayer(world, "a");
    await runCreate(a, world);
    expect(world.hub.roomNames().length).toBeGreaterThan(0);
    expect(a.harness.frames).toHaveLength(1);

    await a.engine.leaveParty();
    await settle(world);
    expect(a.engine.getState().phase).toBe("idle");
    expect(world.hub.roomNames().every((room) => world.hub.membersOf(room).length === 0)).toBe(
      true,
    );
    expect(a.harness.frames[0]?.isConnected).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// S4: the state-mode vertical-slice example game through the party flow
// ---------------------------------------------------------------------------

/**
 * The complete example game document (examples/games/nova-quiz.html) travels
 * the same P4 path as any saved game: the creator registers it with the
 * party, the joiner receives the verified source, both frames boot and
 * register, the game starts, and the emergency teardown returns everyone to
 * the lobby. The example game rides the party's private transport exactly
 * like a real saved game (P3 game-source transfer + S1 session).
 */
const EXAMPLE_GAME = {
  gameId: "game_nova_quiz_1",
  title: "Nova Quiz",
  mode: "state" as const,
  source: EXAMPLE_GAME_SOURCE,
};

describe("the S4 example game over the party flow", () => {
  it("creates, transfers, starts, and ends with the example game source", async () => {
    expect(EXAMPLE_GAME.source).toContain("Nova Quiz");
    const world = makeWorld();
    const a = makePlayer(world, "a");
    const b = makePlayer(world, "b");

    // Creator: party is live with the example game as the pending source.
    const promise = a.engine.createParty({
      gameId: EXAMPLE_GAME.gameId,
      title: EXAMPLE_GAME.title,
      mode: EXAMPLE_GAME.mode,
      source: EXAMPLE_GAME.source,
    });
    for (let i = 0; i < 8; i += 1) {
      await flush();
      world.clock.advance(1_000);
    }
    await settle(world);
    await promise;
    const code = a.engine.getState().code;
    expect(code).toMatch(/^[A-Z]{4}$/);
    expect(a.engine.getState().game?.title).toBe("Nova Quiz");

    // The creator's frame boots and registers the example game.
    await registerLocalGame(a, world);
    expect(a.engine.getState().members[0]?.ready).toBe(true);

    // Joiner joins by code; the creator approves.
    const join = b.engine.joinByCode(code as string);
    const settled = (async () => {
      await flush();
      world.clock.advance(5_000);
      await settle(world);
      world.clock.advance(2_000);
      await settle(world);
    })();
    await settled;
    const pending = a.engine.getState().pendingJoinRequests;
    expect(pending).toHaveLength(1);
    a.engine.respondToJoinRequest(pending[0]?.memberId ?? "", true);
    await settle(world);
    await join;

    // The 40 KB example document transfers byte-identically (P3) and the
    // joiner's frame boots and registers.
    await settle(world);
    expect(memberOf(b.engine.getState(), b.memberId).transferState).toBe("complete");
    await registerLocalGame(b, world);
    expect(a.engine.getState().canStart).toBe(true);
    expect(b.engine.getState().canStart).toBe(true);

    // Start reaches both phones; the game's own declaration ("state" mode,
    // title) is what the session runs.
    a.engine.startGame();
    await settle(world);
    expect(a.engine.getState().phase).toBe("playing");
    expect(b.engine.getState().phase).toBe("playing");

    // Emergency teardown: the game ends for everyone and returns to lobby.
    a.engine.endGame("host_closed");
    await settle(world);
    expect(a.engine.getState().phase).toBe("lobby");
    expect(b.engine.getState().phase).toBe("lobby");
    expect(a.engine.getState().endedReason).toBe("host_closed");

    // Cleanup leaves every room empty.
    await a.engine.leaveParty();
    await b.engine.leaveParty();
    await settle(world);
    expect(world.hub.roomNames().every((room) => world.hub.membersOf(room).length === 0)).toBe(
      true,
    );
  });
});

// ---------------------------------------------------------------------------
// M1 — Mobile Safari lifecycle resilience (ADR-0012 / Blocker Register B6)
// ---------------------------------------------------------------------------

/**
 * A transport wrapper that reports the delegate's state but whose pings
 * never answer — the F11 shape: a backgrounded phone whose WebRTC link iOS
 * killed silently, so the local transport still believes it is connected.
 * The engine's resume health probe must detect this and rejoin fresh.
 */
class StalePingTransport implements NovaTransport {
  readonly kind = "in-memory";

  constructor(private readonly delegate: NovaTransport) {}

  get selfMemberId(): string {
    return this.delegate.selfMemberId;
  }
  get selfConnectionId(): string {
    return this.delegate.selfConnectionId;
  }
  get connectionState() {
    return this.delegate.connectionState;
  }
  get sessionId() {
    return this.delegate.sessionId;
  }
  get peers() {
    return this.delegate.peers;
  }
  on<K extends keyof TransportEventMap>(event: K, handler: TransportEventMap[K]): () => void {
    return this.delegate.on(event, handler);
  }
  join(request: Parameters<NovaTransport["join"]>[0]): Promise<void> {
    return this.delegate.join(request);
  }
  leave(): Promise<void> {
    return this.delegate.leave();
  }
  reconnect(): Promise<void> {
    return this.delegate.reconnect();
  }
  suspend(): Promise<void> {
    return this.delegate.suspend();
  }
  resume(): Promise<void> {
    return this.delegate.resume();
  }
  send(options: Parameters<NovaTransport["send"]>[0]): Promise<void> {
    return this.delegate.send(options);
  }
  /** The lying probe: peers never answer, even though the link looks up. */
  ping(): Promise<number | null> {
    return Promise.resolve(null);
  }
}

/** A world whose named member's private transport lies about pings (F11). */
function makeWorldWithStaleJoiner(joinerMemberId: string): World {
  const world = makeWorld();
  const baseCreatePrivate = world.factory.createPrivateTransport.bind(world.factory);
  world.factory.createPrivateTransport = (identity) => {
    const transport = baseCreatePrivate(identity);
    return identity.memberId === joinerMemberId ? new StalePingTransport(transport) : transport;
  };
  return world;
}

describe("party engine — M1 lifecycle: backgrounding, resume, and F11 rejoin", () => {
  it("a backgrounded phone whose link went quiet rejoins with a fresh connection (F11)", async () => {
    const world = makeWorldWithStaleJoiner("member-b");
    const lifecycle = createMemoryLifecycleSource();
    const a = makePlayer(world, "a");
    const b = makePlayer(world, "b", { lifecycle: lifecycle.source });
    const code = await runCreate(a, world);
    await registerLocalGame(a, world);

    const { join: joinPromise, settled } = startJoin(b, world, code);
    await settled;
    a.engine.respondToJoinRequest(b.memberId, true);
    await settle(world);
    await joinPromise;
    await settle(world);
    expect(memberOf(b.engine.getState(), b.memberId).transferState).toBe("complete");
    await registerLocalGame(b, world);
    expect(a.engine.getState().members).toHaveLength(2);

    // The phone backgrounds; iOS kills the WebRTC link, but the transport
    // does not notice (it still reports connected). On return, the resume
    // health probe must catch the dead link and rejoin with a fresh
    // connection id instead of sitting on the stale handle.
    lifecycle.hide();
    expect(b.engine.getState().connectionState).toBe("connected");
    lifecycle.show();
    await settle(world);

    const bState = b.engine.getState();
    expect(bState.phase).toBe("lobby");
    expect(bState.connectionState).toBe("connected");
    expect(bState.reconnectAttempts).toBe(0);
    expect(bState.members).toHaveLength(2);
    // The other phone observed the leave + clean rejoin (F11: no stale peer).
    expect(a.engine.getState().members).toHaveLength(2);
  });

  it("going offline enters the reconnect flow; coming back online reconnects automatically", async () => {
    const world = makeWorld();
    const lifecycle = createMemoryLifecycleSource();
    const a = makePlayer(world, "a", { lifecycle: lifecycle.source });
    await runCreate(a, world);
    expect(a.engine.getState().phase).toBe("lobby");

    lifecycle.goOffline();
    expect(a.engine.getState().phase).toBe("reconnecting");
    expect(a.engine.getState().phaseDetail).toMatch(/offline/i);

    lifecycle.goOnline();
    await settle(world);
    expect(a.engine.getState().phase).toBe("lobby");
  });

  it("auto-retries with backoff while the connection stays down, then recovers", async () => {
    const world = makeWorld();
    const a = makePlayer(world, "a");
    await runCreate(a, world);

    const privateTransport = world.transports.find((t) => t.selfMemberId === a.memberId);
    await privateTransport?.suspend();
    await settle(world);
    expect(a.engine.getState().phase).toBe("reconnecting");

    // No manual reconnect: the scheduled auto-retry fires after the base
    // backoff delay and rejoins.
    world.clock.advance(5_000);
    await settle(world);
    expect(a.engine.getState().phase).toBe("lobby");
    expect(a.engine.getState().reconnectAttempts).toBe(0);
  });

  it("reconnect() reports attempts while reconnecting and resets on success", async () => {
    const world = makeWorld();
    const a = makePlayer(world, "a");
    await runCreate(a, world);

    const privateTransport = world.transports.find((t) => t.selfMemberId === a.memberId);
    await privateTransport?.suspend();
    await settle(world);
    expect(a.engine.getState().phase).toBe("reconnecting");

    const reconnectPromise = a.engine.reconnect();
    await settle(world);
    await reconnectPromise;
    expect(a.engine.getState().phase).toBe("lobby");
    expect(a.engine.getState().reconnectAttempts).toBe(0);
  });

  it("rejoins with a fresh join when a failed attempt tore the room down", async () => {
    const world = makeWorld();
    const a = makePlayer(world, "a");
    await runCreate(a, world);

    // A failed reconnect on a real device tears the room down and leaves
    // the transport idle/disconnected (relay_unreachable while offline);
    // the next retry must re-join the private room from the party material.
    const privateTransport = world.transports.find((t) => t.selfMemberId === a.memberId);
    await privateTransport?.leave();
    await settle(world);
    expect(a.engine.getState().phase).toBe("reconnecting");

    const reconnectPromise = a.engine.reconnect();
    await settle(world);
    await reconnectPromise;
    expect(a.engine.getState().phase).toBe("lobby");
    expect(a.engine.getState().connectionState).toBe("connected");
  });

  it("a playing phone that backgrounds and returns rejoins into the playing game (S4 slice)", async () => {
    const world = makeWorld();
    const lifecycle = createMemoryLifecycleSource();
    const a = makePlayer(world, "a");
    const b = makePlayer(world, "b", { lifecycle: lifecycle.source });
    const code = await runCreate(a, world);
    await registerLocalGame(a, world);

    const { join: joinPromise, settled } = startJoin(b, world, code);
    await settled;
    a.engine.respondToJoinRequest(b.memberId, true);
    await settle(world);
    await joinPromise;
    await settle(world);
    await registerLocalGame(b, world);
    a.engine.startGame();
    await settle(world);
    expect(a.engine.getState().phase).toBe("playing");
    expect(b.engine.getState().phase).toBe("playing");

    // The phone backgrounded: its transport suspends (iOS kills WebRTC);
    // the page returns and the shell auto-reconnects.
    lifecycle.hide();
    const bTransport = world.transports.find(
      (t) => t.selfMemberId === b.memberId && t.connectionState === "connected",
    );
    await bTransport?.suspend();
    await settle(world);
    expect(b.engine.getState().phase).toBe("reconnecting");

    lifecycle.show();
    await settle(world);
    const bAfter = b.engine.getState();
    console.log(
      "B after resume:",
      JSON.stringify({
        phase: bAfter.phase,
        conn: bAfter.connectionState,
        attempts: bAfter.reconnectAttempts,
        notices: bAfter.notices.map((n) => n.message),
        detail: bAfter.phaseDetail,
      }),
    );
    expect(b.engine.getState().phase).toBe("playing");
    expect(b.engine.getState().connectionState).toBe("connected");
    // The other phone kept playing through the backgrounding.
    expect(a.engine.getState().phase).toBe("playing");
  });
});

describe("party engine — M1 local recovery record", () => {
  it("persists a recovery record on create and clears it on a clean leave", async () => {
    const world = makeWorld();
    const a = makePlayer(world, "a");
    await runCreate(a, world);

    const record = readPartyRecovery();
    expect(record).not.toBeNull();
    expect(record?.role).toBe("creator");
    expect(record?.code).toBe(a.engine.getState().code);
    expect(record?.game?.gameId).toBe(GAME.gameId);
    expect(record?.memberId).toBe(a.memberId);

    await a.engine.leaveParty();
    await settle(world);
    expect(readPartyRecovery()).toBeNull();
  });

  it("a reloaded page rejoins the live party from the saved record (M1)", async () => {
    const world = makeWorld();
    const a = makePlayer(world, "a");
    const code = await runCreate(a, world);
    const record = readPartyRecovery();
    expect(record).not.toBeNull();

    // The phone reloaded: a brand-new engine (fresh page) with the SAME
    // persisted identity reads the record and rejoins by invite.
    const reloaded = makePlayer(world, "reload", {
      identity: {
        memberId: record?.memberId ?? "member-reload",
        displayName: record?.displayName ?? "Player RELOAD",
      },
    });
    const joinPromise = reloaded.engine.joinByInvite({
      secret: record?.secret ?? "",
      code: record?.code ?? code,
    });
    await settle(world);
    await joinPromise;
    expect(reloaded.engine.getState().phase).toBe("lobby");
    expect(reloaded.engine.getState().code).toBe(code);
    await settle(world);
    expect(a.engine.getState().members).toHaveLength(2);

    await reloaded.engine.leaveParty();
    await a.engine.leaveParty();
    await settle(world);
    expect(readPartyRecovery()).toBeNull();
  });
});
