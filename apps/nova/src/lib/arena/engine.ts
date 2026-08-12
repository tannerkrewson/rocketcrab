/**
 * The U6 test arena engine (host side).
 *
 * Runs several simulated players on one page: each player is a real runtime
 * frame (U3, driven through RuntimeHostClient) wired to its own NovaSession
 * (S1) over the InMemoryTransport (U5). The runtime protocol is never
 * bypassed: the game's Nova API calls travel from the frame to the runtime
 * page as validated reports, arrive here as `game.apiCall` messages, are
 * re-validated at this boundary, and are routed into the player's session;
 * session events travel back as `game.apiEvent` messages and are dispatched
 * to the frame's `window.nova` handlers by the bridge.
 *
 * The engine owns the simulation state (players, transports, sessions,
 * shared network settings) and emits a fresh {@link ArenaState} after every
 * change; the UI (ArenaPage) is a pure projection. The creator's controls
 * map to transport operations exactly: disconnect = clean leave, reconnect =
 * fresh join, suspend/resume = simulated background suspension (U5),
 * authority loss = forced reconnect of the current authority player (S3 owns
 * real election/migration).
 */
import type {
  GameApiCallMessage,
  GameApiEvent,
  GameEndReason,
  GameMode,
} from "@rocketcrab/protocol";
import { createNovaSession, type NovaSession, type NovaSessionEvent } from "@rocketcrab/nova-api";
import {
  InMemoryTransportHub,
  type InMemoryHubOptions,
  type InMemoryTransport,
} from "@rocketcrab/testing";
import { RuntimeHostClient, type ChannelPort, type RuntimeHostEvent } from "../runtime-host";
import { arenaApiCallSchemas } from "./api-calls";
import type {
  ArenaLogEntry,
  ArenaPlayer,
  ArenaPlayerRunState,
  ArenaRegistration,
  ArenaRunOutcome,
  ArenaState,
  ArenaSummary,
} from "./types";

/** Test seams forwarded to RuntimeHostClient (no-op in production). */
export interface ArenaSeams {
  createChannel?: () => { port1: ChannelPort; port2: unknown };
  waitForFrameLoad?: (iframe: HTMLIFrameElement) => Promise<void>;
  bootstrapTimeoutMs?: number;
}

/** One simulated player's stable identity within the arena. */
export interface ArenaPlayerSpec {
  /** Arena-local id ("player-1"). */
  readonly id: string;
  /** Creator-editable display name. */
  readonly name: string;
  /** Distinct protocol member id ("member-1"); never reused. */
  readonly memberId: string;
}

export interface ArenaEngineOptions {
  /** The game source every player's runtime frame executes. */
  source: string;
  /** Host-declared game id (saved game id or a draft id). */
  gameId: string;
  /** Execution mode (state / simulation / raw). */
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

/** Runtime error categories that fail the test run. */
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
  private dropMessages = false;
  private startedAt: number | null = null;
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

  /** The current state snapshot (tests). */
  getSnapshot(): ArenaState {
    const players = [...this.players.values()].map(toArenaPlayer);
    const summary = computeSummary(players);
    return {
      status: this.status,
      players,
      authorityPlayerId: this.computeAuthorityPlayerId(players),
      latencyMs: this.latencyMs,
      dropMessages: this.dropMessages,
      startedAt: this.startedAt,
      summary,
      sessionId: this.sessionId,
      runId: this.runId,
    };
  }

  /** Start the arena: load every initial player's runtime frame. */
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

  /** Remove a player: destroy its frame, session, and transport. */
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

  /** Simulated background suspension (U5): connection drops, peers observe leave. */
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

  /**
   * Trigger authority loss: force the current authority player's connection
   * to drop and rejoin (visible as a disconnect/reconnect of that player).
   * Real authority election/migration is S3's scope; this is the S1-visible
   * simulation of the loss event.
   */
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

  /** Shared message-drop toggle: unreliable sends drop with probability 0.4. */
  setDropMessages(enabled: boolean): void {
    if (enabled === this.dropMessages) return;
    this.dropMessages = enabled;
    for (const runtime of this.players.values()) {
      if (runtime.transport !== null) {
        runtime.transport.faultProfile.lossRate = enabled ? 0.4 : 0;
      }
    }
    this.emit();
  }

  /** Clear every player's log panel. */
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
    for (const runtime of this.players.values()) {
      runtime.client = null;
      runtime.transport = null;
      runtime.session = null;
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

  /** Tear everything down (unmount, or a restart's teardown half). */
  stop(): void {
    if (this.disposed) return;
    this.teardownAll();
    this.status = "stopped";
    this.emit();
    this.disposed = true;
  }

  // ------------------------------------------------------------------
  // Internals
  // ------------------------------------------------------------------

  private newRuntime(spec: ArenaPlayerSpec): PlayerRuntime {
    return {
      spec,
      client: null,
      transport: null,
      session: null,
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
      if (this.players.get(runtime.spec.id) !== runtime) return; // removed meanwhile
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
        // The bridge is live now: join the session so the game's forwarded
        // calls (and this player's connection) reach the transport.
        void this.joinSession(runtime)
          .then(() => {
            if (this.players.get(id) !== runtime) return;
            this.maybeStart();
            this.emit();
          })
          .catch(() => {
            // joinSession already logged the failure; surface it in the UI.
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
      case "rawMessage":
      case "state":
      case "simulationInput":
      case "simulationSnapshot":
        break; // routed to the frame only
      case "actionReceived":
        return; // host-side S2 seam; never routed to games
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
        void session
          .dispatch(parsed.data.action)
          .catch((error: unknown) =>
            this.logPlayer(
              runtime.spec.id,
              "error",
              `nova.dispatch() failed: ${errorMessage(error)}`,
            ),
          );
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
        session.sendSimulationInput(parsed.data.input);
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

  private computeAuthorityPlayerId(players: readonly ArenaPlayer[]): string | null {
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

function toApiEvent(event: NovaSessionEvent): GameApiEvent | null {
  switch (event.type) {
    case "playerJoined":
      return { kind: "playerJoined", player: event.player };
    case "playerLeft":
      return { kind: "playerLeft", player: event.player };
    case "connection":
      return { kind: "connection", status: event.status };
    case "start":
      return { kind: "start" };
    case "end":
      return { kind: "end", reason: event.reason as GameEndReason };
    case "state":
      return { kind: "state", state: event.state };
    case "rawMessage":
      return { kind: "rawMessage", channel: event.channel, message: event.message };
    case "simulationInput":
      return { kind: "simulationInput", input: event.input };
    case "simulationSnapshot":
      return { kind: "simulationSnapshot", snapshot: event.snapshot };
    case "error":
      return { kind: "error", code: event.error.code, message: event.error.message };
    case "actionReceived":
      return null;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong.";
}
