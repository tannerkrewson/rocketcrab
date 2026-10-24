import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// The complete S4 example game document, verbatim (Vite ?raw import).
import EXAMPLE_GAME_SOURCE from "../../../../../examples/games/nova-quiz.html?raw";
import { parseInviteFragment, type PartyTransportFactory } from "@rocketcrab/party";
import type { NovaTransport, TransportEventMap } from "@rocketcrab/core";
import { InMemoryTransportHub } from "@rocketcrab/testing";
import type { ChannelPort } from "../runtime-host";
import { PartyEngine, type PartyRuntimeSeams, type PartySourceSpec } from "./engine";
import { createMemoryLifecycleSource } from "./lifecycle";
import { clearPartyRecovery, readPartyRecovery } from "./party-recovery";
import type { TurnCredentialsResult } from "./turn-creds";

/**
 * The default-factory path is mocked so the TURN acceptance tests can
 * observe what config the engine bakes into the factory without building
 * real Trystero rooms. Tests that inject a transportFactory (the in-memory
 * hub) never call this mock.
 */
const transportFactoryMocks = vi.hoisted(() => ({
  createTrysteroPartyTransportFactory: vi.fn(),
}));

vi.mock("./transport-factory", () => ({
  createTrysteroPartyTransportFactory: transportFactoryMocks.createTrysteroPartyTransportFactory,
}));

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
  register(title: string, mode?: PartySourceSpec["mode"]): void;
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
        // 5cl.14: auto-answer frame state/simulation requests. The real
        // runtime's game frame answers these with `stateResponse` /
        // `simulationResponse` apiCalls; the fake frame answers
        // deterministically so the state engine's authority start and
        // action applications resolve instead of timing out (10 s executor
        // timeout). Delivered synchronously on the same port.
        const originalPost = port1.postMessage.bind(port1);
        port1.postMessage = (message: unknown) => {
          originalPost(message);
          const msg = message as { type?: string; event?: { kind?: string } };
          if (msg?.type !== "game.apiEvent") {
            return;
          }
          const event = msg.event as {
            kind?: string;
            requestId?: string;
            request?: { kind?: string; viewers?: Array<{ id: string }> };
          };
          if (event?.kind === "stateRequest") {
            const viewers = event.request?.viewers ?? [];
            const views: Record<string, unknown> = {};
            for (const viewer of viewers) {
              views[viewer.id] = {};
            }
            harness.apiCall("stateResponse", {
              requestId: event.requestId,
              result:
                event.request?.kind === "computeView"
                  ? { ok: true, kind: "view", view: {} }
                  : { ok: true, kind: "state", state: {}, views },
            });
          } else if (event?.kind === "simulationRequest") {
            harness.apiCall("simulationResponse", {
              requestId: event.requestId,
              result: { ok: true, kind: "state", state: {} },
            });
          }
        };
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
    register(title: string, mode: PartySourceSpec["mode"] = "state") {
      deliver(harness.port1, {
        version: 1,
        runtimeInstanceId: "runtime-1",
        messageId: "message-reg",
        sentAt: 1_700_000_000_001,
        type: "game.registration",
        gameId: GAME.gameId,
        title,
        gameMode: mode,
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

/**
 * 5cl.14: answer every frame stateRequest/simulationRequest the engine
 * pushed into the fake frame (they appear in `port1.sent` as `game.apiEvent`
 * messages). The real runtime's game frame answers these; the fake frame
 * answers deterministically so the state engine's authority start and action
 * applications resolve instead of timing out (10 s executor timeout).
 */
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
    now: world.clock.now,
    derive: mockDerive,
    seams: harness.seams,
    identity: { memberId, displayName: `Player ${id}` },
    ...overrides,
  });
  const container = document.createElement("div");
  engine.setContainer(container);
  return { engine, harness, container, memberId, displayName: `Player ${id}` };
}

/** Create a party, advancing through the collision-listen window. */
async function runCreate(
  player: Player,
  world: World,
  game: PartySourceSpec = GAME,
): Promise<string> {
  const promise = player.engine.createParty(game);
  for (let i = 0; i < 8; i += 1) {
    await flush();
    world.clock.advance(1_000);
  }
  await settle(world);
  await promise;
  const invite = parseInviteFragment(new URL(player.engine.getState().inviteUrl!).hash)!;
  expect(invite.secret).toHaveLength(43);
  return invite.secret;
}

/** Join by code up to the point the greeter must approve. */
function startJoin(
  player: Player,
  world: World,
  code: string,
): { join: Promise<void>; settled: Promise<void> } {
  const join = player.engine.joinByInvite({ secret: code });
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
    expect(creatorState.inviteUrl).toContain(`/join#secret=${code}`);
    // The creator's game boots and registers → ready.
    await registerLocalGame(a, world);
    expect(a.engine.getState().members[0]?.ready).toBe(true);

    // Joiner: joins by the four-letter code; the creator approves.
    const { join: joinPromise, settled } = startJoin(b, world, code);
    await settled;
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
    });
    await settle(world);
    await joinPromise;
    expect(b.engine.getState().phase).toBe("lobby");
    await settle(world);
    expect(memberOf(b.engine.getState(), b.memberId).transferState).toBe("complete");
  });
});

