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
import { ArenaEngine, type ArenaEngineOptions, type ArenaPlayerSpec } from "./engine";
import type { ArenaState } from "./types";
import {
  answerSimulationRequests,
  answerStateRequests,
  apiCallMessage,
  createHarness,
  deliver,
  mountContainer,
  readyAll,
  registrationMessage,
  readyMessage,
  runtimeErrorMessage,
  runToStart,
  type ArenaHarness,
} from "./test-harness";

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
    mountContainer(harness, `player-${index + 1}`);
  }
}

/** apiEvent messages pushed to one player's client (in order). */
function apiEventsOf(harness: ArenaHarness, playerIndex: number): GameApiEvent[] {
  return (
    harness.channels[playerIndex]?.port1.sent
      .filter((message) => (message as { type?: string }).type === "game.apiEvent")
      .map((message) => (message as { event: GameApiEvent }).event) ?? []
  );
}

/** Run two+ players to start through the fake host, then wait for start. */
async function runToStartWithEngine(
  engine: ArenaEngine,
  harness: ArenaHarness,
  count: number,
  baseline = 0,
): Promise<void> {
  await runToStart(harness.channels, count, baseline);
  await vi.waitFor(() => {
    // S2: the authority's frame must answer the engine's state requests
    // before the game can start (the fake frame answers immediately).
    answerStateRequests(harness.channels, count, baseline);
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
    await runToStartWithEngine(engine, harness, 2);

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

  it("runs a state-mode game: actions apply through the authority frame (S2)", async () => {
    const harness = createHarness();
    mountContainers(harness, 2);
    const engine = createEngine(harness);
    engine.start();
    await runToStart(harness.channels, 2);

    // The fake authority frame plays a real game: a shared deck where a
    // drawCard action pops one card for the actor.
    const gameState: { deck: string[]; hands: Record<string, string> } = {
      deck: ["ace", "king"],
      hands: {},
    };
    const answerGame = (): void => {
      for (let index = 0; index < 2; index += 1) {
        const port = harness.channels[index]!.port1;
        const requests = port.sent
          .filter((m) => (m as { type?: string }).type === "game.apiEvent")
          .map((m) => (m as { event: GameApiEvent }).event)
          .filter((event) => event.kind === "stateRequest");
        for (const request of requests) {
          if (request.request.kind === "applyAction") {
            const context = request.request.context as {
              actor?: { id?: string };
            } | null;
            const actor = context?.actor?.id;
            if (actor !== undefined && gameState.hands[actor] === undefined) {
              gameState.hands[actor] = gameState.deck.pop() ?? "";
            }
          }
          const viewers =
            request.request.kind === "computeView"
              ? [request.request.viewer]
              : request.request.viewers;
          const views: Record<string, unknown> = {};
          for (const viewer of viewers) {
            views[viewer.id] = {
              hand: gameState.hands[viewer.id],
              cardsLeft: gameState.deck.length,
            };
          }
          deliver(
            port,
            apiCallMessage("stateResponse", {
              requestId: request.requestId,
              result: { kind: "state", ok: true, state: gameState, views },
            }),
          );
        }
      }
    };

    await vi.waitFor(() => {
      answerGame();
      expect(engine.getSnapshot().players.every((p) => p.runState === "started")).toBe(true);
    });
    let snapshot = engine.getSnapshot();
    expect(snapshot.stateDiagnostics?.revision).toBe(1);
    expect(snapshot.stateDiagnostics?.stateSizeBytes).toBeGreaterThan(0);
    expect(snapshot.authorityPlayerId).toBe("player-1");

    // Player 1 dispatches drawCard; the authority frame applies it and the
    // engine publishes revision 2 with updated per-player views.
    deliver(
      harness.channels[0]!.port1,
      apiCallMessage("dispatch", {
        action: { type: "drawCard" },
        actionId: "action-arena-1",
      }),
    );
    await vi.waitFor(() => {
      answerGame();
      expect(engine.getSnapshot().stateDiagnostics?.revision).toBe(2);
    });
    snapshot = engine.getSnapshot();
    expect(snapshot.stateDiagnostics?.appliedCount).toBe(2); // initial + action

    // Player 1's frame saw the new view (its hand) and the accepted ack.
    const states0 = apiEventsOf(harness, 0).filter((event) => event.kind === "state");
    expect(states0.at(-1)).toEqual({
      kind: "state",
      state: { hand: "king", cardsLeft: 1 },
    });
    const acks0 = apiEventsOf(harness, 0).filter((event) => event.kind === "actionAck");
    expect(acks0).toContainEqual({
      kind: "actionAck",
      actionId: "action-arena-1",
      status: "accepted",
      revision: 2,
    });
    // Player 2's frame saw only its own view — never the full state.
    const states1 = apiEventsOf(harness, 1).filter((event) => event.kind === "state");
    expect(states1.at(-1)).toEqual({
      kind: "state",
      state: { hand: undefined, cardsLeft: 1 },
    });
  });

  it("runs six simulated players on one page (acceptance: >= 6)", async () => {
    const harness = createHarness();
    mountContainers(harness, 6);
    const engine = createEngine(harness, { initialPlayers: playerSpecs(6) });
    engine.start();
    await runToStartWithEngine(engine, harness, 6);

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
    await runToStartWithEngine(engine, harness, 2);

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

  it("routes raw channel close between players (A2)", async () => {
    const harness = createHarness();
    mountContainers(harness, 2);
    const engine = createEngine(harness);
    engine.start();
    await runToStartWithEngine(engine, harness, 2);

    // Player 1 declares and then closes a raw channel.
    deliver(
      harness.channels[0]!.port1,
      apiCallMessage("raw.createChannel", { spec: { name: "chat" } }),
    );
    deliver(harness.channels[0]!.port1, apiCallMessage("raw.close", { name: "chat" }));
    await vi.waitFor(() => {
      // After the close, Player 1's session has no channels: a send now
      // fails and surfaces an error event to Player 1's frame.
      deliver(
        harness.channels[0]!.port1,
        apiCallMessage("raw.send", { name: "chat", payload: "hi" }),
      );
      const events = apiEventsOf(harness, 0);
      expect(
        events.some(
          (event) =>
            event.kind === "error" &&
            event.code === "unknown_channel" &&
            String(event.message).includes("raw.send"),
        ),
      ).toBe(true);
    });
  });

  it("runs a simulation-mode game: snapshots flow through the authority frame (A1)", async () => {
    const harness = createHarness();
    mountContainers(harness, 2);
    const engine = createEngine(harness, { gameMode: "simulation" });
    engine.start();
    await runToStart(harness.channels, 2);

    // Simulation mode starts without state requests: the initial authority
    // announces and produces authoritative snapshots by asking its frame to
    // serialize its state (the fake frame answers every request).
    await vi.waitFor(() => {
      answerSimulationRequests(harness.channels, 2);
      const snapshot = engine.getSnapshot();
      expect(snapshot.players.every((player) => player.runState === "started")).toBe(true);
    });
    // The authority session retains an authoritative snapshot and the arena
    // surfaces the simulation diagnostics (latency/drift visible).
    await vi.waitFor(
      () => {
        answerSimulationRequests(harness.channels, 2);
        const diag = engine.getSnapshot().simulationDiagnostics;
        expect(diag).not.toBeNull();
        expect(diag?.authorityTick).not.toBeNull();
        expect(diag?.tickMs).toBe(100);
        expect(diag?.snapshotIntervalMs).toBe(1_000);
      },
      { timeout: 5_000, interval: 20 },
    );
    // The frames received the tick events Nova drives.
    const tickEvents = apiEventsOf(harness, 1).filter((event) => event.kind === "simulationTick");
    expect(tickEvents.length).toBeGreaterThan(0);
    // The frame was asked to serialize its state (snapshot production).
    const requests = apiEventsOf(harness, 0).filter((event) => event.kind === "simulationRequest");
    expect(requests.length).toBeGreaterThan(0);
  });
});

describe("ArenaEngine — network controls", () => {
  async function started(): Promise<{ harness: ArenaHarness; engine: ArenaEngine }> {
    const harness = createHarness();
    mountContainers(harness, 2);
    const engine = createEngine(harness);
    engine.start();
    await runToStartWithEngine(engine, harness, 2);
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

  it("the authority badge moves off a suspended player after migration", async () => {
    const { engine } = await started();
    expect(engine.getSnapshot().authorityPlayerId).toBe("player-1");

    // Suspend the authority (simulated backgrounded phone, issue step 10):
    // peers suspect immediately, elect the next-lowest connected member, and
    // the arena badge follows the session diagnostics.
    await engine.suspendPlayer("player-1");
    await vi.waitFor(
      () => {
        expect(engine.getSnapshot().authorityPlayerId).toBe("player-2");
      },
      { timeout: 10_000, interval: 100 },
    );

    // Resume: the reconnected player catches up and the game keeps running.
    await engine.resumePlayer("player-1");
    await vi.waitFor(
      () => {
        expect(engine.getSnapshot().players[0]?.sessionStatus).toBe("connected");
      },
      { timeout: 10_000, interval: 100 },
    );
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
    await runToStartWithEngine(engine, harness, 2);

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
    await runToStartWithEngine(engine, harness, 2);

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
    await readyAll(harness.channels, 2);
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
    await runToStartWithEngine(engine, harness, 2);

    const firstFrames = [...harness.frames];
    const firstChannels = harness.channels.length;
    engine.restartAll();
    expect(harness.outcomes).toHaveLength(1); // first run succeeded before the restart

    await runToStartWithEngine(engine, harness, 2, firstChannels);
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
    await runToStartWithEngine(engine, harness, 2);

    const firstFrames = [...harness.frames];
    const bootstrapsBefore = harness.windowMessages.length;
    const channelsBefore = harness.channels.length;
    engine.replaceSource(REPLACED_SOURCE);
    await runToStartWithEngine(engine, harness, 2, channelsBefore);

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
    const states: ArenaState[] = [];
    const engine = new ArenaEngine({
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
    engine.start();
    await runToStartWithEngine(engine, harness, 2);
    expect(states.length).toBeGreaterThan(0);
    // The last snapshot reflects the settled run.
    const last = states.at(-1)!;
    expect(last.players[0]?.connectionState).toBe("connected");
    engine.stop();
  });

  it("stop tears every runtime down", async () => {
    const harness = createHarness();
    mountContainers(harness, 2);
    const engine = createEngine(harness);
    engine.start();
    await runToStartWithEngine(engine, harness, 2);
    engine.stop();
    expect(document.querySelectorAll("iframe")).toHaveLength(0);
    expect(engine.getSnapshot().status).toBe("stopped");
    expect(harness.channels.every((channel) => channel.port1.closed)).toBe(true);
  });
});
