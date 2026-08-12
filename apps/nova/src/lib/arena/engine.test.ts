/**
 * Arena engine integration tests (U6): several simulated players, each a
 * real runtime frame driven through the U3 bridge seams, wired to their own
 * NovaSession over the InMemoryTransport. The fake host mirrors
 * EditorPage.test.tsx: fresh channels per load, ready/registration/apiCall/
 * console/error deliveries, and assertions on the validated messages the
 * engine pushes back (game.apiEvent). No DOM-free shortcuts: the runtime
 * protocol is exercised end to end.
 */
import type { GameApiEvent } from "@rocketcrab/protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChannelPort } from "../runtime-host";
import { ArenaEngine, type ArenaEngineOptions, type ArenaSeams } from "./engine";
import type { ArenaPlayerSpec, ArenaRunOutcome, ArenaState } from "./types";

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

interface FakeChannel {
  port1: FakePort;
  port2: FakePort;
}

interface ArenaHarness {
  seams: ArenaSeams;
  channels: FakeChannel[];
  frames: HTMLIFrameElement[];
  windowMessages: Array<{ data: unknown }>;
  containers: Map<string, HTMLDivElement>;
  outcomes: ArenaRunOutcome[];
}

function createHarness(): ArenaHarness {
  const channels: FakeChannel[] = [];
  const frames: HTMLIFrameElement[] = [];
  const windowMessages: ArenaHarness["windowMessages"] = [];
  const containers = new Map<string, HTMLDivElement>();
  return {
    seams: {
      createChannel() {
        const port1 = createFakePort();
        const port2 = createFakePort();
        channels.push({ port1, port2 });
        return { port1, port2 };
      },
      async waitForFrameLoad(iframe) {
        frames.push(iframe);
        iframe.contentWindow?.addEventListener("message", (event: MessageEvent) => {
          windowMessages.push({ data: event.data });
        });
      },
    },
    channels,
    frames,
    windowMessages,
    containers,
    outcomes: [],
  };
}

const SOURCE =
  "<!doctype html><html><head><title>Rocket Rumble</title></head><body><p>rockets</p></body></html>";
const REPLACED_SOURCE =
  "<!doctype html><html><head><title>Card Sharks</title></head><body><p>cards</p></body></html>";

function playerSpecs(count: number): ArenaPlayerSpec[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `player-${index + 1}`,
    name: `Player ${index + 1}`,
    memberId: `member-${index + 1}`,
  }));
}

function createEngine(
  harness: ArenaHarness,
  options: Partial<ArenaEngineOptions> = {},
): ArenaEngine {
  const engine = new ArenaEngine({
    source: SOURCE,
    gameId: "game-1",
    gameMode: "state",
    gameTitle: "Rocket Rumble",
    runtimeOrigin: "http://localhost:5174",
    initialPlayers: playerSpecs(2),
    getContainer: (id) => harness.containers.get(id) ?? null,
    seams: harness.seams,
    onState: () => undefined,
    onRunSucceeded: (outcome) => harness.outcomes.push(outcome),
    ...options,
  });
  return engine;
}

function mountContainers(harness: ArenaHarness, count: number): void {
  for (let index = 0; index < count; index += 1) {
    const div = document.createElement("div");
    div.setAttribute("data-player", `player-${index + 1}`);
    document.body.appendChild(div);
    harness.containers.set(`player-${index + 1}`, div);
  }
}

function readyMessage(): Record<string, unknown> {
  return {
    version: 1,
    runtimeInstanceId: "runtime-1",
    messageId: "message-ready",
    sentAt: 1_700_000_000_000,
    type: "runtime.ready",
    status: "ready",
  };
}

function registrationMessage(title: string, gameMode = "state"): Record<string, unknown> {
  return {
    version: 1,
    runtimeInstanceId: "runtime-1",
    messageId: "message-reg",
    sentAt: 1_700_000_000_001,
    type: "game.registration",
    gameId: "game-1",
    title,
    gameMode,
  };
}

function apiCallMessage(method: string, payload: unknown): Record<string, unknown> {
  return {
    version: 1,
    runtimeInstanceId: "runtime-1",
    messageId: `message-${method}`,
    sentAt: 1_700_000_000_002,
    type: "game.apiCall",
    method,
    payload,
  };
}

