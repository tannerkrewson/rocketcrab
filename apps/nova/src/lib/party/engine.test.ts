import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import EXAMPLE_GAME_SOURCE from "../../../../../examples/games/nova-quiz.html?raw";
import {
  GameSourceCoordinator,
  parseInviteFragment,
  type PartyTransportFactory,
} from "@rocketcrab/party";
import type { NovaTransport, TransportEventMap } from "@rocketcrab/core";
import { InMemoryTransportHub } from "@rocketcrab/testing";
import { fromRoomError } from "@rocketcrab/trystero-transport";
import type { ChannelPort } from "../runtime-host";
import {
  PartyEngine,
  type PeerLinkStatus,
  type PartyRuntimeSeams,
  type PartySourceSpec,
} from "./engine";
import { createMemoryLifecycleSource } from "./lifecycle";
import { clearPartyRecovery, readPartyRecovery } from "./party-recovery";
import type { TurnCredentialsResult } from "./turn-creds";
import { CLASSIC_GAMES, type ClassicGameConnectResult } from "../classic";

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

/** Party flow integration tests over in-memory transports, fake clocks, and fake runtime bridges. */

const GAME = {
  gameId: "game_rocket_1",
  title: "Rocket Rumble",
  mode: "state" as const,
  source: "<!doctype html><html><body><p>rockets</p></body></html>",
};

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
        // Answer authority-frame requests synchronously so state and simulation
        // operations resolve deterministically instead of reaching the executor timeout.
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

    const code = await runCreate(a, world);
    const creatorState = a.engine.getState();
    expect(creatorState.phase).toBe("lobby");
    expect(creatorState.role).toBe("creator");
    expect(creatorState.members).toHaveLength(1);
    expect(creatorState.inviteUrl).toContain(`/join#secret=${code}`);
    await registerLocalGame(a, world);
    expect(a.engine.getState().members[0]?.ready).toBe(true);

    const { join: joinPromise, settled } = startJoin(b, world, code);
    await settled;
    await settle(world);
    await joinPromise;

    expect(b.engine.getState().phase).toBe("lobby");
    expect(b.engine.getState().role).toBe("joiner");
    expect(a.engine.getState().members).toHaveLength(2);
    expect(b.engine.getState().members).toHaveLength(2);

    await settle(world);
    expect(memberOf(b.engine.getState(), b.memberId).transferState).toBe("complete");
    await registerLocalGame(b, world);

    const aReady = memberOf(a.engine.getState(), a.memberId).ready;
    const bReady = memberOf(a.engine.getState(), b.memberId).ready;
    expect(aReady).toBe(true);
    expect(bReady).toBe(true);
    expect(memberOf(b.engine.getState(), a.memberId).ready).toBe(true);

    expect(a.engine.getState().canStart).toBe(true);
    expect(b.engine.getState().canStart).toBe(true);
    a.engine.startGame();
    await settle(world);
    expect(a.engine.getState().phase).toBe("playing");
    expect(b.engine.getState().phase).toBe("playing");

    a.engine.endGame("host_closed");
    await settle(world);
    expect(a.engine.getState().phase).toBe("lobby");
    expect(b.engine.getState().phase).toBe("lobby");
    expect(a.engine.getState().endedReason).toBe("host_closed");
    expect(b.engine.getState().endedReason).toBe("host_closed");

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
    // An empty private room has no host; signaling alone must not satisfy the peer gate.
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

    await b.engine.leaveParty();
    await settle(world);
    expect(b.engine.getState().phase).toBe("idle");
    world.clock.advance(5_500);
    await settle(world);
    await joinPromise;
    expect(b.engine.getState().phase).toBe("idle");
    expect(b.engine.getState().joinStage).toBeNull();
  });
});

