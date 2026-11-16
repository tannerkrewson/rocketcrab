/**
 * Runs simulated players as real runtime frames, each connected to its own
 * NovaSession over InMemoryTransport. API calls are revalidated here before
 * reaching sessions; session events return through the runtime bridge.
 *
 * Owns player, transport, and session state. UI controls exercise transport
 * operations, including real authority elections on connection loss.
 */
import type { GameApiCallMessage, GameApiEvent, GameMode } from "@rocketcrab/protocol";
import { createNovaSession, type NovaSession, type NovaSessionEvent } from "@rocketcrab/nova-api";
import {
  InMemoryTransportHub,
  type InMemoryHubOptions,
  type InMemoryTransport,
} from "@rocketcrab/testing";
import { RuntimeHostClient, type ChannelPort, type RuntimeHostEvent } from "../runtime-host";
import { arenaApiCallSchemas } from "./api-calls";
import { toApiEvent } from "./api-events";
import {
  createFrameStateExecutor,
  createFrameSimulationExecutor,
  type FrameSimulationExecutor,
  type FrameSimulationResponsePayload,
  type FrameStateExecutor,
  type FrameStateResponsePayload,
} from "./state-executor";
import type {
  ArenaLogEntry,
  ArenaPlayer,
  ArenaPlayerRunState,
  ArenaRegistration,
  ArenaRunOutcome,
  ArenaSimulationDiagnostics,
  ArenaState,
  ArenaStateDiagnostics,
  ArenaSummary,
} from "./types";

/** Test seams forwarded to RuntimeHostClient (no-op in production). */
export interface ArenaSeams {
  createChannel?: () => { port1: ChannelPort; port2: unknown };
  waitForFrameLoad?: (iframe: HTMLIFrameElement) => Promise<void>;
  bootstrapTimeoutMs?: number;
}

export interface ArenaPlayerSpec {
  /** Arena-local id ("player-1"). */
  readonly id: string;
  readonly name: string;
  /** Distinct protocol member id ("member-1"); never reused. */
  readonly memberId: string;
}

export interface ArenaEngineOptions {
  source: string;
  /** Host-declared game id (saved game id or a draft id). */
  gameId: string;
  gameMode: GameMode;
  gameTitle?: string;
  runtimeOrigin: string;
  /** Players to create on start (the UI may add more later). */
  initialPlayers: ArenaPlayerSpec[];
  /** Resolve the frame container for a player (null until mounted). */
  getContainer: (playerId: string) => HTMLElement | null;
  seams?: ArenaSeams;
  /** Injectable hub options (tests use seeded/deterministic hubs). */
  hubOptions?: InMemoryHubOptions;
  /** Emitted with a fresh state snapshot after every change. */
  onState: (state: ArenaState) => void;
  /** Fired once when a run reaches a clean success (persist test results). */
  onRunSucceeded?: (outcome: ArenaRunOutcome) => void;
}

const FATAL_ERROR_CATEGORIES = new Set([
  "empty_source",
  "missing_registration",
  "oversized_source",
  "syntax",
  "crash",
  "security",
  "unsupported",
  "runtime",
]);

const MAX_LOG_ENTRIES_PER_PLAYER = 200;

function newSessionId(): string {
  return `arena-${crypto.randomUUID()}`;
}

function roomFor(gameId: string): string {
  return `arena:${gameId}`;
}

interface PlayerRuntime {
  spec: ArenaPlayerSpec;
  client: RuntimeHostClient | null;
  transport: InMemoryTransport | null;
  session: NovaSession | null;
  stateExecutor: FrameStateExecutor | null;
  simulationExecutor: FrameSimulationExecutor | null;
  unsubSession: (() => void) | null;
  runState: ArenaPlayerRunState;
  registered: ArenaRegistration | null;
  runtimeInstanceId: string | null;
  logs: ArenaLogEntry[];
  lastError: string | null;
  loadError: string | null;
}

function makeLog(level: ArenaLogEntry["level"], message: string, details?: string): ArenaLogEntry {
  return {
    id: `log-${++logCounter}`,
    timestamp: Date.now(),
    level,
    message,
    ...(details !== undefined ? { details } : {}),
  };
}
let logCounter = 0;