function runtimeErrorMessage(category: string, message: string): Record<string, unknown> {
  return {
    version: 1,
    runtimeInstanceId: "runtime-1",
    messageId: "message-error",
    sentAt: 1_700_000_000_003,
    type: "runtime.error",
    category,
    message,
  };
}

/** apiEvent messages pushed to one player's client (in order). */
function apiEventsOf(harness: ArenaHarness, playerIndex: number): GameApiEvent[] {
  return (
    harness.channels[playerIndex]?.port1.sent
      .filter((message) => (message as { type?: string }).type === "game.apiEvent")
      .map((message) => (message as { event: GameApiEvent }).event) ?? []
  );
}

/** Ready every player's runtime frame in load order (baseline = existing channels). */
async function readyAll(
  engine: ArenaEngine,
  harness: ArenaHarness,
  count: number,
  baseline = 0,
): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    await vi.waitFor(() => expect(harness.channels.length).toBe(baseline + index + 1));
    deliver(harness.channels[baseline + index]!.port1, readyMessage());
  }
  await vi.waitFor(() =>
    expect(engine.getSnapshot().players.every((player) => player.runState === "running")).toBe(
      true,
    ),
  );
}

/** Full happy path: register + ready every player and wait for game start. */
async function runToStart(
  engine: ArenaEngine,
  harness: ArenaHarness,
  count: number,
  baseline = 0,
): Promise<void> {
  await readyAll(engine, harness, count, baseline);
  for (let index = 0; index < count; index += 1) {
    deliver(harness.channels[baseline + index]!.port1, registrationMessage(`Game ${index + 1}`));
  }
  for (let index = 0; index < count; index += 1) {
    deliver(harness.channels[baseline + index]!.port1, apiCallMessage("ready", {}));
  }
  await vi.waitFor(() => {
    const snapshot = engine.getSnapshot();
    expect(snapshot.players.every((player) => player.runState === "started")).toBe(true);
  });
}

