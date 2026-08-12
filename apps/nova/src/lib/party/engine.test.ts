import { beforeEach, describe, expect, it } from "vitest";
import { parseInviteFragment, type PartyTransportFactory } from "@rocketcrab/party";
import { InMemoryTransportHub } from "@rocketcrab/testing";
import type { ChannelPort } from "../runtime-host";
import { PartyEngine, type PartyRuntimeSeams } from "./engine";

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

function makePlayer(world: World, id: string): Player {
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