describe("party engine — readiness and start gating", () => {
  it("re-renders the lobby when a peer becomes ready, with no other event", async () => {
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

    // Subscribe after join settles to isolate readiness-triggered notifications.
    const snapshots: ReturnType<PartyEngine["getState"]>[] = [];
    const stop = a.engine.onState((state) => snapshots.push(state));
    expect(memberOf(a.engine.getState(), b.memberId).ready).toBe(false);

    await registerLocalGame(b, world);
    await settle(world);
    stop();

    const latest = snapshots.at(-1);
    expect(latest).toBeDefined();
    expect(memberOf(latest!, b.memberId).ready).toBe(true);
    expect(latest!.canStart).toBe(true);
  });

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

    const blocked = a.engine.getState();
    expect(blocked.canStart).toBe(false);
    expect(blocked.canForceStart).toBe(true);
    expect(blocked.startBlockedReason).toMatch(/load and register/i);

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
    const promise = a.engine.createParty();
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

    await a.engine.selectGame({
      gameId: GAME.gameId,
      title: GAME.title,
      mode: GAME.mode,
      source: GAME.source,
    });
    await settle(world);
    state = a.engine.getState();
    expect(state.game).toEqual({ gameId: GAME.gameId, title: GAME.title, mode: GAME.mode });
    expect(a.harness.frames).toHaveLength(1);

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

    a.engine.endGame("host_closed");
    await settle(world);
    expect(a.engine.getState().phase).toBe("lobby");
    expect(b.engine.getState().phase).toBe("lobby");
    expect(a.engine.getState().endedReason).toBe("host_closed");

    // Ended sessions are one-shot; emulate container remounts and registration into fresh sessions.
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

    // React detaches the old ref before binding the play container; boot a fresh frame there.
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

describe("party engine — a frame rebooted after the game started", () => {
  it("replays start to a follower's new frame, so its actions are not refused", async () => {
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
    a.engine.startGame();
    await settle(world);
    expect(b.engine.getState().phase).toBe("playing");

    b.engine.setContainer(null);
    b.engine.setContainer(b.container);
    await settle(world);
    await registerLocalGame(b, world);

    // The rebooted frame must learn that the game started, or the game's
    // nova.dispatch is refused with not_started for this player.
    const startReplays = b.harness.port1.sent.filter(
      (message) =>
        (message as { type?: string; event?: { kind?: string } }).type === "game.apiEvent" &&
        (message as { event?: { kind?: string } }).event?.kind === "start",
    );
    expect(startReplays.length).toBeGreaterThan(0);

    await a.engine.leaveParty();
    await b.engine.leaveParty();
    await settle(world);
  });
});

describe("party engine — start delivery to a frame instance", () => {
  /** Start a game with a and b both registered, then return b's frame state. */
  async function playingPair(world: World) {
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
    a.engine.startGame();
    await settle(world);
    expect(b.engine.getState().phase).toBe("playing");
    return { a, b };
  }

  /** Session events are fed straight to the engine, as the session would emit them. */
  function emitSessionEvent(player: Player, event: unknown): void {
    (player.engine as unknown as { handleSessionEvent(event: unknown): void }).handleSessionEvent(
      event,
    );
  }

  function frameEvents(player: Player): Array<{ kind: string }> {
    return player.harness.port1.sent
      .filter((message) => (message as { type?: string }).type === "game.apiEvent")
      .map((message) => (message as { event: { kind: string } }).event);
  }

  it("delivers start to a rebooted frame exactly once, even when a live start follows registration", async () => {
    const world = makeWorld();
    const { a, b } = await playingPair(world);
    b.engine.setContainer(null);
    b.engine.setContainer(b.container);
    await settle(world);
    await registerLocalGame(b, world);
    expect(frameEvents(b).filter((event) => event.kind === "start")).toHaveLength(1);

    emitSessionEvent(b, { type: "start" });
    await settle(world);
    expect(frameEvents(b).filter((event) => event.kind === "start")).toHaveLength(1);

    await a.engine.leaveParty();
    await b.engine.leaveParty();
    await settle(world);
  });

  it("holds start until the rebooted frame has its state, then sends state followed by start", async () => {
    const world = makeWorld();
    const { a, b } = await playingPair(world);
    // The game started, but this player has no state yet.
    (b.engine as unknown as { lastStateApiEvent: unknown }).lastStateApiEvent = null;
    b.engine.setContainer(null);
    b.engine.setContainer(b.container);
    await settle(world);
    await registerLocalGame(b, world);
    expect(frameEvents(b).some((event) => event.kind === "start")).toBe(false);

    emitSessionEvent(b, { type: "state", state: { round: 1 } });
    await settle(world);
    const kinds = frameEvents(b).map((event) => event.kind);
    expect(kinds.filter((kind) => kind === "start")).toHaveLength(1);
    expect(kinds.indexOf("state")).toBeGreaterThanOrEqual(0);
    expect(kinds.indexOf("state")).toBeLessThan(kinds.indexOf("start"));

    await a.engine.leaveParty();
    await b.engine.leaveParty();
    await settle(world);
  });

  it("accepts a start request only from the host", async () => {
    const world = makeWorld();
    const { a, b } = await playingPair(world);
    const gate = (a.engine as unknown as { acceptStartRequestFrom(id: string): boolean })
      .acceptStartRequestFrom;
    expect(gate.call(a.engine, a.memberId)).toBe(true);
    expect(gate.call(a.engine, b.memberId)).toBe(false);

    await a.engine.leaveParty();
    await b.engine.leaveParty();
    await settle(world);
  });
  it("gives a frame reloaded after the game started exactly one start, after its state", async () => {
    const world = makeWorld();
    const { a, b } = await playingPair(world);
    const before = frameEvents(b).length;

    // Reloading swaps in a new frame instance that registers again. The runtime
    // reports the reload before the new frame can register.
    b.engine.reloadMyGame();
    await settle(world);
    deliver(b.harness.port1, {
      version: 1,
      runtimeInstanceId: "runtime-1",
      messageId: "message-reloaded",
      sentAt: 1_700_000_000_003,
      type: "game.lifecycle",
      event: "reloaded",
    });
    await registerLocalGame(b, world);
    await settle(world);

    const sinceReload = frameEvents(b).slice(before);
    const kinds = sinceReload.map((event) => event.kind);
    expect(kinds.filter((kind) => kind === "start")).toHaveLength(1);
    expect(kinds.indexOf("state")).toBeGreaterThanOrEqual(0);
    expect(kinds.indexOf("state")).toBeLessThan(kinds.indexOf("start"));

    emitSessionEvent(b, { type: "start" });
    await settle(world);
    expect(
      frameEvents(b)
        .slice(before)
        .filter((event) => event.kind === "start"),
    ).toHaveLength(1);

    await a.engine.leaveParty();
    await b.engine.leaveParty();
    await settle(world);
  });
  it("ignores a registration the old frame sent before a reload, so the new frame still gets its start", async () => {
    const world = makeWorld();
    const { a, b } = await playingPair(world);
    const before = frameEvents(b).length;

    b.engine.reloadMyGame();
    await settle(world);
    // The old frame's registration was already on the channel before the reload.
    b.harness.register(GAME.title);
    await settle(world);
    expect(
      frameEvents(b)
        .slice(before)
        .filter((event) => event.kind === "start"),
    ).toHaveLength(0);

    deliver(b.harness.port1, {
      version: 1,
      runtimeInstanceId: "runtime-1",
      messageId: "message-reloaded",
      sentAt: 1_700_000_000_003,
      type: "game.lifecycle",
      event: "reloaded",
    });
    b.harness.register(GAME.title);
    await settle(world);

    const kinds = frameEvents(b)
      .slice(before)
      .map((event) => event.kind);
    expect(kinds.filter((kind) => kind === "start")).toHaveLength(1);
    expect(kinds.indexOf("state")).toBeLessThan(kinds.indexOf("start"));

    await a.engine.leaveParty();
    await b.engine.leaveParty();
    await settle(world);
  });
});

describe("party engine — host start-request retry", () => {
  /** A host (b) whose start request the elected authority (a) has not honoured yet. */
  async function hostAwaitingStart(world: World) {
    // The host is "b" and the joiner "a", so the joiner is the elected authority.
    const b = makePlayer(world, "b");
    const a = makePlayer(world, "a");
    const code = await runCreate(b, world);
    await registerLocalGame(b, world);
    const { join: joinPromise, settled } = startJoin(a, world, code);
    await settled;
    await settle(world);
    await joinPromise;
    await settle(world);
    await registerLocalGame(a, world);
    return { a, b };
  }

  function sessionOf(player: Player) {
    return (player.engine as unknown as { session: { resendStartRequest(): void } }).session;
  }

  it("re-sends the start request every 2 s while the authority has not started", async () => {
    const world = makeWorld();
    const { a, b } = await hostAwaitingStart(world);
    const resend = vi.spyOn(sessionOf(b), "resendStartRequest");
    // No drain: the authority never receives the request, so it stays silent.
    b.engine.startGame();
    expect(resend).toHaveBeenCalledTimes(0);

    world.clock.advance(2_000);
    expect(resend).toHaveBeenCalledTimes(1);
    world.clock.advance(4_000);
    expect(resend).toHaveBeenCalledTimes(3);
    expect(b.engine.getState().phase).toBe("starting");

    await a.engine.leaveParty();
    await b.engine.leaveParty();
    await settle(world);
  });

  it("clears the give-up notice when the authority's start arrives late", async () => {
    const world = makeWorld();
    const { a, b } = await hostAwaitingStart(world);
    b.engine.startGame();
    world.clock.advance(30_000);
    expect(b.engine.getState().notices.map((notice) => notice.message)).toContain(
      "Couldn't start the game. Try again.",
    );

    (b.engine as unknown as { handleSessionEvent(e: unknown): void }).handleSessionEvent({
      type: "start",
    });
    expect(b.engine.getState().notices.map((notice) => notice.message)).not.toContain(
      "Couldn't start the game. Try again.",
    );
    expect(b.engine.getState().phase).toBe("playing");

    await a.engine.leaveParty();
    await b.engine.leaveParty();
    await settle(world);
  });

  it("stops retrying when the authority starts the game", async () => {
    const world = makeWorld();
    const { a, b } = await hostAwaitingStart(world);
    const resend = vi.spyOn(sessionOf(b), "resendStartRequest");
    b.engine.startGame();
    world.clock.advance(2_000);
    expect(resend).toHaveBeenCalledTimes(1);

    (b.engine as unknown as { handleSessionEvent(e: unknown): void }).handleSessionEvent({
      type: "start",
    });
    world.clock.advance(60_000);
    expect(resend).toHaveBeenCalledTimes(1);
    expect(b.engine.getState().phase).toBe("playing");

    await a.engine.leaveParty();
    await b.engine.leaveParty();
    await settle(world);
  });

  it("gives up after 30 s with a notice and returns the host to the lobby", async () => {
    const world = makeWorld();
    const { a, b } = await hostAwaitingStart(world);
    const resend = vi.spyOn(sessionOf(b), "resendStartRequest");
    b.engine.startGame();

    world.clock.advance(30_000);
    expect(resend).toHaveBeenCalledTimes(14);
    const state = b.engine.getState();
    expect(state.phase).toBe("lobby");
    expect(state.notices.map((notice) => notice.message)).toContain(
      "Couldn't start the game. Try again.",
    );
    world.clock.advance(60_000);
    expect(resend).toHaveBeenCalledTimes(14);

    await a.engine.leaveParty();
    await b.engine.leaveParty();
    await settle(world);
  });

  it("stops retrying when the party is left", async () => {
    const world = makeWorld();
    const { a, b } = await hostAwaitingStart(world);
    const resend = vi.spyOn(sessionOf(b), "resendStartRequest");
    b.engine.startGame();
    world.clock.advance(2_000);
    expect(resend).toHaveBeenCalledTimes(1);

    await b.engine.leaveParty();
    await settle(world);
    world.clock.advance(60_000);
    expect(resend).toHaveBeenCalledTimes(1);

    await a.engine.leaveParty();
    await settle(world);
  });
});

describe("party engine — source re-request while a member's source waits", () => {
  it("asks the party again every 2 s while a member's source is waiting, and stops once it arrives", async () => {
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

    const engine = a.engine as unknown as {
      coordinator: { refresh(): Promise<void> } | null;
      transfers: Map<string, { state: string; fraction: number; detail: string | null }>;
      emit(): void;
    };
    const refresh = vi.spyOn(engine.coordinator!, "refresh").mockResolvedValue(undefined);
    engine.transfers.delete(b.memberId);
    engine.emit();
    world.clock.advance(2_000);
    expect(refresh).toHaveBeenCalledTimes(1);
    world.clock.advance(2_000);
    expect(refresh).toHaveBeenCalledTimes(2);

    engine.transfers.set(b.memberId, { state: "complete", fraction: 1, detail: null });
    engine.emit();
    world.clock.advance(10_000);
    expect(refresh).toHaveBeenCalledTimes(2);

    await a.engine.leaveParty();
    await b.engine.leaveParty();
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
    // The handshake falls back to member ids for unnamed players; keep those ids out of notices.
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

describe("source verification is keyed by the source hash", () => {
  it("a member verified for the old hash waits again when the same game id has a new hash", async () => {
    const world = makeWorld();
    const a = makePlayer(world, "a");
    const b = makePlayer(world, "b");
    const code = await runCreate(a, world);
    await registerLocalGame(a, world);
    const { join, settled } = startJoin(b, world, code);
    await settled;
    await settle(world);
    await join;
    await settle(world);
    await registerLocalGame(b, world);
    await settle(world);
    expect(memberOf(b.engine.getState(), a.memberId).transferState).toBe("complete");
    expect(b.engine.getState().canStart).toBe(true);

    const coordinatorEvent = (event: unknown) =>
      (b.engine as unknown as { handleCoordinatorEvent(e: unknown): void }).handleCoordinatorEvent(
        event,
      );
    const gameId = GAME.gameId;
    coordinatorEvent({
      type: "metadata",
      metadata: {
        gameId,
        title: GAME.title,
        mode: GAME.mode,
        sourceSha256: "edited-hash",
        sourceSizeBytes: 9,
      },
      fromMemberId: a.memberId,
    });
    expect(memberOf(b.engine.getState(), a.memberId).transferState).toBe("waiting");
    expect(b.engine.getState().canStart).toBe(false);

    coordinatorEvent({
      type: "received",
      fromMemberId: a.memberId,
      gameId,
      sourceSha256: "edited-hash",
      source: "<html>edited</html>",
    });
    coordinatorEvent({
      type: "complete",
      direction: "receive",
      memberId: a.memberId,
      gameId,
      sourceSha256: "edited-hash",
    });
    expect(memberOf(b.engine.getState(), a.memberId).transferState).toBe("complete");
    // The new source reboots this player's frame, which must register again.
    expect(b.engine.getState().startBlockedReason).toMatch(/load and register/i);
    await registerLocalGame(b, world);
    await settle(world);
    expect(b.engine.getState().canStart).toBe(true);
  });
});

describe("the party debug snapshot", () => {
  it("reports the engine state on window.__NOVA_PARTY_DEBUG__ before any party exists", () => {
    const world = makeWorld();
    makePlayer(world, "a");
    const debug = (globalThis as { __NOVA_PARTY_DEBUG__?: () => Record<string, unknown> })
      .__NOVA_PARTY_DEBUG__;
    expect(debug).toBeTypeOf("function");
    expect(debug!()).toMatchObject({
      phase: "idle",
      gameStarted: false,
      frameExists: false,
      frameStartDelivered: false,
      startRetryActive: false,
      startGaveUp: false,
      session: null,
      authority: null,
      canStart: false,
      members: [expect.objectContaining({ isSelf: true, transferState: "waiting" })],
    });
  });
});

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

    await registerLocalGame(a, world);
    expect(a.engine.getState().members[0]?.ready).toBe(true);

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

    await settle(world);
    expect(memberOf(b.engine.getState(), b.memberId).transferState).toBe("complete");
    await registerLocalGame(b, world);
    expect(a.engine.getState().canStart).toBe(true);
    expect(b.engine.getState().canStart).toBe(true);

    a.engine.startGame();
    await settle(world);
    expect(a.engine.getState().phase).toBe("playing");
    expect(b.engine.getState().phase).toBe("playing");

    a.engine.endGame("host_closed");
    await settle(world);
    expect(a.engine.getState().phase).toBe("lobby");
    expect(b.engine.getState().phase).toBe("lobby");
    expect(a.engine.getState().endedReason).toBe("host_closed");

    await a.engine.leaveParty();
    await b.engine.leaveParty();
    await settle(world);
    expect(world.hub.roomNames().every((room) => world.hub.membersOf(room).length === 0)).toBe(
      true,
    );
  });
});

// Mobile Safari lifecycle resilience (ADR-0012).

/** Simulate an iOS-killed WebRTC link: state still says connected, but pings never answer. */
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
  request(options: Parameters<NovaTransport["request"]>[0]): Promise<unknown> {
    return this.delegate.request(options);
  }
  handleRequest(...args: Parameters<NovaTransport["handleRequest"]>): () => void {
    return this.delegate.handleRequest(...args);
  }
  ping(): Promise<number | null> {
    return Promise.resolve(null);
  }
}

/** A world whose named joiner's transport reports connected but never answers pings. */
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

    lifecycle.hide();
    expect(b.engine.getState().connectionState).toBe("connected");
    const reconnectSpy = vi.spyOn(
      world.transports.find(
        (t) => t.selfMemberId === b.memberId && t.connectionState === "connected",
      )!,
      "reconnect",
    );
    lifecycle.show();
    await settle(world);

    const bState = b.engine.getState();
    expect(bState.phase).toBe("lobby");
    expect(bState.connectionState).toBe("connected");
    expect(bState.reconnectAttempts).toBe(0);
    expect(bState.members).toHaveLength(2);
    expect(a.engine.getState().members).toHaveLength(2);
    expect(reconnectSpy).toHaveBeenCalledTimes(1);
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

    world.clock.advance(5_000);
    await settle(world);
    expect(a.engine.getState().phase).toBe("lobby");
    expect(a.engine.getState().reconnectAttempts).toBe(0);
  });

  it("shares one in-flight attempt across concurrent reconnect calls", async () => {
    const world = makeWorld();
    const a = makePlayer(world, "a");
    await runCreate(a, world);
    const privateTransport = world.transports.find((t) => t.selfMemberId === a.memberId)!;
    await privateTransport.suspend();
    await settle(world);
    const resume = vi.spyOn(privateTransport, "resume");
    await Promise.all([a.engine.reconnect(), a.engine.reconnect(), a.engine.reconnect()]);
    expect(resume).toHaveBeenCalledTimes(1);
    expect(a.engine.getState().phase).toBe("lobby");
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

    lifecycle.hide();
    const bTransport = world.transports.find(
      (t) => t.selfMemberId === b.memberId && t.connectionState === "connected",
    );
    await bTransport?.suspend();
    await settle(world);
    expect(b.engine.getState().phase).toBe("reconnecting");

    lifecycle.show();
    await settle(world);
    expect(b.engine.getState().phase).toBe("playing");
    expect(b.engine.getState().connectionState).toBe("connected");
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

    // The session attaches before its frame exists, so registration must replay
    // identity, connection, and roster events.
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

    const { join: joinPromise, settled } = startJoin(b, world, code);
    await settled;
    await settle(world);
    await joinPromise;
    await settle(world);
    await registerLocalGame(b, world);
    await settle(world);

    const aJoinedAfter = apiEventsOf(a)
      .filter((event) => event.kind === "playerJoined")
      .map((event) => (event.player as { id: string }).id);
    expect(aJoinedAfter).toContain(b.memberId);
    const bJoined = apiEventsOf(b)
      .filter((event) => event.kind === "playerJoined")
      .map((event) => (event.player as { id: string }).id);
    expect(bJoined).toContain(a.memberId);
    expect(bJoined).toContain(b.memberId);

    a.engine.startGame();
    await settle(world);
    expect(apiEventsOf(a).some((event) => event.kind === "start")).toBe(true);
    expect(apiEventsOf(b).some((event) => event.kind === "start")).toBe(true);

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

    // Rebinding boots a new frame; registration must replay state before start.
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

    expect(memberOf(b.engine.getState(), a.memberId).displayName).toBe("Player a");

    a.engine.setDisplayName("Alpha Renamed");
    await settle(world);

    expect(memberOf(b.engine.getState(), a.memberId).displayName).toBe("Alpha Renamed");
    expect(memberOf(a.engine.getState(), a.memberId).displayName).toBe("Alpha Renamed");
    expect(memberOf(b.engine.getState(), b.memberId).displayName).toBe("Player b");

    await a.engine.leaveParty();
    await b.engine.leaveParty();
    await settle(world);
  });
});