export class ArenaEngine {
  private readonly options: ArenaEngineOptions;
  private readonly players = new Map<string, PlayerRuntime>();
  private hub: InMemoryTransportHub;
  private readonly room: string;
  private sessionId: string;
  private runId = 1;
  private status: ArenaState["status"] = "starting";
  private latencyMs = 0;
  private startedAt: number | null = null;
  private stateDiagnostics: ArenaStateDiagnostics | null = null;
  private source: string;
  private nextMemberNumber = 1;
  private lastSuccessRunId: number | null = null;
  private disposed = false;
  private loading = false;

  constructor(options: ArenaEngineOptions) {
    this.options = options;
    this.source = options.source;
    this.room = roomFor(options.gameId);
    this.sessionId = newSessionId();
    this.hub = new InMemoryTransportHub(options.hubOptions);
    for (const spec of options.initialPlayers) {
      this.players.set(spec.id, this.newRuntime(spec));
    }
    this.nextMemberNumber = options.initialPlayers.length + 1;
  }

  getSnapshot(): ArenaState {
    const players = [...this.players.values()].map(toArenaPlayer);
    const summary = computeSummary(players);
    return {
      status: this.status,
      players,
      authorityPlayerId: this.computeAuthorityPlayerId(players),
      latencyMs: this.latencyMs,
      startedAt: this.startedAt,
      stateDiagnostics: this.stateDiagnostics,
      simulationDiagnostics: this.computeSimulationDiagnostics(players),
      summary,
      sessionId: this.sessionId,
      runId: this.runId,
    };
  }

  start(): void {
    this.status = "starting";
    this.emit();
    void this.loadPending();
  }

  /**
   * Load players whose frame container is now mounted. Called by the UI
   * after rendering new player cards (and from start). Idempotent.
   */
  async loadPending(): Promise<void> {
    if (this.loading) return;
    this.loading = true;
    try {
      for (const runtime of this.players.values()) {
        if (runtime.runState !== "pending") continue;
        if (this.options.getContainer(runtime.spec.id) === null) continue;
        await this.loadPlayer(runtime);
      }
    } finally {
      this.loading = false;
    }
  }

  /** Add a simulated player (distinct identity; loads when mounted). */
  addPlayer(name?: string): void {
    const number = this.nextMemberNumber;
    this.nextMemberNumber += 1;
    const spec: ArenaPlayerSpec = {
      id: `player-${number}`,
      name: (name ?? "").trim() || `Player ${number}`,
      memberId: `member-${number}`,
    };
    this.players.set(spec.id, this.newRuntime(spec));
    this.emit();
    void this.loadPending();
  }

  removePlayer(id: string): void {
    const runtime = this.players.get(id);
    if (runtime === undefined) return;
    this.teardownRuntime(runtime);
    this.players.delete(id);
    this.emit();
  }

  /** Rename a player. The frame's own `nova.player` updates immediately. */
  renamePlayer(id: string, name: string): void {
    const runtime = this.players.get(id);
    if (runtime === undefined) return;
    const trimmed = name.trim();
    if (trimmed.length === 0 || trimmed === runtime.spec.name) return;
    runtime.spec = { ...runtime.spec, name: trimmed };
    this.pushApiEvent(id, {
      kind: "identity",
      player: { id: runtime.spec.memberId, name: trimmed },
    });
    this.emit();
  }

  /** Disconnect a player: clean leave; peers observe the player leave. */
  async disconnectPlayer(id: string): Promise<void> {
    const session = this.players.get(id)?.session ?? null;
    if (session === null) return;
    try {
      await session.leave();
    } catch (error) {
      this.logPlayer(id, "error", `Disconnect failed: ${errorMessage(error)}`);
    }
  }

  /** Reconnect a disconnected player: fresh join; peers observe the rejoin. */
  async reconnectPlayer(id: string): Promise<void> {
    const session = this.players.get(id)?.session ?? null;
    if (session === null) return;
    try {
      await session.join();
    } catch (error) {
      this.logPlayer(id, "error", `Reconnect failed: ${errorMessage(error)}`);
    }
  }

  /** Simulate background suspension: drop the connection so peers observe leave. */
  async suspendPlayer(id: string): Promise<void> {
    const transport = this.players.get(id)?.transport ?? null;
    if (transport === null) return;
    try {
      await transport.suspend();
    } catch (error) {
      this.logPlayer(id, "error", `Suspend failed: ${errorMessage(error)}`);
    }
  }