beforeEach(() => {
  document.body.innerHTML = "";
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("ArenaEngine — happy path", () => {
  it("runs two simulated players to game start with distinct identities", async () => {
    const harness = createHarness();
    mountContainers(harness, 2);
    const engine = createEngine(harness);
    engine.start();
    await runToStart(engine, harness, 2);

    const snapshot = engine.getSnapshot();
    expect(snapshot.players).toHaveLength(2);
    expect(snapshot.players.map((player) => player.memberId)).toEqual(["member-1", "member-2"]);
    expect(snapshot.players.every((player) => player.runState === "started")).toBe(true);
    expect(snapshot.players.every((player) => player.sessionStatus === "connected")).toBe(true);
    expect(snapshot.summary).toMatchObject({
      total: 2,
      registered: 2,
      started: 2,
      failed: 0,
      success: true,
    });
    // One success outcome per run.
    expect(harness.outcomes).toHaveLength(1);
    expect(harness.outcomes[0]).toMatchObject({ runId: 1, source: SOURCE });

    // Player 2's frame observed player 1 joining, the connection settling,
    // and the game starting — all as validated apiEvent messages.
    const events = apiEventsOf(harness, 1);
    expect(events).toContainEqual({
      kind: "playerJoined",
      player: { id: "member-1", name: "Player 1" },
    });
    expect(events).toContainEqual({ kind: "start" });
    expect(
      events.some((event) => event.kind === "connection" && event.status === "connected"),
    ).toBe(true);
    // The bootstrap carried each player's own distinct identity.
    const bootstraps = harness.windowMessages
      .map((message) => message.data as Record<string, unknown>)
      .filter((message) => message.type === "runtime.bootstrap");
    expect(bootstraps).toHaveLength(2);
    expect(bootstraps[0]?.player).toEqual({ memberId: "member-1", displayName: "Player 1" });
    expect(bootstraps[1]?.player).toEqual({ memberId: "member-2", displayName: "Player 2" });
    expect(bootstraps.every((bootstrap) => bootstrap.sessionId === snapshot.sessionId)).toBe(true);
  });

  it("runs six simulated players on one page (acceptance: >= 6)", async () => {
    const harness = createHarness();
    mountContainers(harness, 6);
    const engine = createEngine(harness, { initialPlayers: playerSpecs(6) });
    engine.start();
    await runToStart(engine, harness, 6);

    const snapshot = engine.getSnapshot();
    expect(snapshot.players).toHaveLength(6);
    expect(snapshot.players.every((player) => player.runState === "started")).toBe(true);
    expect(snapshot.summary.success).toBe(true);
    // Every frame received every other player (join order, distinct ids).
    const memberIds = snapshot.players.map((player) => player.memberId);
    expect(new Set(memberIds).size).toBe(6);
    for (let index = 0; index < 6; index += 1) {
      const joined = apiEventsOf(harness, index).filter((event) => event.kind === "playerJoined");
      expect(joined.map((event) => (event as { player: { id: string } }).player.id)).toEqual(
        memberIds.filter((id) => id !== memberIds[index]),
      );
    }
  });

  it("routes raw channel messages between players", async () => {
    const harness = createHarness();
    mountContainers(harness, 2);
    const engine = createEngine(harness);
    engine.start();
    await runToStart(engine, harness, 2);

    // Player 1 declares a raw channel and broadcasts on it.
    deliver(
      harness.channels[0]!.port1,
      apiCallMessage("raw.createChannel", { spec: { name: "chat" } }),
    );
    deliver(
      harness.channels[0]!.port1,
      apiCallMessage("raw.send", { name: "chat", payload: { text: "hi" } }),
    );
    await vi.waitFor(() => {
      const events = apiEventsOf(harness, 1);
      expect(
        events.some(
          (event) =>
            event.kind === "rawMessage" &&
            event.channel === "chat" &&
            (event.message.payload as { text?: string }).text === "hi",
        ),
      ).toBe(true);
    });
    const raw = apiEventsOf(harness, 1).find((event) => event.kind === "rawMessage");
    expect(raw?.kind === "rawMessage" ? raw.message.from : null).toEqual({
      id: "member-1",
      name: "Player 1",
    });
  });
});

describe("ArenaEngine — network controls", () => {
  async function started(): Promise<{ harness: ArenaHarness; engine: ArenaEngine }> {
    const harness = createHarness();
    mountContainers(harness, 2);
    const engine = createEngine(harness);
    engine.start();
    await runToStart(engine, harness, 2);
    return { harness, engine };
  }

  it("disconnect makes the player leave and reconnect rejoins", async () => {
    const { harness, engine } = await started();
    await engine.disconnectPlayer("player-1");
    expect(engine.getSnapshot().players[0]?.sessionStatus).toBe("disconnected");
    // Player 2's frame observed the leave.
    await vi.waitFor(() =>
      expect(apiEventsOf(harness, 1)).toContainEqual({
        kind: "playerLeft",
        player: { id: "member-1", name: "Player 1" },
      }),
    );

    await engine.reconnectPlayer("player-1");
    expect(engine.getSnapshot().players[0]?.sessionStatus).toBe("connected");
    await vi.waitFor(() =>
      expect(apiEventsOf(harness, 1)).toContainEqual({
        kind: "playerJoined",
        player: { id: "member-1", name: "Player 1" },
      }),
    );
  });

  it("suspend and resume reflect the simulated background suspension", async () => {
    const { harness, engine } = await started();
    await engine.suspendPlayer("player-2");
    expect(engine.getSnapshot().players[1]?.sessionStatus).toBe("suspended");
    await vi.waitFor(() =>
      expect(apiEventsOf(harness, 0)).toContainEqual({
        kind: "playerLeft",
        player: { id: "member-2", name: "Player 2" },
      }),
    );

    await engine.resumePlayer("player-2");
    expect(engine.getSnapshot().players[1]?.sessionStatus).toBe("connected");
    await vi.waitFor(() =>
      expect(apiEventsOf(harness, 0)).toContainEqual({
        kind: "playerJoined",
        player: { id: "member-2", name: "Player 2" },
      }),
    );
  });

  it("authority loss forces the authority player to drop and rejoin", async () => {
    const { harness, engine } = await started();
    expect(engine.getSnapshot().authorityPlayerId).toBe("player-1");
    const before = engine.getSnapshot().players[0]!.memberId;

    await engine.triggerAuthorityLoss();
    // The authority player's connection was re-established with a fresh id.
    await vi.waitFor(() => {
      const player = engine.getSnapshot().players[0]!;
      expect(player.sessionStatus).toBe("connected");
      expect(player.memberId).toBe(before);
    });
    // Peers observed the loss: leave (old connection) then join (new one).
    const events = apiEventsOf(harness, 1);
    const left = events.filter((event) => event.kind === "playerLeft");
    const joined = events.filter((event) => event.kind === "playerJoined");
    expect(left.length).toBeGreaterThanOrEqual(1);
    expect(joined.length).toBeGreaterThanOrEqual(1);
    expect(engine.getSnapshot().summary.success).toBe(true);
  });

  it("applies shared latency and drop-message settings", async () => {
    const { engine } = await started();
    engine.setLatency(250);
    expect(engine.getSnapshot().latencyMs).toBe(250);
    engine.setDropMessages(true);
    expect(engine.getSnapshot().dropMessages).toBe(true);
    engine.setLatency(-10);
    expect(engine.getSnapshot().latencyMs).toBe(0);
    engine.setDropMessages(false);
    expect(engine.getSnapshot().dropMessages).toBe(false);
  });

  it("clear logs empties every player's log panel", async () => {
    const { engine } = await started();
    expect(engine.getSnapshot().players[0]!.logs.length).toBeGreaterThan(0);
    engine.clearLogs();
    expect(engine.getSnapshot().players.every((player) => player.logs.length === 0)).toBe(true);
  });
});

describe("ArenaEngine — player management", () => {
  it("adds, renames, and removes players with distinct identities", async () => {
    const harness = createHarness();
    mountContainers(harness, 2);
    const engine = createEngine(harness);
    engine.start();
    await runToStart(engine, harness, 2);

    // Add a third player: it loads once its container is mounted.
    engine.addPlayer("Zoe");
    expect(engine.getSnapshot().players).toHaveLength(3);
    const third = document.createElement("div");
    document.body.appendChild(third);
    harness.containers.set("player-3", third);
    void engine.loadPending();
    await vi.waitFor(() => expect(harness.channels.length).toBe(3));
    // Registration may arrive before load() settles: the engine must never
    // downgrade a registered player back to "running" (regression test).
    deliver(harness.channels[2]!.port1, readyMessage());
    deliver(harness.channels[2]!.port1, registrationMessage("Game 3"));
    deliver(harness.channels[2]!.port1, apiCallMessage("ready", {}));
    await vi.waitFor(() => expect(engine.getSnapshot().players[2]?.runState).toBe("started"));
    expect(engine.getSnapshot().players[2]?.memberId).toBe("member-3");
    expect(engine.getSnapshot().summary.success).toBe(true);

    // Rename updates the arena and the player's own frame.
    engine.renamePlayer("player-1", "Alice");
    expect(engine.getSnapshot().players[0]?.name).toBe("Alice");
    expect(apiEventsOf(harness, 0)).toContainEqual({
      kind: "identity",
      player: { id: "member-1", name: "Alice" },
    });

    // Remove the third player: frame destroyed and identity gone.
    const thirdContainer = harness.containers.get("player-3");
    engine.removePlayer("player-3");
    expect(engine.getSnapshot().players.map((player) => player.id)).toEqual([
      "player-1",
      "player-2",
    ]);
    expect(thirdContainer?.querySelectorAll("iframe")).toHaveLength(0);
    expect(engine.getSnapshot().summary.success).toBe(true);
  });

  it("attributing runtime errors to the correct player", async () => {
    const harness = createHarness();
    mountContainers(harness, 2);
    const engine = createEngine(harness);
    engine.start();
    await runToStart(engine, harness, 2);

    deliver(
      harness.channels[1]!.port1,
      runtimeErrorMessage("syntax", "Unexpected token in player 2"),
    );
    await vi.waitFor(() =>
      expect(
        engine
          .getSnapshot()
          .players[1]?.logs.some((log) => log.message.includes("Unexpected token")),
      ).toBe(true),
    );
    // Player 1's logs never see player 2's error.
    expect(
      engine.getSnapshot().players[0]?.logs.some((log) => log.message.includes("Unexpected token")),
    ).toBe(false);
  });

  it("fatal runtime errors fail the test-result summary", async () => {
    const harness = createHarness();
    mountContainers(harness, 2);
    const engine = createEngine(harness);
    engine.start();
    await readyAll(engine, harness, 2);
    deliver(harness.channels[0]!.port1, registrationMessage("Game 1"));
    deliver(
      harness.channels[0]!.port1,
      runtimeErrorMessage("missing_registration", "Game did not register"),
    );
    deliver(harness.channels[1]!.port1, registrationMessage("Game 2"));
    deliver(harness.channels[1]!.port1, apiCallMessage("ready", {}));

    await vi.waitFor(() => {
      const snapshot = engine.getSnapshot();
      expect(snapshot.players[0]?.runState).toBe("failed");
      expect(snapshot.summary.failed).toBe(1);
      expect(snapshot.summary.success).toBe(false);
    });
    // Only a clean full run persists test results.
    expect(harness.outcomes).toHaveLength(0);
  });
});

describe("ArenaEngine — restart and source replacement", () => {
  it("restart all destroys every old runtime frame and reloads the same source", async () => {
    const harness = createHarness();
    mountContainers(harness, 2);
    const engine = createEngine(harness);
    engine.start();
    await runToStart(engine, harness, 2);

    const firstFrames = [...harness.frames];
    const firstChannels = harness.channels.length;
    engine.restartAll();
    expect(harness.outcomes).toHaveLength(1); // first run succeeded before the restart

    await runToStart(engine, harness, 2, firstChannels);
    // Fresh channels + bootstraps: every old runtime was destroyed.
    expect(harness.channels.length).toBe(firstChannels + 2);
    expect(harness.frames.length).toBe(firstFrames.length + 2);
    for (const frame of firstFrames) {
      expect(frame.isConnected).toBe(false);
    }
    expect(firstChannels).toBe(2);
    expect(harness.outcomes).toHaveLength(2);
    expect(harness.outcomes[1]?.runId).toBe(2);
    expect(harness.outcomes[1]?.source).toBe(SOURCE);
  });

  it("replacing the source destroys all old frames and reloads the new source", async () => {
    const harness = createHarness();
    mountContainers(harness, 2);
    const engine = createEngine(harness);
    engine.start();
    await runToStart(engine, harness, 2);

    const firstFrames = [...harness.frames];
    const bootstrapsBefore = harness.windowMessages.length;
    const channelsBefore = harness.channels.length;
    engine.replaceSource(REPLACED_SOURCE);
    await runToStart(engine, harness, 2, channelsBefore);

    const bootstraps = harness.windowMessages
      .map((message) => message.data as Record<string, unknown>)
      .filter((message) => message.type === "runtime.bootstrap");
    expect(bootstraps.length).toBe(bootstrapsBefore + 2);
    expect(bootstraps.at(-1)?.gameSource).toBe(REPLACED_SOURCE);
    for (const frame of firstFrames) {
      expect(frame.isConnected).toBe(false);
    }
    expect(harness.outcomes).toHaveLength(2);
    expect(harness.outcomes[1]?.source).toBe(REPLACED_SOURCE);
  });
});

describe("ArenaEngine — per-player state", () => {
  it("tracks connection state changes in the player snapshot", async () => {
    const harness = createHarness();
    mountContainers(harness, 2);
    const engine = createEngine(harness);
    const states: ArenaState[] = [];
    const spyEngine = new ArenaEngine({
      source: SOURCE,
      gameId: "game-1",
      gameMode: "state",
      runtimeOrigin: "http://localhost:5174",
      initialPlayers: playerSpecs(2),
      getContainer: (id) => harness.containers.get(id) ?? null,
      seams: harness.seams,
      onState: (state) => states.push(state),
      onRunSucceeded: (outcome) => harness.outcomes.push(outcome),
    });
    spyEngine.start();
    await runToStart(spyEngine, harness, 2);
    expect(states.length).toBeGreaterThan(0);
    // The last snapshot reflects the settled run.
    const last = states.at(-1)!;
    expect(last.players[0]?.connectionState).toBe("connected");
    expect(engine.getSnapshot().status).toBe("starting");
    engine.stop();
  });

  it("stop tears every runtime down", async () => {
    const harness = createHarness();
    mountContainers(harness, 2);
    const engine = createEngine(harness);
    engine.start();
    await runToStart(engine, harness, 2);
    engine.stop();
    expect(document.querySelectorAll("iframe")).toHaveLength(0);
    expect(engine.getSnapshot().status).toBe("stopped");
    expect(harness.channels.every((channel) => channel.port1.closed)).toBe(true);
  });
});