describe("party engine — classic games, kick, and reload (7.7.4, 7.29)", () => {
  it("shares a classic room: the host creates it once, the joiner builds the same room", async () => {
    const world = makeWorld();
    const a = makePlayer(world, "a");
    const b = makePlayer(world, "b");

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
    expect(aState.canStart).toBe(true);

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

    const bState = b.engine.getState();
    expect(bState.removedReason).toBe("The host removed you from the party.");
    expect(bState.phase).toBe("removed");
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

    a.engine.reloadMyGame();
    const sentA = a.harness.port1.sent as Array<{ type: string }>;
    expect(sentA.some((message) => message.type === "runtime.reload")).toBe(true);

    b.harness.port1.sent.length = 0;
    a.engine.reloadAllGames();
    await settle(world);
    const sentB = b.harness.port1.sent as Array<{ type: string }>;
    expect(sentB.some((message) => message.type === "runtime.reload")).toBe(true);
  });
});

// Exercise default-factory TURN setup without opening real Trystero rooms.

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
    // Explicit undefined bypasses makePlayer's default transportFactory.
    return makePlayer(world, "host", { transportFactory: undefined, ...overrides });
  }

  it("env unset → no mint fetch, no TURN wiring, no notice (works as today)", async () => {
    const world = makeWorld();
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    // No VITE_EDGE_ORIGIN stub → unconfigured build; the real mint
    // client short-circuits before touching fetch.
    const player = makeDefaultFactoryPlayer(world);
    await runCreate(player, world);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(transportFactoryMocks.createTrysteroPartyTransportFactory).toHaveBeenCalledWith({
      onJoinError: expect.any(Function),
      onTunnel: expect.any(Function),
      onTunnelFailure: expect.any(Function),
    });
    const state = player.engine.getState();
    expect(state.phase).toBe("lobby");
    expect(state.notices.some((notice) => notice.message.includes("TURN"))).toBe(false);
    expect(state.diagnostics?.turn).toBe("disabled");
  });

  it.each(["room-full", "decrypt-failed"] as const)(
    "reports %s only after the join fails and resets it on retry",
    async (code) => {
      const world = makeWorld();
      const player = makeDefaultFactoryPlayer(world, { peerConnectTimeoutMs: 1_000 });
      const joining = player.engine.joinByInvite({ secret: "E".repeat(43) });
      await settle(world);
      const options = transportFactoryMocks.createTrysteroPartyTransportFactory.mock.calls[0]?.[0];
      expect(options?.onJoinError).toBeDefined();
      options?.onJoinError?.(
        fromRoomError({
          code,
          peerId: "unrelated-peer",
          stage: "offer",
          appId: "test",
          roomId: "test",
          message: "a peer report does not establish why joining fails",
        }),
      );
      expect(player.engine.getState().phase).toBe("joining");
      world.clock.advance(1_000);
      await settle(world);
      await joining;
      expect(player.engine.getState().phase).toBe("error");
      expect(player.engine.getState().setupFailureCode).toBe(code);
      expect(player.engine.getState().lastError).toMatch(/couldn't reach anyone/i);
      player.engine.retrySetup();
      await settle(world);
      expect(player.engine.getState().setupFailureCode).toBeNull();
      // A delayed callback from the previous transport cannot contaminate retry.
      options?.onJoinError?.({ code, category: "unknown", message: "late report" });
      world.clock.advance(1_000);
      await settle(world);
      expect(player.engine.getState().phase).toBe("error");
      expect(player.engine.getState().setupFailureCode).toBeNull();
      expect(player.engine.getState().lastError).toMatch(/couldn't reach anyone/i);
    },
  );

  it.each([
    [
      "room-full",
      "A player reported the party may be full. This affects a connection to that player and doesn't necessarily mean you can't stay in the party.",
    ],
    [
      "decrypt-failed",
      "A message from another player couldn't be decrypted. It may be damaged or use a different invite; you may still be connected to the party.",
    ],
  ] as const)("qualifies %s as a peer notice in an established party", async (code, expected) => {
    const world = makeWorld();
    const host = makePlayer(world, "host");
    const secret = await runCreate(host, world);
    const player = makeDefaultFactoryPlayer(world);
    const joining = player.engine.joinByInvite({ secret });
    await settle(world);
    await joining;
    expect(player.engine.getState().phase).toBe("lobby");
    const options = transportFactoryMocks.createTrysteroPartyTransportFactory.mock.calls[0]?.[0];
    options?.onJoinError?.(
      fromRoomError({
        code,
        peerId: "other-peer",
        stage: "offer",
        appId: "test",
        roomId: "test",
        message: "peer error",
      }),
    );
    expect(player.engine.getState().phase).toBe("lobby");
    expect(player.engine.getState().setupFailureCode).toBeNull();
    expect(player.engine.getState().notices.map((notice) => notice.message)).toContain(expected);
    await player.engine.leaveParty();
    await host.engine.leaveParty();
  });

  it.each(["room-full", "decrypt-failed"] as const)(
    "deduplicates %s per party without letting stale callbacks suppress it",
    async (code) => {
      const world = makeWorld();
      const host = makePlayer(world, "host");
      const secret = await runCreate(host, world);
      const player = makeDefaultFactoryPlayer(world);
      const firstJoin = player.engine.joinByInvite({ secret });
      await settle(world);
      await firstJoin;
      const old = transportFactoryMocks.createTrysteroPartyTransportFactory.mock.calls[0]?.[0];
      const report = fromRoomError({
        code,
        peerId: "old-peer",
        stage: "offer",
        appId: "test",
        roomId: "old-room",
        message: "peer report",
      });
      expect(old?.onJoinError).toBeDefined();
      const originalCount = player.engine.getState().notices.length;
      old?.onJoinError?.(report);
      old?.onJoinError?.(report);
      expect(player.engine.getState().notices).toHaveLength(originalCount + 1);
      const firstMessage = player.engine.getState().notices.at(-1)?.message;
      await player.engine.leaveParty();
      const rejoin = player.engine.joinByInvite({ secret });
      await settle(world);
      await rejoin;
      expect(player.engine.getState().phase).toBe("lobby");
      const before = player.engine.getState().notices;
      old?.onJoinError?.(report);
      expect(player.engine.getState().notices).toEqual(before);
      const current = transportFactoryMocks.createTrysteroPartyTransportFactory.mock.calls[1]?.[0];
      expect(current?.onJoinError).toBeDefined();
      current?.onJoinError?.(report);
      current?.onJoinError?.(report);
      expect(player.engine.getState().notices.map((notice) => notice.message)).toEqual([
        ...before.map((notice) => notice.message),
        firstMessage,
      ]);
      expect(player.engine.getState().phase).toBe("lobby");
      await player.engine.leaveParty();
      await host.engine.leaveParty();
    },
  );

  it("does not leave a stale relay-failed notice after recovery", async () => {
    const world = makeWorld();
    const player = makeDefaultFactoryPlayer(world);
    await runCreate(player, world);
    const options = transportFactoryMocks.createTrysteroPartyTransportFactory.mock.calls[0]?.[0];
    options?.onJoinError?.({
      code: "relay-failed",
      category: "relay_unreachable",
      message: "failed",
    });
    expect(
      player.engine.getState().notices.some((notice) => /signaling relays/i.test(notice.message)),
    ).toBe(false);
    await player.engine.leaveParty();
  });

  it.each([
    ["room-full", /player reported the party may be full/i],
    ["decrypt-failed", /message from another player couldn't be decrypted/i],
    ["banned", /rejected/i],
    ["identity-failed", /unexpected state/i],
    ["plugin-failed", /unexpected state/i],
    ["handshake-failed", /rejected/i],
    ["peer-error", /closed while joining/i],
  ])("shows and deduplicates a notice for RoomError %s", async (code, expected) => {
    const world = makeWorld();
    const player = makeDefaultFactoryPlayer(world);
    await runCreate(player, world);
    const options = transportFactoryMocks.createTrysteroPartyTransportFactory.mock.calls[0]?.[0];
    expect(options?.onJoinError).toBeDefined();
    options?.onJoinError?.({
      code,
      category: "unknown",
      message: "unrelated wording",
    });
    options?.onJoinError?.({
      code,
      category: "unknown",
      message: "different wording",
    });
    expect(
      player.engine.getState().notices.filter((notice) => expected.test(notice.message)),
    ).toHaveLength(1);
  });

  it("preserves legacy category notices without parsing error messages", async () => {
    const world = makeWorld();
    const player = makeDefaultFactoryPlayer(world);
    await runCreate(player, world);
    const options = transportFactoryMocks.createTrysteroPartyTransportFactory.mock.calls[0]?.[0];
    options?.onJoinError?.({ category: "incompatible_version", message: "anything" });
    options?.onJoinError?.({ category: "peer_connection_failed", message: "anything" });
    options?.onJoinError?.(new Error("could not connect to peer"));
    const notices = player.engine.getState().notices;
    expect(
      notices.filter((notice) => /incompatible Nova version/i.test(notice.message)),
    ).toHaveLength(1);
    // peer-connect-failed is a join-level signal, not a pair outcome: no lobby notice.
    expect(notices.filter((notice) => /couldn't connect/i.test(notice.message))).toHaveLength(0);
  });

  it("mint success → turnConfig baked into the default factory + configured diagnostic", async () => {
    vi.stubEnv("VITE_EDGE_ORIGIN", "https://turn-creds.example.workers.dev");
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
      onTunnel: expect.any(Function),
      onTunnelFailure: expect.any(Function),
      turnConfig,
    });
    const state = player.engine.getState();
    expect(state.phase).toBe("lobby");
    expect(state.diagnostics?.turn).toBe("configured");
    expect(state.notices.some((notice) => notice.message.includes("TURN"))).toBe(false);
  });

  it("mint failure (network/403/5xx/timeout) → party still creates WITHOUT TURN, TURN state in diagnostics only", async () => {
    vi.stubEnv("VITE_EDGE_ORIGIN", "https://turn-creds.example.workers.dev");
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
      onTunnel: expect.any(Function),
      onTunnelFailure: expect.any(Function),
    });
    const state = player.engine.getState();
    expect(state.phase).toBe("lobby");
    expect(state.diagnostics?.turn).toBe("unavailable");
    expect(state.notices.some((notice) => notice.message.includes("TURN"))).toBe(false);
  });

  it("mints ONCE and reuses the cached turnConfig across setup attempts", async () => {
    vi.stubEnv("VITE_EDGE_ORIGIN", "https://turn-creds.example.workers.dev");
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

    await player.engine.leaveParty();
    await runCreate(player, world);
    expect(turnCreds).toHaveBeenCalledTimes(1);
    expect(transportFactoryMocks.createTrysteroPartyTransportFactory).toHaveBeenLastCalledWith({
      onJoinError: expect.any(Function),
      onTunnel: expect.any(Function),
      onTunnelFailure: expect.any(Function),
      turnConfig,
    });
  });

  it("re-mints once less than half the 24 h lease remains, never mutating live peers", async () => {
    vi.stubEnv("VITE_EDGE_ORIGIN", "https://turn-creds.example.workers.dev");
    const world = makeWorld();
    const turnConfig = [{ urls: "turn:one", username: "u1", credential: "c1" }];
    const turnCreds = vi.fn(async (): Promise<TurnCredentialsResult> => ({ ok: true, turnConfig }));
    const player = makeDefaultFactoryPlayer(world, { turnCreds });
    await runCreate(player, world);
    expect(turnCreds).toHaveBeenCalledTimes(1);
    await player.engine.leaveParty();
    world.clock.advance(11 * 60 * 60 * 1000);
    await runCreate(player, world);
    expect(turnCreds).toHaveBeenCalledTimes(1);
    await player.engine.leaveParty();
    world.clock.advance(2 * 60 * 60 * 1000);
    await runCreate(player, world);
    expect(turnCreds).toHaveBeenCalledTimes(2);
    expect(transportFactoryMocks.createTrysteroPartyTransportFactory).toHaveBeenLastCalledWith({
      onJoinError: expect.any(Function),
      onTunnel: expect.any(Function),
      onTunnelFailure: expect.any(Function),
      turnConfig,
    });
  });

  it("does not mint when the transport factory is injected (tests/embedders)", async () => {
    vi.stubEnv("VITE_EDGE_ORIGIN", "https://turn-creds.example.workers.dev");
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

// Exercise transport-owned diagnostics without an injected diagnostics provider.

describe("party engine — signaling outage setup", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  function failingRelay(world: World, category: string) {
    let attempts = 0;
    let connected = false;
    const listeners = new Set<(value: boolean) => void>();
    world.factory.createPrivateTransport = (identity) => {
      const transport = world.hub.createTransport(identity);
      const join = transport.join.bind(transport);
      transport.join = async (request) => {
        attempts++;
        if (!connected) throw Object.assign(new Error(category), { category });
        await join(request);
      };
      const observable = transport as typeof transport & {
        onRelayStateChange: (handler: (value: boolean) => void) => () => void;
      };
      observable.onRelayStateChange = (handler) => {
        listeners.add(handler);
        handler(connected);
        return () => {
          listeners.delete(handler);
        };
      };
      return transport;
    };
    return {
      attempts: () => attempts,
      listenerCount: () => listeners.size,
      connect: () => {
        connected = true;
        for (const listener of listeners) listener(true);
      },
    };
  }

  it("warns after five seconds, retries one join at a time, and recovers", async () => {
    vi.stubEnv("VITE_EDGE_ORIGIN", "https://edge.example");
    const sendBeacon = vi.fn(() => true);
    vi.stubGlobal("navigator", { ...globalThis.navigator, sendBeacon, userAgent: "" });
    const world = makeWorld();
    const relay = failingRelay(world, "relay_unreachable");
    const player = makePlayer(world, "host");
    const setup = player.engine.createParty();
    await flush();
    expect(relay.attempts()).toBe(1);
    world.clock.advance(4_999);
    await flush();
    expect(player.engine.getState().signalingOutage).toBe(false);
    expect(sendBeacon).not.toHaveBeenCalled();
    world.clock.advance(1);
    await flush();
    expect(player.engine.getState().signalingOutage).toBe(true);
    expect(sendBeacon).toHaveBeenCalledOnce();
    const [, body] = sendBeacon.mock.calls[0] as unknown as [string, string];
    expect(JSON.parse(body)).toMatchObject({
      outcome: "failed",
      error_code: "relay-failed",
      signaling_ok: false,
    });
    relay.connect();
    expect(player.engine.getState().signalingOutage).toBe(false);
    world.clock.advance(1_000);
    await settle(world);
    await setup;
    expect(player.engine.getState().phase).toBe("lobby");
    await player.engine.leaveParty();
    expect(relay.listenerCount()).toBe(0);
  });

  it("cancels retry and ignores late recovery after leaving", async () => {
    const world = makeWorld();
    const relay = failingRelay(world, "relay_unreachable");
    const player = makePlayer(world, "host");
    const setup = player.engine.createParty();
    await flush();
    expect(relay.attempts()).toBe(1);
    await player.engine.leaveParty();
    relay.connect();
    world.clock.advance(20_000);
    await setup;
    expect(relay.attempts()).toBe(1);
    expect(relay.listenerCount()).toBe(0);
    expect(player.engine.getState().phase).toBe("idle");
  });

  it("rejects duplicate setups while retrying and leaves only one attempt", async () => {
    const world = makeWorld();
    const relay = failingRelay(world, "relay_unreachable");
    const player = makePlayer(world, "host");
    const setup = player.engine.createParty();
    await flush();
    await expect(player.engine.createParty()).rejects.toThrow(/already in progress/i);
    expect(relay.attempts()).toBe(1);
    await player.engine.leaveParty();
    await setup;
  });

  it("does not resurrect a setup when a cancelled join resolves late", async () => {
    const world = makeWorld();
    let resolveJoin!: () => void;
    let leaves = 0;
    world.factory.createPrivateTransport = (identity) => {
      const transport = world.hub.createTransport(identity);
      transport.join = () =>
        new Promise<void>((resolve) => {
          resolveJoin = resolve;
        });
      const leave = transport.leave.bind(transport);
      transport.leave = async () => {
        leaves++;
        await leave();
      };
      (
        transport as typeof transport & {
          onRelayStateChange: (cb: (connected: boolean) => void) => () => void;
        }
      ).onRelayStateChange = (cb) => {
        cb(false);
        return () => undefined;
      };
      return transport;
    };
    const player = makePlayer(world, "host");
    const setup = player.engine.createParty();
    await flush();
    await player.engine.leaveParty();
    resolveJoin();
    await setup;
    expect(leaves).toBeGreaterThan(0);
    expect(player.engine.getState().phase).toBe("idle");
    expect(player.engine.getState().inviteUrl).toBeNull();
  });

  it("does not let an old cancelled join overwrite a new party", async () => {
    const world = makeWorld();
    let resolveOld!: () => void;
    let created = 0;
    world.factory.createPrivateTransport = (identity) => {
      const transport = world.hub.createTransport(identity);
      if (created++ === 0) {
        transport.join = () =>
          new Promise<void>((resolve) => {
            resolveOld = resolve;
          });
      }
      return transport;
    };
    const player = makePlayer(world, "host");
    const old = player.engine.createParty();
    await flush();
    await player.engine.leaveParty();
    const invite = await runCreate(player, world);
    resolveOld();
    await old;
    expect(player.engine.getState().phase).toBe("lobby");
    expect(parseInviteFragment(new URL(player.engine.getState().inviteUrl!).hash)?.secret).toBe(
      invite,
    );
    await player.engine.leaveParty();
  });

  it("does not retain the initial retry wrapper for later reconnects", async () => {
    const world = makeWorld();
    let connected = true;
    let joins = 0;
    let request: Parameters<NovaTransport["join"]>[0] | undefined;
    world.factory.createPrivateTransport = (identity) => {
      const transport = world.hub.createTransport(identity);
      const join = transport.join.bind(transport);
      transport.join = async (input) => {
        joins++;
        request = input;
        if (!connected)
          throw Object.assign(new Error("offline"), { category: "relay_unreachable" });
        await join(input);
      };
      transport.reconnect = async () => {
        await transport.join(request!);
      };
      (
        transport as typeof transport & {
          onRelayStateChange: (cb: (connected: boolean) => void) => () => void;
        }
      ).onRelayStateChange = (cb) => {
        cb(true);
        return () => undefined;
      };
      return transport;
    };
    const player = makePlayer(world, "host");
    await runCreate(player, world);
    expect(joins).toBe(1);
    connected = false;
    await player.engine.reconnect();
    expect(joins).toBe(2);
    await player.engine.leaveParty();
    connected = true;
    world.clock.advance(60_000);
    await settle(world);
    expect(joins).toBe(2);
    expect(player.engine.getState().phase).toBe("idle");
  });

  it("ignores a reconnect failure that settles after leaving", async () => {
    const world = makeWorld();
    let rejectReconnect!: (reason: unknown) => void;
    let reconnects = 0;
    world.factory.createPrivateTransport = (identity) => {
      const transport = world.hub.createTransport(identity);
      transport.reconnect = () => {
        reconnects++;
        return new Promise<void>((_resolve, reject) => {
          rejectReconnect = reject;
        });
      };
      (
        transport as typeof transport & {
          onRelayStateChange: (cb: (connected: boolean) => void) => () => void;
        }
      ).onRelayStateChange = (cb) => {
        cb(true);
        return () => undefined;
      };
      return transport;
    };
    const player = makePlayer(world, "host");
    await runCreate(player, world);
    const reconnect = player.engine.reconnect();
    await player.engine.leaveParty();
    rejectReconnect(Object.assign(new Error("offline"), { category: "relay_unreachable" }));
    await reconnect;
    world.clock.advance(60_000);
    await settle(world);
    expect(reconnects).toBe(1);
    expect(player.engine.getState().phase).toBe("idle");
    expect(player.engine.getState().notices).toEqual([]);
  });

  it("waits for pending transport teardown before an immediate new join", async () => {
    const world = makeWorld();
    let created = 0;
    let finishLeave!: () => void;
    const barrier = new Promise<void>((resolve) => {
      finishLeave = resolve;
    });
    world.factory.createPrivateTransport = (identity) => {
      const transport = world.hub.createTransport(identity);
      created++;
      if (created === 1) {
        transport.join = async () => {
          throw Object.assign(new Error("offline"), { category: "relay_unreachable" });
        };
        const leave = transport.leave.bind(transport);
        transport.leave = async () => {
          await barrier;
          await leave();
        };
        (
          transport as typeof transport & {
            onRelayStateChange: (cb: (connected: boolean) => void) => () => void;
          }
        ).onRelayStateChange = (cb) => {
          cb(false);
          return () => undefined;
        };
      }
      return transport;
    };
    const player = makePlayer(world, "host");
    const first = player.engine.joinByInvite({ secret: "T".repeat(43) });
    await flush();
    const leaving = player.engine.leaveParty();
    const second = player.engine.joinByInvite({ secret: "T".repeat(43) });
    await flush();
    expect(created).toBe(1);
    finishLeave();
    await leaving;
    await first;
    await settle(world);
    expect(created).toBe(2);
    await player.engine.leaveParty();
    await second;
  });

  it("can cancel a new setup while it is waiting for old teardown", async () => {
    const world = makeWorld();
    let created = 0;
    let finishLeave!: () => void;
    const barrier = new Promise<void>((resolve) => {
      finishLeave = resolve;
    });
    world.factory.createPrivateTransport = (identity) => {
      const transport = world.hub.createTransport(identity);
      created++;
      transport.join = async () => {
        throw Object.assign(new Error("offline"), { category: "relay_unreachable" });
      };
      const leave = transport.leave.bind(transport);
      transport.leave = async () => {
        await barrier;
        await leave();
      };
      (
        transport as typeof transport & {
          onRelayStateChange: (cb: (connected: boolean) => void) => () => void;
        }
      ).onRelayStateChange = (cb) => {
        cb(false);
        return () => undefined;
      };
      return transport;
    };
    const player = makePlayer(world, "host");
    const first = player.engine.joinByInvite({ secret: "T".repeat(43) });
    await flush();
    const leaving = player.engine.leaveParty();
    const second = player.engine.joinByInvite({ secret: "T".repeat(43) });
    const cancel = player.engine.leaveParty();
    await second; // cancellation settles before the old teardown is released
    expect(created).toBe(1);
    const third = player.engine.joinByInvite({ secret: "T".repeat(43) });
    await flush();
    expect(created).toBe(1); // the teardown barrier still gates later attempts
    const cancelThird = player.engine.leaveParty();
    await third;
    finishLeave();
    await Promise.all([first, leaving, cancel, cancelThird]);
    expect(created).toBe(1);
    expect(player.engine.getState().phase).toBe("idle");
  });

  it("fails closed if an established party's transport cannot leave", async () => {
    const world = makeWorld();
    let created = 0;
    world.factory.createPrivateTransport = (identity) => {
      const transport = world.hub.createTransport(identity);
      created++;
      if (created === 1)
        transport.leave = async () => {
          throw new Error("teardown failed");
        };
      return transport;
    };
    const player = makePlayer(world, "host");
    await runCreate(player, world);
    const leaving = player.engine.leaveParty();
    const retry = player.engine.createParty();
    await Promise.all([leaving, retry]);
    expect(created).toBe(1);
    expect(player.engine.getState().phase).toBe("error");
    expect(player.engine.getState().lastError).toMatch(/reload.*before joining/i);
    player.engine.dismissError();
    await player.engine.joinByInvite({ secret: "T".repeat(43) });
    expect(created).toBe(1);
    expect(player.engine.getState().phase).toBe("error");
  });

  it("fails closed after pending teardown rejects until a fresh engine is created", async () => {
    const world = makeWorld();
    let created = 0;
    world.factory.createPrivateTransport = (identity) => {
      const transport = world.hub.createTransport(identity);
      created++;
      if (created === 1) {
        transport.join = async () => {
          throw Object.assign(new Error("offline"), { category: "relay_unreachable" });
        };
        transport.leave = async () => {
          throw new Error("teardown failed");
        };
        (
          transport as typeof transport & {
            onRelayStateChange: (cb: (connected: boolean) => void) => () => void;
          }
        ).onRelayStateChange = (cb) => {
          cb(false);
          return () => undefined;
        };
      }
      return transport;
    };
    const player = makePlayer(world, "host");
    const first = player.engine.joinByInvite({ secret: "T".repeat(43) });
    await flush();
    const leaving = player.engine.leaveParty();
    const second = player.engine.joinByInvite({ secret: "T".repeat(43) });
    await Promise.all([first, leaving, second]);
    expect(created).toBe(1);
    expect(player.engine.getState().phase).toBe("error");
    expect(player.engine.getState().lastError).toMatch(/reload.*before joining/i);
    player.engine.dismissError();
    await player.engine.createParty();
    expect(created).toBe(1);
    expect(player.engine.getState().phase).toBe("error");
    const fresh = makePlayer(world, "fresh");
    await runCreate(fresh, world);
    expect(created).toBe(2);
    await fresh.engine.leaveParty();
  });

  it("does not retry other structured errors", async () => {
    const world = makeWorld();
    const relay = failingRelay(world, "join_timeout");
    const player = makePlayer(world, "host");
    await player.engine.createParty();
    world.clock.advance(20_000);
    expect(relay.attempts()).toBe(1);
    expect(relay.listenerCount()).toBe(0);
    expect(player.engine.getState().phase).toBe("error");
  });
});

describe("party engine — signaling while waiting for a peer", () => {
  it("cancels peer discovery and unsubscribes while signaling is down", async () => {
    const world = makeWorld();
    const callbacks = new Set<(connected: boolean) => void>();
    world.factory.createPrivateTransport = (identity) => {
      const transport = world.hub.createTransport(identity);
      (
        transport as typeof transport & {
          onRelayStateChange: (cb: (connected: boolean) => void) => () => void;
        }
      ).onRelayStateChange = (cb) => {
        callbacks.add(cb);
        cb(true);
        return () => {
          callbacks.delete(cb);
        };
      };
      return transport;
    };
    const player = makePlayer(world, "joiner", { peerConnectTimeoutMs: 5_000 });
    const joining = player.engine.joinByInvite({ secret: "Q".repeat(43) });
    await settle(world);
    for (const callback of callbacks) callback(false);
    await player.engine.leaveParty();
    await joining;
    world.clock.advance(30_000);
    expect(callbacks.size).toBe(0);
    expect(player.engine.getState().phase).toBe("idle");
  });

  it("joins a peer after signaling recovers beyond the discovery deadline", async () => {
    const world = makeWorld();
    const callbacks = new Set<(connected: boolean) => void>();
    world.factory.createPrivateTransport = (identity) => {
      const transport = world.hub.createTransport(identity);
      (
        transport as typeof transport & {
          onRelayStateChange: (cb: (connected: boolean) => void) => () => void;
        }
      ).onRelayStateChange = (cb) => {
        callbacks.add(cb);
        cb(true);
        return () => {
          callbacks.delete(cb);
        };
      };
      return transport;
    };
    const secret = "R".repeat(43);
    const player = makePlayer(world, "joiner", { peerConnectTimeoutMs: 1_000 });
    const joining = player.engine.joinByInvite({ secret });
    await settle(world);
    expect(player.engine.getState().joinStage).toBe("connecting");
    for (const callback of callbacks) callback(false);
    world.clock.advance(10_000);
    await flush();
    expect(player.engine.getState().phase).toBe("joining");
    for (const callback of callbacks) callback(true);
    const peer = world.hub.createTransport({ memberId: "host", displayName: "Host" });
    const material = await mockDerive(secret);
    await peer.join({ room: material.roomId, sessionId: material.sessionId });
    await settle(world);
    await joining;
    expect(player.engine.getState().phase).toBe("lobby");
    await player.engine.leaveParty();
    await peer.leave();
    expect(callbacks.size).toBe(0);
  });

  it("honors cancellation while a peer-timeout teardown is in progress", async () => {
    const world = makeWorld();
    let finishLeave!: () => void;
    const barrier = new Promise<void>((resolve) => {
      finishLeave = resolve;
    });
    let creates = 0;
    world.factory.createPrivateTransport = (identity) => {
      const transport = world.hub.createTransport(identity);
      creates++;
      const leave = transport.leave.bind(transport);
      transport.leave = async () => {
        await barrier;
        await leave();
      };
      return transport;
    };
    const player = makePlayer(world, "joiner", { peerConnectTimeoutMs: 1_000 });
    const joining = player.engine.joinByInvite({ secret: "S".repeat(43) });
    await settle(world);
    world.clock.advance(1_000);
    await flush();
    const cancel = player.engine.leaveParty();
    finishLeave();
    await cancel;
    await joining;
    player.engine.retrySetup();
    await flush();
    expect(creates).toBe(1);
    expect(player.engine.getState().phase).toBe("idle");
  });

  it("pauses the healthy signaling deadline during an outage and resumes it on recovery", async () => {
    const world = makeWorld();
    const callbacks = new Set<(connected: boolean) => void>();
    const notify = (connected: boolean) => {
      for (const callback of callbacks) callback(connected);
    };
    world.factory.createPrivateTransport = (identity) => {
      const transport = world.hub.createTransport(identity);
      (
        transport as typeof transport & {
          onRelayStateChange: (cb: (connected: boolean) => void) => () => void;
        }
      ).onRelayStateChange = (cb) => {
        callbacks.add(cb);
        cb(true);
        return () => {
          callbacks.delete(cb);
        };
      };
      return transport;
    };
    const player = makePlayer(world, "joiner", { peerConnectTimeoutMs: 5_000 });
    const joining = player.engine.joinByInvite({ secret: "P".repeat(43) });
    await settle(world);
    expect(player.engine.getState().joinStage).toBe("connecting");
    world.clock.advance(2_000);
    notify(false);
    world.clock.advance(20_000);
    await flush();
    expect(player.engine.getState().phase).toBe("joining");
    expect(player.engine.getState().signalingOutage).toBe(true);
    notify(true);
    expect(player.engine.getState().signalingOutage).toBe(false);
    world.clock.advance(2_999);
    await flush();
    expect(player.engine.getState().phase).toBe("joining");
    world.clock.advance(1);
    await settle(world);
    await joining;
    expect(player.engine.getState().phase).toBe("error");
    expect(player.engine.getState().lastError).toMatch(/couldn't reach anyone/i);
    expect(callbacks.size).toBe(0);
  });
});

describe("party engine — relay diagnostics surfacing (rocketcrab-ont.1)", () => {
  /** A Trystero-shaped diagnostics snapshot (duck-typed by the engine). */
  function makeRelaySnapshot() {
    return {
      connectionState: "connected",
      selfConnectionId: "conn-a",
      room: "room-1",
      sessionId: "session-1",
      signalingConnected: true,
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
    expect(diagnostics?.signalingConnected).toBe(true);
  });

  it("surfaces disconnected signaling", async () => {
    const world = makeWorld();
    const snapshot = makeRelaySnapshot();
    snapshot.signalingConnected = false;
    const player = makePlayer(world, "host", { diagnostics: () => snapshot });
    await runCreate(player, world);
    expect(player.engine.getState().diagnostics?.signalingConnected).toBe(false);
  });

  it("uses the injected diagnostics provider when present (test/dev path)", async () => {
    const world = makeWorld();
    const snapshot = makeRelaySnapshot();
    const player = makePlayer(world, "host", {
      diagnostics: () => snapshot,
    });
    await runCreate(player, world);

    const diagnostics = player.engine.getState().diagnostics;
    expect(diagnostics?.signalingConnected).toBe(true);
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
    expect(player.engine.getState().diagnostics?.signalingConnected).toBe(true);
    snapshot.signalingConnected = false;
    const seen: Array<boolean | null> = [];
    player.engine.onState((state) => {
      seen.push(state.diagnostics?.signalingConnected ?? null);
    });
    (relayHandler as (() => void) | null)?.();
    expect(seen.at(-1)).toBe(false);
    expect(player.engine.getState().diagnostics?.signalingConnected).toBe(false);
  });
});

describe("party engine — peer-link alert (PLAN.md §7 stages 2 and 4)", () => {
  afterEach(() => {
    transportFactoryMocks.createTrysteroPartyTransportFactory.mockReset();
  });

  /** A player on the DEFAULT factory path, so the engine's tunnel hooks are captured. */
  function makeDefaultFactoryPlayer(
    world: World,
    overrides: ConstructorParameters<typeof PartyEngine>[0] = {},
  ): Player {
    transportFactoryMocks.createTrysteroPartyTransportFactory.mockReturnValue(world.factory);
    return makePlayer(world, "host", { transportFactory: undefined, ...overrides });
  }

  /** The tunnel hooks the engine handed to the default transport factory. */
  function capturedHooks(): {
    onTunnel: (info: { reason: "timeout" | "native-failed"; elapsedMs: number }) => void;
    onTunnelFailure: (info: { reason: "socket-closed"; closeCode: number }) => void;
  } {
    const options = transportFactoryMocks.createTrysteroPartyTransportFactory.mock.calls[0]?.[0];
    if (options === undefined) throw new Error("the default factory was not called");
    return options;
  }

  const SWITCH = { reason: "timeout" as const, elapsedMs: 8_000 };
  const FAILURE = { reason: "socket-closed" as const, closeCode: 4011 };

  it("coalesces simultaneous switches into one alert and clears it when a peer joins", async () => {
    const world = makeWorld();
    const host = makeDefaultFactoryPlayer(world);
    const secret = await runCreate(host, world);
    const hooks = capturedHooks();
    const seen: PeerLinkStatus[] = [];
    const stop = host.engine.onState((state) => seen.push(state.peerLink));

    hooks.onTunnel(SWITCH);
    hooks.onTunnel(SWITCH);
    hooks.onTunnel({ reason: "native-failed", elapsedMs: 0 });
    expect(host.engine.getState().peerLink).toBe("connecting");
    expect(new Set(seen)).toEqual(new Set([null, "connecting"]));
    expect(seen).toEqual([null, "connecting", "connecting", "connecting"]);

    const joiner = makePlayer(world, "joiner");
    const joining = joiner.engine.joinByInvite({ secret });
    await settle(world);
    await joining;
    expect(host.engine.getState().peerLink).toBeNull();
    expect(seen.at(-1)).toBeNull();
    stop();
  });

  it("emits diagnostics on a switch even while a failure is showing", async () => {
    const world = makeWorld();
    const host = makeDefaultFactoryPlayer(world);
    await runCreate(host, world);
    const hooks = capturedHooks();
    hooks.onTunnelFailure(FAILURE);
    const seen: PeerLinkStatus[] = [];
    const stop = host.engine.onState((state) => seen.push(state.peerLink));
    hooks.onTunnel(SWITCH);
    expect(seen).toEqual(["failed", "failed"]);
    expect(host.engine.getState().peerLink).toBe("failed");
    stop();
  });

  it("expires a switch that closes quietly, and a later switch restarts the window", async () => {
    const world = makeWorld();
    const host = makeDefaultFactoryPlayer(world);
    await runCreate(host, world);
    const hooks = capturedHooks();

    hooks.onTunnel(SWITCH);
    world.clock.advance(20_000);
    hooks.onTunnel(SWITCH); // restarts the 30 s window: now expires at +50 s
    world.clock.advance(20_000); // +40 s: the first window would already have ended
    expect(host.engine.getState().peerLink).toBe("connecting");
    world.clock.advance(10_000); // +50 s
    expect(host.engine.getState().peerLink).toBeNull();
  });

  it("turns a terminal tunnel failure into one alert that stays until the user retries", async () => {
    const world = makeWorld();
    const host = makeDefaultFactoryPlayer(world);
    await runCreate(host, world);
    const hooks = capturedHooks();
    const seen: PeerLinkStatus[] = [];
    const stop = host.engine.onState((state) => seen.push(state.peerLink));

    hooks.onTunnel(SWITCH);
    hooks.onTunnelFailure(FAILURE);
    hooks.onTunnelFailure(FAILURE);
    hooks.onTunnel(SWITCH);
    expect(host.engine.getState().peerLink).toBe("failed");
    world.clock.advance(60_000);
    expect(host.engine.getState().peerLink).toBe("failed");
    expect(seen).toEqual([null, "connecting", "failed", "failed"]);
    stop();

    void host.engine.reconnect();
    expect(host.engine.getState().peerLink).toBeNull();
    await settle(world);
    expect(host.engine.getState().phase).toBe("lobby");
  });

  it("an admitted peer clears a failure alert, since Trystero re-attempts the failed pair", async () => {
    const world = makeWorld();
    const host = makeDefaultFactoryPlayer(world);
    const secret = await runCreate(host, world);
    const hooks = capturedHooks();
    hooks.onTunnel(SWITCH);
    hooks.onTunnelFailure(FAILURE);
    expect(host.engine.getState().peerLink).toBe("failed");

    const joiner = makePlayer(world, "joiner");
    const joining = joiner.engine.joinByInvite({ secret });
    await settle(world);
    await joining;
    expect(host.engine.getState().peerLink).toBeNull();
  });

  it("a tunnel failure during joining still ends in the join-timeout screen, with no stale alert", async () => {
    const world = makeWorld();
    const joiner = makeDefaultFactoryPlayer(world, { peerConnectTimeoutMs: 1_000 });
    const joining = joiner.engine.joinByInvite({ secret: "F".repeat(43) });
    await settle(world);
    const hooks = capturedHooks();
    hooks.onTunnel(SWITCH);
    hooks.onTunnelFailure(FAILURE);
    expect(joiner.engine.getState().phase).toBe("joining");
    expect(joiner.engine.getState().peerLink).toBe("failed");
    world.clock.advance(1_000);
    await settle(world);
    await joining;
    const state = joiner.engine.getState();
    expect(state.phase).toBe("error");
    expect(state.lastError).toMatch(/couldn't reach anyone/i);
    expect(state.peerLink).toBeNull();
  });

  it("a silent native drop gets one info notice, and a rejoin clears it", async () => {
    const world = makeWorld();
    const host = makePlayer(world, "host");
    const secret = await runCreate(host, world);
    const joiner = makePlayer(world, "joiner");
    const joining = joiner.engine.joinByInvite({ secret });
    await settle(world);
    await joining;

    await joiner.engine.leaveParty();
    await settle(world);
    const left = host.engine
      .getState()
      .notices.filter((notice) => notice.message === "Player joiner left the party.");
    expect(left).toHaveLength(1);
    expect(left[0]?.level).toBe("info");

    const rejoining = joiner.engine.joinByInvite({ secret });
    await settle(world);
    await rejoining;
    expect(
      host.engine.getState().notices.some((notice) => /left the party/.test(notice.message)),
    ).toBe(false);
  });

  it("a member removed by a kick is announced as removed, not as having left", async () => {
    const world = makeWorld();
    const host = makePlayer(world, "host");
    const secret = await runCreate(host, world);
    const joiner = makePlayer(world, "joiner");
    const joining = joiner.engine.joinByInvite({ secret });
    await settle(world);
    await joining;

    host.engine.kickMember(joiner.memberId);
    await settle(world);
    const messages = host.engine.getState().notices.map((notice) => notice.message);
    expect(messages).toContain("Player joiner was removed from the party.");
    expect(messages.some((message) => /left the party/.test(message))).toBe(false);
  });

  it("ignores tunnel callbacks from a party that has been left", async () => {
    const world = makeWorld();
    const host = makeDefaultFactoryPlayer(world);
    await runCreate(host, world);
    const hooks = capturedHooks();

    await host.engine.leaveParty();
    hooks.onTunnel(SWITCH);
    hooks.onTunnelFailure(FAILURE);
    expect(host.engine.getState().peerLink).toBeNull();
    expect(host.engine.getState().phase).toBe("idle");
  });

  it("shows no peer-link alert for a healthy native pair", async () => {
    const world = makeWorld();
    const host = makePlayer(world, "host");
    const secret = await runCreate(host, world);
    const joiner = makePlayer(world, "joiner");
    const joining = joiner.engine.joinByInvite({ secret });
    await settle(world);
    await joining;

    expect(host.engine.getState().peerLink).toBeNull();
    expect(joiner.engine.getState().peerLink).toBeNull();
    expect(joiner.engine.getState().phase).toBe("lobby");
    expect(host.engine.getState().notices.some((notice) => /connect/i.test(notice.message))).toBe(
      false,
    );
  });
});

describe("party engine — §10 review: lifecycle cleanup", () => {
  it("re-arms a reconnect on resume when hiding cancelled the retry and the room is idle", async () => {
    const world = makeWorld();
    const lifecycle = createMemoryLifecycleSource();
    const a = makePlayer(world, "a", { lifecycle: lifecycle.source });
    await runCreate(a, world);
    const privateTransport = world.transports.find((t) => t.selfMemberId === a.memberId)!;

    await privateTransport.suspend();
    await settle(world);
    expect(a.engine.getState().phase).toBe("reconnecting");

    // The page is hidden while the retry is pending, and a failed reconnect
    // attempt leaves the room idle (trystero-transport: a failed joinRoom sets
    // "idle"). Hiding cancelled the retry timer, so nothing is scheduled.
    lifecycle.hide();
    await privateTransport.leave();
    privateTransport.connectionState = "idle";
    await settle(world);
    lifecycle.show();
    await settle(world);

    // Nothing else will retry: the resume probe must re-decide.
    world.clock.advance(60_000);
    await settle(world);
    expect(a.engine.getState().phase).toBe("lobby");
  });

  it("a superseded frame load that fails does not clobber the frame that replaced it", async () => {
    const world = makeWorld();
    const harness = createHostHarness();
    // Frame loads stay pending until the test rejects them, like a load whose
    // iframe was detached by a container rebind and is waiting for a timeout.
    const pendingLoads: Array<(error: Error) => void> = [];
    const a = makePlayer(world, "a", {
      seams: {
        ...harness.seams,
        waitForFrameLoad: () =>
          new Promise<void>((_, reject) => {
            pendingLoads.push(reject);
          }),
      },
    });
    await runCreate(a, world);
    expect(pendingLoads).toHaveLength(1);

    a.engine.setContainer(document.createElement("div"));
    expect(pendingLoads).toHaveLength(2);
    expect(a.engine.debugSnapshot().frameExists).toBe(true);

    pendingLoads[0]!(new Error("Runtime iframe load timed out."));
    await settle(world);
    expect(a.engine.debugSnapshot().frameExists).toBe(true);
    expect(a.engine.getState().notices.some((n) => /could not start/i.test(n.message))).toBe(false);
  });

  it("selectGame does not keep the previous game's verification when the new source fails to register", async () => {
    const world = makeWorld();
    const a = makePlayer(world, "a");
    const b = makePlayer(world, "b");
    const code = await runCreate(a, world);
    await registerLocalGame(a, world);
    const { join, settled } = startJoin(b, world, code);
    await settled;
    await settle(world);
    await join;
    await settle(world);
    await registerLocalGame(b, world);
    await settle(world);
    expect(a.engine.getState().canStart).toBe(true);

    const setSource = vi
      .spyOn(GameSourceCoordinator.prototype, "setSource")
      .mockRejectedValueOnce(new Error("source rejected"));
    await a.engine.selectGame({
      gameId: "game_other",
      title: "Other",
      mode: "state",
      source: "<html>other</html>",
    });
    await settle(world);
    expect(setSource).toHaveBeenCalledTimes(1);
    setSource.mockRestore();

    expect(a.engine.getState().canForceStart).toBe(false);
    expect(a.engine.getState().canStart).toBe(false);
  });

  it("a setup that fails after the room joined leaves that room, so the player can retry", async () => {
    const world = makeWorld();
    let failNext = true;
    const factory: PartyTransportFactory = {
      createPrivateTransport: (identity) => {
        const transport = world.hub.createTransport(identity);
        world.transports.push(transport);
        if (failNext) {
          // The first setup cannot subscribe to the room's connection state.
          failNext = false;
          const on = transport.on.bind(transport) as (...args: unknown[]) => unknown;
          (transport as unknown as { on: unknown }).on = (event: string, ...rest: unknown[]) => {
            if (event === "connection:state") throw new Error("subscribe failed");
            return on(event, ...rest);
          };
        }
        return transport;
      },
    };
    const player = makePlayer(world, "a", { transportFactory: factory });
    const failed = player.engine.createParty(GAME);
    for (let i = 0; i < 8; i += 1) {
      await flush();
      world.clock.advance(1_000);
    }
    await settle(world);
    await failed;
    expect(player.engine.getState().phase).toBe("error");
    expect(world.transports[0]!.connectionState).not.toBe("connected");

    player.engine.dismissError();
    const retry = player.engine.createParty(GAME);
    for (let i = 0; i < 8; i += 1) {
      await flush();
      world.clock.advance(1_000);
    }
    await settle(world);
    await retry;
    expect(player.engine.getState().phase).toBe("lobby");
  });

  it("a classic game whose room finishes creating after the party is left does not reach the next party", async () => {
    const world = makeWorld();
    const a = makePlayer(world, "a");
    await runCreate(a, world);
    const classic = CLASSIC_GAMES[0]!;
    let finishConnect!: (result: ClassicGameConnectResult) => void;
    const connect = vi.spyOn(classic, "connectToGame").mockImplementation(
      () =>
        new Promise<ClassicGameConnectResult>((resolve) => {
          finishConnect = resolve;
        }),
    );

    const pick = a.engine.selectClassicGame(classic.id);
    await a.engine.leaveParty();
    finishConnect({ player: { url: "https://classic.example/player" } });
    await pick;
    await settle(world);
    connect.mockRestore();

    expect(a.engine.getState().classicGame).toBeNull();
    expect(a.engine.getState().game).toBeNull();
    expect(a.engine.getState().notices.some((n) => n.level === "error")).toBe(false);
  });

  it("does not boot a game frame when the container is rebound while the party is being left", async () => {
    const world = makeWorld();
    const a = makePlayer(world, "a");
    await runCreate(a, world);
    const createChannel = vi.fn(a.harness.seams.createChannel!);
    a.harness.seams.createChannel = createChannel;

    const leaving = a.engine.leaveParty();
    a.engine.setContainer(document.createElement("div"));
    await leaving;
    await settle(world);

    expect(createChannel).not.toHaveBeenCalled();
    expect(a.engine.debugSnapshot().frameExists).toBe(false);
  });

  it("a holds report for a superseded source hash does not mark the member complete", async () => {
    const world = makeWorld();
    const a = makePlayer(world, "a");
    const b = makePlayer(world, "b");
    const code = await runCreate(a, world);
    await registerLocalGame(a, world);
    const { join, settled } = startJoin(b, world, code);
    await settled;
    await settle(world);
    await join;
    await settle(world);
    await registerLocalGame(b, world);
    await settle(world);
    expect(memberOf(b.engine.getState(), a.memberId).transferState).toBe("complete");

    const coordinatorEvent = (event: unknown) =>
      (b.engine as unknown as { handleCoordinatorEvent(e: unknown): void }).handleCoordinatorEvent(
        event,
      );
    coordinatorEvent({
      type: "metadata",
      metadata: {
        gameId: GAME.gameId,
        title: GAME.title,
        mode: GAME.mode,
        sourceSha256: "edited-hash",
        sourceSizeBytes: 9,
      },
      fromMemberId: a.memberId,
    });
    expect(memberOf(b.engine.getState(), a.memberId).transferState).toBe("waiting");

    coordinatorEvent({
      type: "holds",
      memberId: a.memberId,
      gameId: GAME.gameId,
      sourceSha256: "stale-hash",
    });
    // A waiting row is what makes the lobby re-request the source; a complete
    // row with a blocked start would never be asked again.
    expect(memberOf(b.engine.getState(), a.memberId).transferState).toBe("waiting");
    expect(b.engine.getState().canStart).toBe(false);
  });

  it("clears the game's console logs when the party is left", async () => {
    const world = makeWorld();
    const a = makePlayer(world, "a");
    await runCreate(a, world);
    (a.engine as unknown as { handleHostEvent(e: unknown): void }).handleHostEvent({
      type: "console",
      message: { level: "log", message: "from the first party" },
    });
    expect(a.engine.getState().runtimeLogs).toHaveLength(1);

    await a.engine.leaveParty();
    expect(a.engine.getState().runtimeLogs).toHaveLength(0);
  });

  it("a joiner whose setup fails after admission leaves the room without ending the host's party", async () => {
    const world = makeWorld();
    let failJoiner = false;
    const factory: PartyTransportFactory = {
      createPrivateTransport: (identity) => {
        const transport = world.hub.createTransport(identity);
        world.transports.push(transport);
        if (failJoiner) {
          // The joiner cannot subscribe to the room's connection state, after the host has admitted it.
          failJoiner = false;
          const on = transport.on.bind(transport) as (...args: unknown[]) => unknown;
          (transport as unknown as { on: unknown }).on = (event: string, ...rest: unknown[]) => {
            if (event === "connection:state") throw new Error("subscribe failed");
            return on(event, ...rest);
          };
        }
        return transport;
      },
    };
    const host = makePlayer(world, "host");
    const code = await runCreate(host, world);
    const joiner = makePlayer(world, "joiner", { transportFactory: factory });
    failJoiner = true;
    const joining = joiner.engine.joinByInvite({ secret: code });
    await settle(world);
    await joining;
    await settle(world);

    expect(joiner.engine.getState().phase).toBe("error");
    const joinerRoom = world.transports.find((t) => t.selfMemberId === joiner.memberId)!;
    expect(joinerRoom.connectionState).not.toBe("connected");

    expect(host.engine.getState().phase).toBe("lobby");
    expect(host.engine.isActive()).toBe(true);
    expect(host.engine.getState().members.map((m) => m.memberId)).not.toContain(joiner.memberId);
  });

  it("a failed reconnect attempt keeps the party active, not torn down", async () => {
    const world = makeWorld();
    const a = makePlayer(world, "a");
    await runCreate(a, world);
    const privateTransport = world.transports.find((t) => t.selfMemberId === a.memberId)!;
    vi.spyOn(privateTransport, "reconnect").mockRejectedValueOnce(new Error("relay unreachable"));

    await a.engine.reconnect();
    await settle(world);

    expect(a.engine.getState().phase).toBe("reconnecting");
    expect(a.engine.isActive()).toBe(true);
    expect(a.engine.getState().members.map((m) => m.memberId)).toContain(a.memberId);
    expect(privateTransport.connectionState).toBe("connected");
  });
});