  /** Resume a suspended player (fresh connection; peers observe the rejoin). */
  async resumePlayer(id: string): Promise<void> {
    const transport = this.players.get(id)?.transport ?? null;
    if (transport === null) return;
    try {
      await transport.resume();
    } catch (error) {
      this.logPlayer(id, "error", `Resume failed: ${errorMessage(error)}`);
    }
  }

  /** Drop and rejoin the authority connection to exercise election and migration. */
  async triggerAuthorityLoss(): Promise<void> {
    const authorityId = this.getSnapshot().authorityPlayerId;
    if (authorityId === null) return;
    const transport = this.players.get(authorityId)?.transport ?? null;
    if (transport === null || transport.connectionState !== "connected") {
      this.logPlayer(
        authorityId,
        "info",
        "Authority loss: player is not connected; nothing to drop.",
      );
      return;
    }
    try {
      await transport.reconnect();
    } catch (error) {
      this.logPlayer(authorityId, "error", `Authority loss failed: ${errorMessage(error)}`);
    }
  }

  /** Shared artificial one-way latency (ms) applied to every link. */
  setLatency(latencyMs: number): void {
    const value = Math.max(0, Math.round(latencyMs));
    if (value === this.latencyMs) return;
    this.latencyMs = value;
    for (const runtime of this.players.values()) {
      if (runtime.transport !== null) {
        runtime.transport.faultProfile.latencyMs = value;
      }
    }
    this.emit();
  }

  clearLogs(): void {
    for (const runtime of this.players.values()) {
      runtime.logs = [];
    }
    this.emit();
  }

  /** Restart every player with the same source (all old frames destroyed). */
  restartAll(): void {
    this.replaceSource(this.source);
  }

  /** Replace the source and restart every player (all old frames destroyed). */
  replaceSource(source: string): void {
    this.teardownAll();
    this.source = source;
    this.runId += 1;
    this.sessionId = newSessionId();
    this.hub = new InMemoryTransportHub(this.options.hubOptions);
    this.status = "starting";
    this.startedAt = null;
    this.stateDiagnostics = null;
    for (const runtime of this.players.values()) {
      runtime.client = null;
      runtime.transport = null;
      runtime.session = null;
      runtime.stateExecutor = null;
      runtime.simulationExecutor = null;
      runtime.unsubSession = null;
      runtime.runState = "pending";
      runtime.registered = null;
      runtime.runtimeInstanceId = null;
      runtime.lastError = null;
      runtime.loadError = null;
      runtime.logs = [];
    }
    this.emit();
    void this.loadPending();
  }

  stop(): void {
    if (this.disposed) return;
    this.teardownAll();
    this.status = "stopped";
    this.emit();
    this.disposed = true;
  }

  private newRuntime(spec: ArenaPlayerSpec): PlayerRuntime {
    return {
      spec,
      client: null,
      transport: null,
      session: null,
      stateExecutor: null,
      simulationExecutor: null,
      unsubSession: null,
      runState: "pending",
      registered: null,
      runtimeInstanceId: null,
      logs: [],
      lastError: null,
      loadError: null,
    };
  }

  private async loadPlayer(runtime: PlayerRuntime): Promise<void> {
    const container = this.options.getContainer(runtime.spec.id);
    if (container === null) return;
    runtime.runState = "loading";
    this.emit();
    const client = new RuntimeHostClient({
      runtimeOrigin: this.options.runtimeOrigin,
      container,
      onEvent: (event) => this.handleHostEvent(runtime.spec.id, event),
      ...(this.options.seams?.createChannel !== undefined
        ? { createChannel: this.options.seams.createChannel }
        : {}),
      ...(this.options.seams?.waitForFrameLoad !== undefined
        ? { waitForFrameLoad: this.options.seams.waitForFrameLoad }
        : {}),
      ...(this.options.seams?.bootstrapTimeoutMs !== undefined
        ? { bootstrapTimeoutMs: this.options.seams.bootstrapTimeoutMs }
        : {}),
    });
    runtime.client = client;
    this.logPlayer(runtime.spec.id, "info", "Starting runtime frame…");
    try {
      await client.load({
        gameId: this.options.gameId,
        gameMode: this.options.gameMode,
        gameSource: this.source,
        player: { memberId: runtime.spec.memberId, displayName: runtime.spec.name },
        ...(this.options.gameTitle !== undefined ? { gameTitle: this.options.gameTitle } : {}),
        sessionId: this.sessionId,
      });
      if (this.players.get(runtime.spec.id) !== runtime) return;
      runtime.runtimeInstanceId = client.diagnose().runtimeInstanceId;
      // The game may have already registered while load() was settling;
      // never downgrade past that state.
      if (runtime.runState === "loading") {
        runtime.runState = "running";
        this.logPlayer(
          runtime.spec.id,
          "info",
          "Runtime ready — waiting for the game to register.",
        );
      }
      this.emit();
    } catch (error) {
      if (this.players.get(runtime.spec.id) !== runtime) return;
      const message = errorMessage(error);
      runtime.loadError = message;
      runtime.runState = "failed";
      this.logPlayer(runtime.spec.id, "error", `Runtime failed to start: ${message}`);
      this.emit();
    }
  }