describe("party engine — game mode and source transitions", () => {
  function events(player: Player, kind: string): unknown[] {
    return player.harness.port1.sent.filter((message) => {
      const msg = message as { type?: string; event?: { kind?: string } };
      return msg.type === "game.apiEvent" && msg.event?.kind === kind;
    });
  }

  it("configures simulation for a joiner before registration and delivers inputs on both peers", async () => {
    const world = makeWorld();
    const a = makePlayer(world, "a");
    const b = makePlayer(world, "b");
    await runCreate(a, world, { ...GAME, mode: "simulation" });
    const invite = parseInviteFragment(new URL(a.engine.getState().inviteUrl as string).hash)!;
    const joining = b.engine.joinByInvite({ secret: invite.secret! });
    await settle(world);
    await joining;
    a.harness.ready();
    b.harness.ready();
    a.harness.apiCall("simulation.register", {});
    b.harness.apiCall("simulation.register", {});
    a.harness.register(GAME.title, "simulation");
    b.harness.register(GAME.title, "simulation");
    await settle(world);
    a.engine.startGame();
    await settle(world);
    expect(b.engine.getState().phase).toBe("playing");
    b.harness.apiCall("simulation.sendInput", { input: { type: "move", payload: { x: 1 } } });
    await settle(world);
    expect(events(a, "simulationInput")).not.toHaveLength(0);
    expect(events(b, "simulationInput")).not.toHaveLength(0);
    expect(events(a, "stateRequest")).toHaveLength(0);
    expect(events(b, "stateRequest")).toHaveLength(0);
    await a.engine.leaveParty();
    await b.engine.leaveParty();
  });

  it("switches an existing state-mode party to simulation without resetting on repeated metadata", async () => {
    const world = makeWorld();
    const a = makePlayer(world, "a");
    const b = makePlayer(world, "b");
    await runCreate(a, world);
    const invite = parseInviteFragment(new URL(a.engine.getState().inviteUrl as string).hash)!;
    const joining = b.engine.joinByInvite({ secret: invite.secret! });
    await settle(world);
    await joining;
    await registerLocalGame(a, world);
    await registerLocalGame(b, world);
    await a.engine.selectGame({ ...GAME, gameId: "game_simulation", mode: "simulation" });
    await settle(world);
    expect(b.engine.getState().game?.gameId).toBe("game_simulation");
    expect(b.engine.getState().game?.mode).toBe("simulation");
    a.harness.ready();
    b.harness.ready();
    a.harness.apiCall("simulation.register", {});
    b.harness.apiCall("simulation.register", {});
    a.harness.register(GAME.title, "simulation");
    b.harness.register(GAME.title, "simulation");
    await settle(world);
    // Re-announcing identical metadata must not discard readiness or handlers.
    await a.engine.selectGame({ ...GAME, gameId: "game_simulation", mode: "simulation" });
    await settle(world);
    expect(memberOf(b.engine.getState(), b.memberId).ready).toBe(true);
    a.harness.ready();
    a.harness.apiCall("simulation.register", {});
    a.harness.register(GAME.title, "simulation");
    await settle(world);
    a.engine.startGame();
    await settle(world);
    b.harness.apiCall("simulation.sendInput", { input: { type: "move" } });
    await settle(world);
    expect(events(a, "simulationInput")).not.toHaveLength(0);
    expect(events(b, "simulationInput")).not.toHaveLength(0);
    await a.engine.leaveParty();
    await b.engine.leaveParty();
  });

  it("switches to raw and back to a cached state game, and receives edited source under the same ID", async () => {
    const world = makeWorld();
    const a = makePlayer(world, "a");
    const b = makePlayer(world, "b");
    await runCreate(a, world);
    const invite = parseInviteFragment(new URL(a.engine.getState().inviteUrl as string).hash)!;
    const joining = b.engine.joinByInvite({ secret: invite.secret! });
    await settle(world);
    await joining;
    await registerLocalGame(a, world);
    await registerLocalGame(b, world);
    await a.engine.selectGame({ ...GAME, gameId: "game_raw", mode: "raw" });
    await settle(world);
    expect(b.engine.getState().game?.mode).toBe("raw");
    a.harness.ready();
    b.harness.ready();
    a.harness.register(GAME.title, "raw");
    b.harness.register(GAME.title, "raw");
    a.harness.apiCall("raw.createChannel", { spec: { name: "chat" } });
    b.harness.apiCall("raw.createChannel", { spec: { name: "chat" } });
    await settle(world);
    b.harness.apiCall("raw.send", { name: "chat", payload: { hello: "raw" } });
    await settle(world);
    expect(events(a, "rawMessage")).not.toHaveLength(0);
    const framesBeforeCache = b.harness.frames.length;
    await a.engine.selectGame(GAME);
    await settle(world);
    expect(b.engine.getState().game?.mode).toBe("state");
    expect(b.harness.frames.length).toBeGreaterThan(framesBeforeCache);
    expect(memberOf(b.engine.getState(), b.memberId).transferState).toBe("complete");
    await registerLocalGame(a, world);
    await registerLocalGame(b, world);
    const framesBeforeEdit = b.harness.frames.length;
    await a.engine.selectGame({ ...GAME, source: GAME.source + "<!-- edited -->" });
    await settle(world);
    expect(b.harness.frames.length).toBeGreaterThan(framesBeforeEdit);
    expect(memberOf(b.engine.getState(), b.memberId).transferState).toBe("complete");
    await a.engine.leaveParty();
    await b.engine.leaveParty();
  });

  it("does not allow a joiner to replace the party game", async () => {
    const world = makeWorld();
    const a = makePlayer(world, "a");
    const b = makePlayer(world, "b");
    await runCreate(a, world);
    const invite = parseInviteFragment(new URL(a.engine.getState().inviteUrl as string).hash)!;
    const joining = b.engine.joinByInvite({ secret: invite.secret! });
    await settle(world);
    await joining;
    await b.engine.selectGame({ ...GAME, gameId: "not-the-hosts-game", mode: "raw" });
    expect(b.engine.getState().game?.gameId).toBe(GAME.gameId);
    await a.engine.leaveParty();
    await b.engine.leaveParty();
  });
});