  private handleHostEvent(id: string, event: RuntimeHostEvent): void {
    const runtime = this.players.get(id);
    if (runtime === undefined || this.disposed) return;
    switch (event.type) {
      case "registration":
        runtime.registered = {
          title: event.message.title,
          gameMode: event.message.gameMode,
        };
        runtime.runState = "registered";
        this.logPlayer(
          id,
          "info",
          `Registered as “${event.message.title}” (${event.message.gameMode} mode).`,
        );
        void this.joinSession(runtime)
          .then(() => {
            if (this.players.get(id) !== runtime) return;
            this.maybeStart();
            this.emit();
          })
          .catch(() => {
            if (this.players.get(id) !== runtime) return;
            runtime.runState = "failed";
            runtime.lastError = runtime.lastError ?? "Could not join the simulated party.";
            this.emit();
          });
        break;
      case "apiCall":
        this.routeApiCall(runtime, event.message);
        break;
      case "console":
        this.appendConsole(id, event.message.level, event.message.message, event.message.details);
        break;
      case "error":
        this.handleRuntimeError(runtime, event.message.category, event.message.message);
        break;
      case "lifecycle":
        if (event.message.event === "paused" || event.message.event === "resumed") {
          this.logPlayer(id, "info", `Runtime ${event.message.event}.`);
        }
        break;
      case "unresponsive":
        this.logPlayer(id, "error", "Runtime stopped answering heartbeats (unresponsive).");
        break;
      case "responsive":
        this.logPlayer(id, "info", "Runtime is responsive again.");
        break;
      case "fatal":
        this.logPlayer(id, "error", event.message);
        break;
      case "port-closed":
        this.logPlayer(id, "info", "Runtime channel closed.");
        break;
      default:
        break;
    }
    this.emit();
  }

  private async joinSession(runtime: PlayerRuntime): Promise<void> {
    if (runtime.session !== null) return;
    const transport = this.hub.createTransport({
      memberId: runtime.spec.memberId,
      displayName: runtime.spec.name,
    });
    runtime.transport = transport;
    // Authority handlers run in the game frame; correlate its responses with session requests.
    runtime.stateExecutor = createFrameStateExecutor((event) =>
      this.pushApiEvent(runtime.spec.id, event),
    );
    // Ask the authority frame to serialize its simulation state.
    runtime.simulationExecutor = createFrameSimulationExecutor((event) =>
      this.pushApiEvent(runtime.spec.id, event),
    );
    const session = createNovaSession({
      transport,
      room: this.room,
      sessionId: this.sessionId,
      player: { memberId: runtime.spec.memberId, displayName: runtime.spec.name },
      game: {
        gameId: this.options.gameId,
        mode: this.options.gameMode,
        ...(this.options.gameTitle !== undefined ? { title: this.options.gameTitle } : {}),
      },
      stateExecutor: runtime.stateExecutor,
      simulationExecutor: runtime.simulationExecutor,
    });
    runtime.session = session;
    runtime.unsubSession = session.onSessionEvent((event) =>
      this.handleSessionEvent(runtime.spec.id, event),
    );
    try {
      await session.join();
      this.logPlayer(runtime.spec.id, "info", "Connected to the simulated party.");
    } catch (error) {
      this.logPlayer(
        runtime.spec.id,
        "error",
        `Could not join the simulated party: ${errorMessage(error)}`,
      );
      throw error;
    }
  }

  private handleSessionEvent(id: string, event: NovaSessionEvent): void {
    const runtime = this.players.get(id);
    if (runtime === undefined || this.disposed) return;
    switch (event.type) {
      case "playerJoined":
        this.logPlayer(id, "info", `Player joined: ${event.player.name} (${event.player.id})`);
        break;
      case "playerLeft":
        this.logPlayer(id, "info", `Player left: ${event.player.name} (${event.player.id})`);
        break;
      case "connection":
        this.logPlayer(id, "info", `Connection: ${event.status}`);
        break;
      case "start":
        runtime.runState = "started";
        if (this.startedAt === null) this.startedAt = Date.now();
        this.logPlayer(id, "info", "Game started.");
        break;
      case "end":
        this.logPlayer(id, "info", `Game ended (${event.reason}).`);
        break;
      case "error":
        this.logPlayer(id, "error", `Nova error (${event.error.code}): ${event.error.message}`);
        break;
      case "bandwidthWarning":
        this.logPlayer(id, "warn", event.message);
        break;
      case "authorityChanged":
        this.logPlayer(
          id,
          "info",
          `Authority: ${event.authorityMemberId ?? "none"} (term ${event.term}).`,
        );
        break;
      case "snapshotFallback":
        this.logPlayer(id, "warn", `A state update was sent in full (${event.reason}).`);
        break;
      case "historyIncomplete":
        this.logPlayer(
          id,
          "warn",
          `Authority ${event.authorityMemberId} has an incomplete action history (term ${event.term}).`,
        );
        break;
      case "stateCommitted":
        this.stateDiagnostics = {
          revision: event.revision,
          stateHash: event.stateHash,
          stateSizeBytes: event.stateSizeBytes,
          appliedCount: event.appliedCount,
          rejectedCount: event.rejectedCount,
          actionRatePerSecond: event.actionRatePerSecond,
        };
        this.logPlayer(
          id,
          "info",
          `State rev ${event.revision} (${event.stateSizeBytes} bytes, ${event.actionRatePerSecond.toFixed(1)} actions/s, applied ${event.appliedCount}, rejected ${event.rejectedCount}).`,
        );
        break;
      case "actionRejected":
        this.logPlayer(
          id,
          "warn",
          `Action ${event.actionId} rejected (${event.code}): ${event.message}`,
        );
        break;
      case "rawMessage":
      case "state":
      case "simulationInput":
      case "simulationSnapshot":
      case "simulationTick":
      case "actionReceived":
        break;
      case "actionAck":
        break;
    }
    const apiEvent = toApiEvent(event);
    if (apiEvent !== null) {
      this.pushApiEvent(id, apiEvent);
    }
    this.emit();
  }

  private pushApiEvent(id: string, event: GameApiEvent): void {
    const client = this.players.get(id)?.client;
    client?.pushApiEvent(event);
  }