describe("party engine — join loading stages (rocketcrab-erx / rocketcrab-5ae)", () => {
  it("keeps a joiner on loading then errors when no peer can be reached (5ae)", async () => {
    const world = makeWorld();
    // No host at all: an invite join derives a private room nobody is in
    // (the stale-invite / cross-network no-TURN shape). The joiner must sit
    // on the loading screen and then hit a clear error — never a fake lobby.
    const b = makePlayer(world, "b", { peerConnectTimeoutMs: 1_000 });
    const joinPromise = b.engine.joinByInvite({ secret: "E".repeat(43) });
    await settle(world);
    expect(b.engine.getState().phase).toBe("joining");
    expect(b.engine.getState().joinStage).toBe("connecting");

    // Still loading after additional time (the signaling layer itself may
    // have connected; the peer gate is what matters).
    world.clock.advance(500);
    await settle(world);
    expect(b.engine.getState().phase).toBe("joining");

    // The peer window closes: loading → error, and the dead-end room is
    // torn down (no rooms left, so nobody else bumps into this joiner).
    world.clock.advance(500);
    await settle(world);
    await joinPromise;
    expect(b.engine.getState().phase).toBe("error");
    expect(b.engine.getState().lastError).toMatch(/couldn't reach anyone/i);
    expect(world.hub.roomNames().every((room) => world.hub.membersOf(room).length === 0)).toBe(
      true,
    );
  });

  it("lets a Cancel during the peer wait return to idle without an error (5ae)", async () => {
    const world = makeWorld();
    const b = makePlayer(world, "b", { peerConnectTimeoutMs: 5_000 });
    const joinPromise = b.engine.joinByInvite({ secret: "F".repeat(43) });
    await settle(world);
    expect(b.engine.getState().phase).toBe("joining");
    expect(b.engine.getState().joinStage).toBe("connecting");

    // The user presses Cancel on the loading screen: the party is torn
    // down and the flow returns to the entry UI — no error screen, no
    // phantom lobby if a peer were to appear later.
    await b.engine.leaveParty();
    await settle(world);
    expect(b.engine.getState().phase).toBe("idle");
    // The join's peer-wait timer still pends; once it fires after the
    // cancel, the join flow must stop silently instead of failing into the
    // error screen.
    world.clock.advance(5_500);
    await settle(world);
    await joinPromise;
    expect(b.engine.getState().phase).toBe("idle");
    expect(b.engine.getState().joinStage).toBeNull();
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

describe("party engine — restart after exiting to the lobby (2t1.4)", () => {
  it("can start the game again after exiting to the lobby from a game", async () => {
    const world = makeWorld();
    const a = makePlayer(world, "a");
    const b = makePlayer(world, "b");
    const code = await runCreate(a, world);
    await registerLocalGame(a, world);

    const { join: joinPromise, settled } = startJoin(b, world, code);
    await settled;
    await settle(world);
    await joinPromise;
    await settle(world);
    await registerLocalGame(b, world);
    await settle(world);

    expect(a.engine.getState().canStart).toBe(true);
    a.engine.startGame();
    await settle(world);
    expect(a.engine.getState().phase).toBe("playing");
    expect(b.engine.getState().phase).toBe("playing");

    // Emergency teardown: everyone returns to the lobby with the banner.
    a.engine.endGame("host_closed");
    await settle(world);
    expect(a.engine.getState().phase).toBe("lobby");
    expect(b.engine.getState().phase).toBe("lobby");
    expect(a.engine.getState().endedReason).toBe("host_closed");

    // The ended session is swapped for a fresh one (one-shot start/end):
    // the ended-state start gate opens again. The lobby re-boots each
    // player's runtime frame (the phase flip remounts the frame container;
    // setContainer reboots the runtime), and the frames re-register into
    // the fresh session so the ready gate re-opens.
    a.engine.setContainer(null);
    b.engine.setContainer(null);
    a.engine.setContainer(a.container);
    b.engine.setContainer(b.container);
    await settle(world);
    await registerLocalGame(a, world);
    await registerLocalGame(b, world);
    await settle(world);

    expect(a.engine.getState().startBlockedReason).toBeNull();
    expect(a.engine.getState().canStart).toBe(true);
    a.engine.startGame();
    await settle(world);
    expect(a.engine.getState().phase).toBe("playing");
    expect(b.engine.getState().phase).toBe("playing");

    await a.engine.leaveParty();
    await b.engine.leaveParty();
    await settle(world);
    expect(world.hub.roomNames().every((room) => world.hub.membersOf(room).length === 0)).toBe(
      true,
    );
  });

  it("reboots the runtime frame when the container is rebound after a phase flip (2t1.6)", async () => {
    const world = makeWorld();
    const a = makePlayer(world, "a");
    await runCreate(a, world);
    await registerLocalGame(a, world);
    expect(a.harness.frames).toHaveLength(1);
    expect(a.container.querySelector("iframe")).not.toBeNull();

    // The lobby->playing flip remounts the frame container: React detaches
    // the old ref (null) before attaching the new element. The stale
    // runtime must be torn down and a fresh frame booted in the rebound
    // container, or the area stays black with no iframe.
    a.engine.setContainer(null);
    a.engine.setContainer(a.container);
    await settle(world);

    expect(a.harness.frames).toHaveLength(2);
    expect(a.container.querySelector("iframe")).not.toBeNull();
    await registerLocalGame(a, world);
    expect(a.engine.getState().members[0]?.ready).toBe(true);

    await a.engine.leaveParty();
    await settle(world);
  });
});

describe("party engine — lobby notices", () => {
  it("dedupes identical notices instead of piling up alerts (11.8)", async () => {
    const world = makeWorld();
    const a = makePlayer(world, "a");
    const b = makePlayer(world, "b");
    const code = await runCreate(a, world);
    const { join: joinPromise, settled } = startJoin(b, world, code);
    await settled;
    await settle(world);
    await joinPromise;
    await settle(world);
    expect(a.engine.getState().members).toHaveLength(2);

    // Two kicks for the same member in quick succession (the production
    // repro for a repeated event re-adding the same notice) previously
    // appended two identical notices; dedupe keeps one.
    a.engine.kickMember(b.memberId);
    a.engine.kickMember(b.memberId);

    const messages = a.engine.getState().notices.map((notice) => notice.message);
    expect(new Set(messages).size).toBe(messages.length);
    expect(
      messages.filter((message) => message.includes(`${b.displayName} was removed`)),
    ).toHaveLength(1);
  });

  it("skips the joined/removed notices while a member still has the id-like name (2z9)", async () => {
    const world = makeWorld();
    const a = makePlayer(world, "a");
    // A joiner who never set a display name announces the member id itself
    // (displayNameOf falls back to the id) — "member-b joined the party."
    // must never surface as a banner alert or a membership toast.
    const b = makePlayer(world, "b", {
      identity: { memberId: "member-b", displayName: "member-b" },
    });
    const code = await runCreate(a, world);
    const { join: joinPromise, settled } = startJoin(b, world, code);
    await settled;
    await settle(world);
    await joinPromise;
    await settle(world);
    expect(a.engine.getState().members).toHaveLength(2);
    const messages = a.engine.getState().notices.map((notice) => notice.message);
    expect(messages.some((message) => message.includes("joined the party"))).toBe(false);
    expect(messages.some((message) => message.includes("was admitted to the party"))).toBe(false);
    // Kicking them is also silent — no "member-b was removed from the
    // party." noise.
    a.engine.kickMember(b.memberId);
    await settle(world);
    const afterKick = a.engine.getState().notices.map((notice) => notice.message);
    expect(afterKick.some((message) => message.includes("was removed from the party"))).toBe(false);
  });
});

describe("party engine — roles, reconnect, and cleanup", () => {
  it("keeps the invite joinable and transfers verified source and shell controls after the creator leaves", async () => {
    const world = makeWorld();
    const creator = makePlayer(world, "z");
    const successor = makePlayer(world, "b");
    const late = makePlayer(world, "c");
    const secret = await runCreate(creator, world);
    const join = successor.engine.joinByInvite({ secret });
    await settle(world);
    await join;
    await settle(world);
    expect(successor.engine.getState().amHost).toBe(false);
    expect(successor.engine.getState().hostMemberId).toBe(creator.memberId);
    await creator.engine.leaveParty();
    await settle(world);
    expect(successor.engine.getState().amHost).toBe(true);
    const lateJoin = late.engine.joinByInvite({ secret });
    await settle(world);
    await lateJoin;
    await settle(world);
    expect(late.engine.getState().hostMemberId).toBe(successor.memberId);
    expect(late.engine.getState().game?.gameId).toBe(GAME.gameId);
    expect(memberOf(late.engine.getState(), late.memberId).transferState).toBe("complete");
    await successor.engine.selectGame({
      ...GAME,
      gameId: "successor-game",
      source: GAME.source + "<!-- new -->",
    });
    await settle(world);
    expect(late.engine.getState().game?.gameId).toBe("successor-game");
    await late.engine.leaveParty();
    await successor.engine.leaveParty();
    await settle(world);
    expect(world.transports.every((t) => t.connectionState === "disconnected")).toBe(true);
  });

  it("the creator can leave; the joiner becomes the greeter (migration)", async () => {
    const world = makeWorld();
    const a = makePlayer(world, "a");
    const b = makePlayer(world, "b");
    const code = await runCreate(a, world);
    const { join: joinPromise, settled } = startJoin(b, world, code);
    await settled;
    await settle(world);
    await joinPromise;
    await settle(world);

    // The creator leaves; the joiner's party session elects it greeter.
    await a.engine.leaveParty();
    await settle(world);
    expect(a.engine.getState().phase).toBe("idle");
    const bState = b.engine.getState();
    expect(bState.hostMemberId).toBe(b.memberId);
    expect(bState.amHost).toBe(true);
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
    const code = parseInviteFragment(new URL(a.engine.getState().inviteUrl!).hash)!.secret;
    expect(code).toHaveLength(43);
    expect(a.engine.getState().game?.title).toBe("Nova Quiz");

    // The creator's frame boots and registers the example game.
    await registerLocalGame(a, world);
    expect(a.engine.getState().members[0]?.ready).toBe(true);

    // Joiner joins by code; the creator approves.
    const join = b.engine.joinByInvite({ secret: code });
    const settled = (async () => {
      await flush();
      world.clock.advance(5_000);
      await settle(world);
      world.clock.advance(2_000);
      await settle(world);
    })();
    await settled;
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
    expect(record?.game?.gameId).toBe(GAME.gameId);
    expect(record?.memberId).toBe(a.memberId);

    await a.engine.leaveParty();
    await settle(world);
    expect(readPartyRecovery()).toBeNull();
  });

  it("a reloaded page recovers its identity from the record while another participant remains", async () => {
    const world = makeWorld();
    const a = makePlayer(world, "a");
    const b = makePlayer(world, "b");
    const secret = await runCreate(a, world);
    const joining = b.engine.joinByInvite({ secret });
    await settle(world);
    await joining;
    const record = readPartyRecovery()!;
    expect(record.memberId).toBe(b.memberId);
    await b.engine.leaveParty();
    await settle(world);
    const reloaded = makePlayer(world, "reload", {
      identity: { memberId: record.memberId, displayName: record.displayName },
    });
    const rejoining = reloaded.engine.joinByInvite({ secret: record.secret });
    await settle(world);
    await rejoining;
    await settle(world);
    expect(reloaded.engine.getState().memberId).toBe(b.memberId);
    expect(a.engine.getState().members).toHaveLength(2);
    expect(reloaded.engine.getState().game?.gameId).toBe(GAME.gameId);
    await reloaded.engine.leaveParty();
    await a.engine.leaveParty();
    await settle(world);
    expect(readPartyRecovery()).toBeNull();
  });
});

describe("party engine — session events reach game frames (7.26)", () => {
  it("forwards identity/connection/roster/start/end apiEvents to each game frame", async () => {
    const world = makeWorld();
    const a = makePlayer(world, "a");
    const b = makePlayer(world, "b");
    const apiEventsOf = (player: Player) =>
      player.harness.port1.sent
        .filter((message) => (message as { type?: string }).type === "game.apiEvent")
        .map(
          (message) =>
            (message as { event: { kind: string } }).event as { kind: string } & Record<
              string,
              unknown
            >,
        );

    // Creator: party live, game boots + registers. The session attached
    // BEFORE the frame existed, so the registration replay must deliver
    // identity + connection + roster to the frame (7.26).
    const code = await runCreate(a, world);
    await registerLocalGame(a, world);
    await settle(world);
    const aKinds = apiEventsOf(a).map((event) => event.kind);
    expect(aKinds).toContain("identity");
    expect(aKinds).toContain("connection");
    const aJoined = apiEventsOf(a)
      .filter((event) => event.kind === "playerJoined")
      .map((event) => (event.player as { id: string }).id);
    expect(aJoined).toContain(a.memberId);

    // Joiner: joins, is approved, receives the game, registers.
    const { join: joinPromise, settled } = startJoin(b, world, code);
    await settled;
    await settle(world);
    await joinPromise;
    await settle(world);
    await registerLocalGame(b, world);
    await settle(world);

    // A's frame saw B join live; B's frame got the full roster replayed.
    const aJoinedAfter = apiEventsOf(a)
      .filter((event) => event.kind === "playerJoined")
      .map((event) => (event.player as { id: string }).id);
    expect(aJoinedAfter).toContain(b.memberId);
    const bJoined = apiEventsOf(b)
      .filter((event) => event.kind === "playerJoined")
      .map((event) => (event.player as { id: string }).id);
    expect(bJoined).toContain(a.memberId);
    expect(bJoined).toContain(b.memberId);

    // Start reaches both frames.
    a.engine.startGame();
    await settle(world);
    expect(apiEventsOf(a).some((event) => event.kind === "start")).toBe(true);
    expect(apiEventsOf(b).some((event) => event.kind === "start")).toBe(true);

    // End reaches both frames.
    a.engine.endGame("host_closed");
    await settle(world);
    expect(
      apiEventsOf(a).some(
        (event) => event.kind === "end" && (event.reason as string | undefined) === "host_closed",
      ),
    ).toBe(true);
    expect(
      apiEventsOf(b).some(
        (event) => event.kind === "end" && (event.reason as string | undefined) === "host_closed",
      ),
    ).toBe(true);

    await a.engine.leaveParty();
    await b.engine.leaveParty();
    await settle(world);
  });
});

describe("party engine — frame state executor + rebooted-frame replay (5cl.14)", () => {
  const apiEventsOf = (player: Player) =>
    player.harness.port1.sent
      .filter((message) => (message as { type?: string }).type === "game.apiEvent")
      .map(
        (message) =>
          (message as { event: { kind: string } }).event as { kind: string } & Record<
            string,
            unknown
          >,
      );

  it("runs the game's state handlers in the frame (stateRequest → stateResponse) and starts", async () => {
    const world = makeWorld();
    const a = makePlayer(world, "a");
    await runCreate(a, world);
    await registerLocalGame(a, world);

    a.engine.startGame();
    await settle(world);

    const state = a.engine.getState();
    expect(state.phase).toBe("playing");
    // The state engine asked the FRAME for the initial state (the frame
    // executor forwarded a stateRequest apiEvent; the fake frame answered
    // with a stateResponse). Before 5cl.14 a local no-op executor ran the
    // game's handlers nowhere and the initial state was always {}.
    const requests = apiEventsOf(a).filter((event) => event.kind === "stateRequest");
    expect(requests.length).toBeGreaterThan(0);
    expect(requests[0]?.request).toMatchObject({ kind: "createInitialState" });
  });

  it("replays the last state view into a rebooted frame after the container rebind (lobby→playing)", async () => {
    const world = makeWorld();
    const a = makePlayer(world, "a");
    await runCreate(a, world);
    await registerLocalGame(a, world);
    a.engine.startGame();
    await settle(world);
    expect(a.engine.getState().phase).toBe("playing");

    // 2t1.6: the lobby → playing phase flip rebinds the frame container —
    // a fresh element arrives, so the engine disposes the runtime and
    // reboots the frame. The rebooted frame's registration must replay the
    // last state view (then start); without the replay it hangs at the
    // game's own waiting screen.
    const newContainer = document.createElement("div");
    a.engine.setContainer(newContainer);
    await flush();
    a.harness.ready();
    a.harness.register(GAME.title);
    await settle(world);

    const kinds = apiEventsOf(a).map((event) => event.kind);
    expect(kinds).toContain("state");
    expect(kinds).toContain("start");
    // The state view must be replayed BEFORE the start signal: the game's
    // onStart dispatches actions against the current view.
    expect(kinds.indexOf("state")).toBeLessThan(kinds.indexOf("start"));
  });
});

describe("party engine — rename announcements (7.25)", () => {
  it("broadcasts a display-name change; peers' member view updates without a rejoin", async () => {
    const world = makeWorld();
    const a = makePlayer(world, "a");
    const b = makePlayer(world, "b");

    const code = await runCreate(a, world);
    await registerLocalGame(a, world);
    const { join: joinPromise, settled } = startJoin(b, world, code);
    await settled;
    await settle(world);
    await joinPromise;
    await settle(world);
    await registerLocalGame(b, world);
    await settle(world);

    // Baseline: the handshake name is what B sees.
    expect(memberOf(b.engine.getState(), a.memberId).displayName).toBe("Player a");

    a.engine.setDisplayName("Alpha Renamed");
    await settle(world);

    // B's member view updates promptly (no rejoin); A's own view is current.
    expect(memberOf(b.engine.getState(), a.memberId).displayName).toBe("Alpha Renamed");
    expect(memberOf(a.engine.getState(), a.memberId).displayName).toBe("Alpha Renamed");
    // Unaffected members keep their names.
    expect(memberOf(b.engine.getState(), b.memberId).displayName).toBe("Player b");

    await a.engine.leaveParty();
    await b.engine.leaveParty();
    await settle(world);
  });
});

// ---------------------------------------------------------------------------
// Classic games in parties, kick, and reload (7.7.4, 7.29)
// ---------------------------------------------------------------------------

describe("party engine — classic games, kick, and reload (7.7.4, 7.29)", () => {
  it("shares a classic room: the host creates it once, the joiner builds the same room", async () => {
    const world = makeWorld();
    const a = makePlayer(world, "a");
    const b = makePlayer(world, "b");

    // Host starts a party with no game (7.6) and picks a classic game; the
    // room is created in the host's browser (protobowl needs no fetch).
    const promise = a.engine.createParty();
    for (let i = 0; i < 8; i += 1) {
      await flush();
      world.clock.advance(1_000);
    }
    await settle(world);
    await promise;
    const code = parseInviteFragment(new URL(a.engine.getState().inviteUrl!).hash)!.secret;

    await a.engine.selectClassicGame("protobowl");
    await settle(world);
    const aState = a.engine.getState();
    expect(aState.phase).toBe("lobby");
    expect(aState.classicGame?.gameId).toBe("protobowl");
    expect(aState.classicGame?.connectResult.player.url).toContain("https://protobowl.com/");
    expect(aState.game?.title).toBe("Protobowl");
    // Classic games bypass the source-transfer/ready gates (7.7.4).
    expect(aState.canStart).toBe(true);

    // Joiner joins, asks for the room, and receives the shared spec.
    const { join: joinPromise, settled } = startJoin(b, world, code);
    await settled;
    await settle(world);
    await joinPromise;
    await settle(world);

    const bState = b.engine.getState();
    expect(bState.phase).toBe("lobby");
    expect(bState.classicGame?.gameId).toBe("protobowl");
    expect(bState.classicGame?.connectResult.player.url).toBe(
      aState.classicGame?.connectResult.player.url,
    );
    expect(bState.canStart).toBe(true);

    // Starting flips BOTH phones to playing without a Nova source transfer.
    a.engine.startGame();
    await settle(world);
    expect(a.engine.getState().phase).toBe("playing");
    expect(b.engine.getState().phase).toBe("playing");

    await a.engine.leaveParty();
    await b.engine.leaveParty();
    await settle(world);
  });

  it("kicks a member: the kicked member sees a removed state and can dismiss it", async () => {
    const world = makeWorld();
    const a = makePlayer(world, "a");
    const b = makePlayer(world, "b");
    const code = await runCreate(a, world);
    await registerLocalGame(a, world);
    const { join: joinPromise, settled } = startJoin(b, world, code);
    await settled;
    await settle(world);
    await joinPromise;
    await settle(world);
    expect(b.engine.getState().phase).toBe("lobby");

    a.engine.kickMember(b.memberId);
    await settle(world);
    await flush();
    await settle(world);

    // The kicked member sees the removed screen after the teardown settles.
    const bState = b.engine.getState();
    expect(bState.removedReason).toBe("The host removed you from the party.");
    expect(bState.phase).toBe("removed");
    // The host still has a live lobby.
    expect(a.engine.getState().phase).toBe("lobby");

    b.engine.dismissRemoved();
    expect(b.engine.getState().phase).toBe("idle");
    expect(b.engine.getState().removedReason).toBeNull();
  });

  it("reloads: local reload reaches the runtime; reload all reaches peers", async () => {
    const world = makeWorld();
    const a = makePlayer(world, "a");
    const b = makePlayer(world, "b");
    const code = await runCreate(a, world);
    await registerLocalGame(a, world);
    const { join: joinPromise, settled } = startJoin(b, world, code);
    await settled;
    await settle(world);
    await joinPromise;
    await registerLocalGame(b, world);
    await settle(world);

    // Reload my game: the local runtime receives runtime.reload.
    a.engine.reloadMyGame();
    const sentA = a.harness.port1.sent as Array<{ type: string }>;
    expect(sentA.some((message) => message.type === "runtime.reload")).toBe(true);

    // Reload all: the peer's runtime receives runtime.reload too.
    b.harness.port1.sent.length = 0;
    a.engine.reloadAllGames();
    await settle(world);
    const sentB = b.harness.port1.sent as Array<{ type: string }>;
    expect(sentB.some((message) => message.type === "runtime.reload")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// TURN credential minting (P0, task rocketcrab-23s)
//
// The engine mints short-lived TURN credentials at setup start (once, cached
// on success) and bakes them into the default Trystero transport factory.
// A mint outage NEVER blocks a party: it proceeds without TURN and records
// a warn notice + diagnostics flag. These tests drive the DEFAULT factory
// path (no injected transportFactory) with the factory mock returning the
// in-memory world factory, so the whole create flow runs end to end.
// ---------------------------------------------------------------------------

describe("party engine — TURN credential minting (rocketcrab-23s)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    transportFactoryMocks.createTrysteroPartyTransportFactory.mockReset();
  });

  /** A player on the DEFAULT factory path (mocked to the in-memory hub). */
  function makeDefaultFactoryPlayer(
    world: World,
    overrides: ConstructorParameters<typeof PartyEngine>[0] = {},
  ): Player {
    transportFactoryMocks.createTrysteroPartyTransportFactory.mockReturnValue(world.factory);
    // NOTE: no transportFactory injected — the engine must resolve the
    // default factory itself, minting TURN credentials on the way.
    // (`transportFactory: undefined` neutralizes makePlayer's default.)
    return makePlayer(world, "host", { transportFactory: undefined, ...overrides });
  }

  it("env unset → no mint fetch, no TURN wiring, no notice (works as today)", async () => {
    const world = makeWorld();
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    // No VITE_TURN_CREDS_ORIGIN stub → unconfigured build; the real mint
    // client short-circuits before touching fetch.
    const player = makeDefaultFactoryPlayer(world);
    await runCreate(player, world);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(transportFactoryMocks.createTrysteroPartyTransportFactory).toHaveBeenCalledWith({
      onJoinError: expect.any(Function),
    });
    const state = player.engine.getState();
    expect(state.phase).toBe("lobby");
    expect(state.notices.some((notice) => notice.message.includes("TURN"))).toBe(false);
    expect(state.diagnostics?.turn).toBe("disabled");
  });

  it("mint success → turnConfig baked into the default factory + configured diagnostic", async () => {
    vi.stubEnv("VITE_TURN_CREDS_ORIGIN", "https://turn-creds.example.workers.dev");
    const world = makeWorld();
    const turnConfig = [
      {
        urls: ["turn:turn.cloudflare.com:3478?transport=udp"],
        username: "u1",
        credential: "c1",
      },
    ];
    const player = makeDefaultFactoryPlayer(world, {
      turnCreds: async (): Promise<TurnCredentialsResult> => ({ ok: true, turnConfig }),
    });
    await runCreate(player, world);

    expect(transportFactoryMocks.createTrysteroPartyTransportFactory).toHaveBeenCalledWith({
      onJoinError: expect.any(Function),
      turnConfig,
    });
    const state = player.engine.getState();
    expect(state.phase).toBe("lobby");
    expect(state.diagnostics?.turn).toBe("configured");
    expect(state.notices.some((notice) => notice.message.includes("TURN"))).toBe(false);
  });

  it("mint failure (network/403/5xx/timeout) → party still creates WITHOUT TURN + warn notice", async () => {
    vi.stubEnv("VITE_TURN_CREDS_ORIGIN", "https://turn-creds.example.workers.dev");
    const world = makeWorld();
    const player = makeDefaultFactoryPlayer(world, {
      turnCreds: async (): Promise<TurnCredentialsResult> => ({
        ok: false,
        reason: "the mint returned HTTP 403.",
      }),
    });
    await runCreate(player, world);

    expect(transportFactoryMocks.createTrysteroPartyTransportFactory).toHaveBeenCalledWith({
      onJoinError: expect.any(Function),
    });
    const state = player.engine.getState();
    expect(state.phase).toBe("lobby");
    expect(state.diagnostics?.turn).toBe("unavailable");
    expect(
      state.notices.some((notice) =>
        notice.message.includes("TURN credentials unavailable (the mint returned HTTP 403.)"),
      ),
    ).toBe(true);
  });

  it("mints ONCE and reuses the cached turnConfig across setup attempts", async () => {
    vi.stubEnv("VITE_TURN_CREDS_ORIGIN", "https://turn-creds.example.workers.dev");
    const world = makeWorld();
    const turnConfig = [
      {
        urls: ["turn:turn.cloudflare.com:3478?transport=udp"],
        username: "u1",
        credential: "c1",
      },
    ];
    const turnCreds = vi.fn(async (): Promise<TurnCredentialsResult> => ({
      ok: true,
      turnConfig,
    }));
    const player = makeDefaultFactoryPlayer(world, { turnCreds });
    await runCreate(player, world);
    expect(turnCreds).toHaveBeenCalledTimes(1);

    // Leave and create a second party on the same engine (the page
    // singleton semantics): the cached minted config is reused.
    await player.engine.leaveParty();
    await runCreate(player, world);
    expect(turnCreds).toHaveBeenCalledTimes(1);
    expect(transportFactoryMocks.createTrysteroPartyTransportFactory).toHaveBeenLastCalledWith({
      onJoinError: expect.any(Function),
      turnConfig,
    });
  });

  it("refreshes before the 600s expiry and applies credentials to both live transports", async () => {
    vi.stubEnv("VITE_TURN_CREDS_ORIGIN", "https://turn-creds.example.workers.dev");
    const world = makeWorld();
    const updateTurnConfig = vi.fn();
    const factory = { ...world.factory, updateTurnConfig };
    transportFactoryMocks.createTrysteroPartyTransportFactory.mockReturnValue(factory);
    const first = [{ urls: "turn:one", username: "u1", credential: "c1" }];
    const second = [{ urls: "turn:two", username: "u2", credential: "c2" }];
    const turnCreds = vi
      .fn<() => Promise<TurnCredentialsResult>>()
      .mockResolvedValueOnce({ ok: true, turnConfig: first })
      .mockResolvedValueOnce({ ok: true, turnConfig: second });
    const player = makePlayer(world, "host", { transportFactory: undefined, turnCreds });
    await runCreate(player, world);
    expect(updateTurnConfig).not.toHaveBeenCalled();
    world.clock.advance(480_000);
    await settle(world);
    expect(turnCreds).toHaveBeenCalledTimes(2);
    expect(updateTurnConfig).toHaveBeenCalledWith(second);
    expect(player.engine.getState().diagnostics?.turn).toBe("configured");
    await player.engine.leaveParty();
  });

  it("does not mint when the transport factory is injected (tests/embedders)", async () => {
    vi.stubEnv("VITE_TURN_CREDS_ORIGIN", "https://turn-creds.example.workers.dev");
    const world = makeWorld();
    const turnCreds = vi.fn(async (): Promise<TurnCredentialsResult> => ({
      ok: true,
      turnConfig: [],
    }));
    const player = makePlayer(world, "host", { turnCreds });
    await runCreate(player, world);
    expect(turnCreds).not.toHaveBeenCalled();
    await player.engine.leaveParty();
  });
});

// ---------------------------------------------------------------------------
// Relay-health diagnostics surfacing (P2, task rocketcrab-ont.1)
//
// The production engine has NO injected diagnostics provider: the lobby
// panel gets relay state from the private transport's own adapter
// diagnostics (`getDiagnostics()`), pushed live via `onRelayStateChange`.
// These tests drive that plumbing over the in-memory hub with a duck-typed
// Trystero-shaped diagnostics snapshot.
// ---------------------------------------------------------------------------

describe("party engine — relay diagnostics surfacing (rocketcrab-ont.1)", () => {
  /** A Trystero-shaped diagnostics snapshot (duck-typed by the engine). */
  function makeRelaySnapshot() {
    return {
      connectionState: "connected",
      selfConnectionId: "conn-a",
      room: "room-1",
      sessionId: "session-1",
      relays: {
        relays: [
          { url: "wss://nos.lol", readyState: 1, connected: true, degraded: false },
          { url: "wss://relay.damus.io", readyState: 1, connected: true, degraded: false },
          { url: "wss://relay.nostr.info", readyState: 1, connected: true, degraded: false },
        ],
        total: 3,
        connectedCount: 3,
        usableCount: 3,
        degradedCount: 0,
        signalingDown: false,
        degraded: false,
        at: 1_000,
      },
      joinErrors: [],
      peers: [],
      lastQuality: [],
    };
  }

  it("reads relay diagnostics from the transport when no provider is injected (production path)", async () => {
    const world = makeWorld();
    const snapshot = makeRelaySnapshot();
    world.factory.createPrivateTransport = (identity) => {
      const transport = world.hub.createTransport(identity);
      (transport as unknown as { getDiagnostics?: () => unknown }).getDiagnostics = () => snapshot;
      return transport;
    };
    const player = makePlayer(world, "host");
    await runCreate(player, world);

    const diagnostics = player.engine.getState().diagnostics;
    expect(diagnostics).not.toBeNull();
    expect(diagnostics?.relays).toEqual([
      { url: "wss://nos.lol", readyState: 1, connected: true, degraded: false },
      { url: "wss://relay.damus.io", readyState: 1, connected: true, degraded: false },
      { url: "wss://relay.nostr.info", readyState: 1, connected: true, degraded: false },
    ]);
    expect(diagnostics?.relayHealth).toEqual({
      total: 3,
      connected: 3,
      usable: 3,
      degradedCount: 0,
      signalingDown: false,
      degraded: false,
    });
  });

  it("surfaces degraded (connected-but-rejecting) relays and the usable count", async () => {
    const world = makeWorld();
    const snapshot = makeRelaySnapshot();
    snapshot.relays.relays[2] = {
      url: "wss://relay.nostr.info",
      readyState: 1,
      connected: true,
      degraded: true,
    };
    snapshot.relays.usableCount = 2;
    snapshot.relays.degradedCount = 1;
    snapshot.relays.degraded = true; // usable 2 < redundancy 5
    world.factory.createPrivateTransport = (identity) => {
      const transport = world.hub.createTransport(identity);
      (transport as unknown as { getDiagnostics?: () => unknown }).getDiagnostics = () => snapshot;
      return transport;
    };
    const player = makePlayer(world, "host");
    await runCreate(player, world);

    const diagnostics = player.engine.getState().diagnostics;
    const nostrInfo = diagnostics?.relays?.find((relay) => relay.url === "wss://relay.nostr.info");
    expect(nostrInfo).toMatchObject({ connected: true, degraded: true });
    expect(diagnostics?.relayHealth).toMatchObject({
      total: 3,
      connected: 3,
      usable: 2,
      degradedCount: 1,
      degraded: true,
    });
  });

  it("uses the injected diagnostics provider when present (test/dev path)", async () => {
    const world = makeWorld();
    const snapshot = makeRelaySnapshot();
    const player = makePlayer(world, "host", {
      diagnostics: () => snapshot,
    });
    await runCreate(player, world);

    const diagnostics = player.engine.getState().diagnostics;
    expect(diagnostics?.relays?.[0]).toEqual({
      url: "wss://nos.lol",
      readyState: 1,
      connected: true,
      degraded: false,
    });
    expect(diagnostics?.relayHealth?.usable).toBe(3);
  });

  it("subscribes to onRelayStateChange and re-emits live relay state", async () => {
    const world = makeWorld();
    const snapshot = makeRelaySnapshot();
    let relayHandler: (() => void) | null = null;
    world.factory.createPrivateTransport = (identity) => {
      const transport = world.hub.createTransport(identity);
      const extended = transport as unknown as {
        getDiagnostics?: () => unknown;
        onRelayStateChange?: (handler: () => void) => () => void;
      };
      extended.getDiagnostics = () => snapshot;
      extended.onRelayStateChange = (handler) => {
        relayHandler = handler;
        handler(); // the transport contract: replay the latest snapshot
        return () => {
          relayHandler = null;
        };
      };
      return transport;
    };
    const player = makePlayer(world, "host");
    await runCreate(player, world);
    expect(player.engine.getState().diagnostics?.relays).not.toBeNull();

    // A connected relay starts rejecting; the transport pushes the change.
    snapshot.relays.relays[2] = {
      url: "wss://relay.nostr.info",
      readyState: 1,
      connected: true,
      degraded: true,
    };
    snapshot.relays.usableCount = 2;
    snapshot.relays.degradedCount = 1;
    snapshot.relays.degraded = true;

    const seen: Array<{ usable: number }> = [];
    player.engine.onState((state) => {
      seen.push({ usable: state.diagnostics?.relayHealth?.usable ?? -1 });
    });
    (relayHandler as (() => void) | null)?.();
    // The engine re-emitted with the degraded relay state (push, not poll).
    expect(seen.at(-1)?.usable).toBe(2);
    const nostrInfo = player.engine
      .getState()
      .diagnostics?.relays?.find((relay) => relay.url === "wss://relay.nostr.info");
    expect(nostrInfo?.degraded).toBe(true);
  });
});