  private routeApiCall(runtime: PlayerRuntime, message: GameApiCallMessage): void {
    const session = runtime.session;
    if (session === null) {
      this.logPlayer(
        runtime.spec.id,
        "error",
        `nova.${message.method}() arrived before the session was connected; ignored.`,
      );
      return;
    }
    switch (message.method) {
      case "ready": {
        if (!arenaApiCallSchemas.ready.safeParse(message.payload).success) {
          this.logPlayer(
            runtime.spec.id,
            "error",
            "nova.ready() call failed validation at the host; ignored.",
          );
          return;
        }
        session.ready();
        break;
      }
      case "dispatch": {
        const parsed = arenaApiCallSchemas.dispatch.safeParse(message.payload);
        if (!parsed.success) {
          this.logPlayer(
            runtime.spec.id,
            "error",
            "nova.dispatch() call failed validation at the host; ignored.",
          );
          return;
        }
        void session.dispatch(parsed.data.action, parsed.data.actionId).catch((error: unknown) => {
          this.sessionError(runtime.spec.id, error);
          const code =
            error instanceof Error && "code" in error ? String(error.code) : "invalid_options";
          this.pushApiEvent(runtime.spec.id, {
            kind: "actionAck",
            actionId: parsed.data.actionId,
            status: "rejected",
            errorCode: code,
            errorMessage: errorMessage(error),
          });
        });
        break;
      }
      case "raw.createChannel": {
        const parsed = arenaApiCallSchemas["raw.createChannel"].safeParse(message.payload);
        if (!parsed.success) {
          this.logPlayer(
            runtime.spec.id,
            "error",
            "nova.raw.createChannel() call failed validation at the host; ignored.",
          );
          return;
        }
        try {
          session.createRawChannel(parsed.data.spec);
        } catch (error) {
          this.sessionError(runtime.spec.id, error);
        }
        break;
      }
      case "raw.send": {
        const parsed = arenaApiCallSchemas["raw.send"].safeParse(message.payload);
        if (!parsed.success) {
          this.logPlayer(
            runtime.spec.id,
            "error",
            "nova.raw.send() call failed validation at the host; ignored.",
          );
          return;
        }
        void session
          .sendRaw(parsed.data.name, parsed.data.payload, parsed.data.options ?? {})
          .catch((error: unknown) => {
            this.sessionError(runtime.spec.id, error);
            const code =
              error instanceof Error && "code" in error
                ? String((error as { code: unknown }).code)
                : "invalid_options";
            this.pushApiEvent(runtime.spec.id, {
              kind: "error",
              code,
              message: `nova.raw.send() failed: ${errorMessage(error)}`,
            });
          });
        break;
      }
      case "raw.close": {
        const parsed = arenaApiCallSchemas["raw.close"].safeParse(message.payload);
        if (!parsed.success) {
          this.logPlayer(
            runtime.spec.id,
            "error",
            "nova.raw.close() call failed validation at the host; ignored.",
          );
          return;
        }
        try {
          session.closeRawChannel(parsed.data.name);
        } catch (error) {
          this.sessionError(runtime.spec.id, error);
        }
        break;
      }
      case "simulation.register": {
        if (!arenaApiCallSchemas["simulation.register"].safeParse(message.payload).success) {
          this.logPlayer(
            runtime.spec.id,
            "error",
            "nova.simulation.register() call failed validation at the host; ignored.",
          );
          return;
        }
        session.registerSimulation();
        break;
      }
      case "simulation.sendInput": {
        const parsed = arenaApiCallSchemas["simulation.sendInput"].safeParse(message.payload);
        if (!parsed.success) {
          this.logPlayer(
            runtime.spec.id,
            "error",
            "nova.simulation.sendInput() call failed validation at the host; ignored.",
          );
          return;
        }
        try {
          session.sendSimulationInput(parsed.data.input);
        } catch (error) {
          // Rate-limit and connectivity rejections surface as Nova errors
          // (the frame observes them through nova.onError).
          this.logPlayer(runtime.spec.id, "error", errorMessage(error));
          const code =
            error instanceof Error && "code" in error ? String(error.code) : "invalid_options";
          this.pushApiEvent(runtime.spec.id, { kind: "error", code, message: errorMessage(error) });
        }
        break;
      }
      case "stateResponse": {
        const parsed = arenaApiCallSchemas.stateResponse.safeParse(message.payload);
        if (!parsed.success) {
          this.logPlayer(
            runtime.spec.id,
            "error",
            "stateResponse call failed validation at the host; ignored.",
          );
          return;
        }
        runtime.stateExecutor?.handleResponse(parsed.data as FrameStateResponsePayload);
        break;
      }
      case "simulationResponse": {
        const parsed = arenaApiCallSchemas.simulationResponse.safeParse(message.payload);
        if (!parsed.success) {
          this.logPlayer(
            runtime.spec.id,
            "error",
            "simulationResponse call failed validation at the host; ignored.",
          );
          return;
        }
        runtime.simulationExecutor?.handleResponse(parsed.data as FrameSimulationResponsePayload);
        break;
      }
    }
  }

  private sessionError(id: string, error: unknown): void {
    this.logPlayer(id, "error", errorMessage(error));
  }

  private handleRuntimeError(runtime: PlayerRuntime, category: string, message: string): void {
    this.logPlayer(runtime.spec.id, "error", `${category}: ${message}`);
    if (FATAL_ERROR_CATEGORIES.has(category)) {
      runtime.lastError = message;
      runtime.runState = "failed";
    }
  }

  private appendConsole(
    id: string,
    level: "debug" | "log" | "info" | "warn" | "error",
    message: string,
    details?: string,
  ): void {
    this.logPlayer(id, level === "debug" ? "log" : level, message, details);
  }

  private logPlayer(
    id: string,
    level: ArenaLogEntry["level"],
    message: string,
    details?: string,
  ): void {
    const runtime = this.players.get(id);
    if (runtime === undefined) return;
    runtime.logs = [...runtime.logs, makeLog(level, message, details)].slice(
      -MAX_LOG_ENTRIES_PER_PLAYER,
    );
  }

  private maybeStart(): void {
    const snapshot = this.getSnapshot();
    const players = snapshot.players;
    if (players.length === 0) return;
    // Late joiners start from a catch-up snapshot; starting them here would
    // race catch-up and risk a second authority.
    if (players.some((player) => player.runState === "started")) return;
    const settled = players.every(
      (player) =>
        player.runState === "registered" ||
        player.runState === "started" ||
        player.runState === "failed",
    );
    const anyRegistered = players.some(
      (player) => player.runState === "registered" || player.runState === "started",
    );
    if (!settled || !anyRegistered) return;
    for (const runtime of this.players.values()) {
      runtime.session?.start();
    }
  }

  /** Read live authority-session diagnostics; null before any session connects. */
  private computeSimulationDiagnostics(
    players: readonly ArenaPlayer[],
  ): ArenaSimulationDiagnostics | null {
    const authorityId = this.computeAuthorityPlayerId(players);
    for (const runtime of this.players.values()) {
      const session = runtime.session;
      if (authorityId !== null && runtime.spec.id !== authorityId) continue;
      if (session === null) continue;
      const diag = session.getSimulationDiagnostics();
      return {
        tick: diag.tick,
        tickMs: diag.tickMs,
        snapshotIntervalMs: diag.snapshotIntervalMs,
        authorityTick: diag.authorityTick,
        snapshotsReceived: diag.snapshotsReceived,
        inputRatePerSecond: diag.inputRatePerSecond,
        inputLatencyMs: diag.inputLatencyMs,
        highLatency: diag.highLatency,
        driftTicks: diag.driftTicks,
        term: diag.term,
      };
    }
    return null;
  }

  private computeAuthorityPlayerId(players: readonly ArenaPlayer[]): string | null {
    // Disconnected sessions retain stale authority beliefs; only trust connected players.
    for (const runtime of this.players.values()) {
      const session = runtime.session;
      const status = session?.connectionStatus ?? "none";
      const report = session?.getStateModeDiagnostics().authorityMemberId ?? null;
      if (session === null || status !== "connected") continue;
      if (report === null || report === undefined) continue;
      const player = players.find((p) => p.memberId === report);
      if (player !== undefined) return player.id;
    }
    return (
      players.find((player) => player.runState === "registered" || player.runState === "started")
        ?.id ?? null
    );
  }

  private teardownRuntime(runtime: PlayerRuntime): void {
    if (runtime.unsubSession !== null) {
      runtime.unsubSession();
      runtime.unsubSession = null;
    }
    runtime.stateExecutor?.dispose();
    runtime.stateExecutor = null;
    runtime.simulationExecutor?.dispose();
    runtime.simulationExecutor = null;
    runtime.session?.dispose();
    runtime.session = null;
    runtime.transport?.dispose();
    runtime.transport = null;
    runtime.client?.destroy("host_closed");
    runtime.client = null;
  }

  private teardownAll(): void {
    for (const runtime of this.players.values()) {
      this.teardownRuntime(runtime);
    }
    this.hub.dispose();
  }

  private emit(): void {
    if (this.disposed) return;
    const state = this.getSnapshot();
    this.options.onState(state);
    if (state.summary.success && state.summary.total > 0 && this.lastSuccessRunId !== state.runId) {
      this.lastSuccessRunId = state.runId;
      this.options.onRunSucceeded?.({ runId: state.runId, source: this.source });
    }
  }
}

function toArenaPlayer(runtime: PlayerRuntime): ArenaPlayer {
  return {
    id: runtime.spec.id,
    name: runtime.spec.name,
    memberId: runtime.spec.memberId,
    connectionState: runtime.transport?.connectionState ?? "idle",
    sessionStatus: runtime.session?.connectionStatus ?? "disconnected",
    runState: runtime.runState,
    registered: runtime.registered,
    runtimeInstanceId: runtime.runtimeInstanceId,
    logs: runtime.logs,
    lastError: runtime.lastError,
    loadError: runtime.loadError,
  };
}

function computeSummary(players: readonly ArenaPlayer[]): ArenaSummary {
  const registered = players.filter(
    (player) => player.runState === "registered" || player.runState === "started",
  ).length;
  const started = players.filter((player) => player.runState === "started").length;
  const failed = players.filter(
    (player) => player.runState === "failed" || player.lastError !== null,
  ).length;
  return {
    total: players.length,
    registered,
    started,
    failed,
    success: players.length > 0 && registered === players.length && failed === 0,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong.";
}
