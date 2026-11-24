import type { NovaAction } from "@rocketcrab/nova-api";
import { RuntimeHostClient, type RuntimeHostEvent } from "../runtime-host";
import { arenaApiCallSchemas } from "../arena/api-calls";
import type { ArenaLogEntry } from "../arena/types";
import type { FrameStateResponsePayload } from "../arena/state-executor";
import type { PartyEngineContext } from "./engine-context";
import type { PartyEngineServices } from "./engine-services";
import { errorMessage } from "./engine-utils";
import { playerLimitsOf } from "./player-limits";

const MAX_PARTY_LOG_ENTRIES = 200;
let partyLogCounter = 0;

/** Runtime frame ownership, Nova API bridging, and per-frame event replay. */
export class PartyRuntime {
  /**
   * A reload was requested and the runtime has not reported it yet. Until then a
   * registration comes from the old frame: a reload keeps the same channel and
   * instance id, so the message itself cannot say which frame sent it.
   */
  private reloadPending = false;

  constructor(
    private readonly state: PartyEngineContext,
    private readonly services: () => Pick<PartyEngineServices, "snapshot">,
  ) {}

  setContainer(element: HTMLElement | null): void {
    if (element === this.state.container) {
      return;
    }
    // Lobby-to-playing transitions rebind the container. A non-null replacement
    // invalidates the old iframe; a null detach leaves teardown to the leave path.
    if (element !== null && this.state.runtime !== null) {
      this.state.runtime.dispose();
      this.state.runtime = null;
      this.state.frameStarted = false;
      this.state.registered = false;
    }
    this.state.container = element;
    void this.maybeBootFrame();
  }

  recoverRuntimeAfterResume(): void {
    const runtime = this.state.runtime;
    if (runtime === null || this.state.leaving) {
      return;
    }
    const diagnostic = runtime.diagnose();
    if (diagnostic.ready && !diagnostic.unresponsive) {
      return;
    }
    this.services().snapshot.addNotice(
      "warn",
      "Your game's runtime was suspended while the page was away — reloading it.",
    );
    this.services().snapshot.emit();
    this.resetFrameInstance();
    void runtime.restart().catch((error: unknown) => {
      this.services().snapshot.addNotice(
        "error",
        `The game could not be reloaded: ${errorMessage(error)}`,
      );
      this.services().snapshot.emit();
    });
  }

  /** External games use the UI-owned iframe; keep the party and coordinator alive. */
  teardownRuntimeFrame(): void {
    this.state.runtime?.destroy("user_exit");
    this.state.runtime = null;
    this.state.frameStarted = false;
    this.state.registered = false;
    this.state.pendingSource = null;
  }

  /** Registration and start delivery are per frame instance, not per session. */
  private resetFrameInstance(): void {
    this.state.registered = false;
    this.state.frameStartDelivered = false;
    this.reloadPending = false;
  }

  reloadRuntimeFrame(): void {
    this.resetFrameInstance();
    this.reloadPending = true;
    this.state.runtime?.reload();
  }

  async maybeBootFrame(): Promise<void> {
    // Leaving clears the frame before its async teardown ends; a rebind in that
    // window must not boot a frame nobody will tear down.
    if (
      this.state.frameStarted ||
      this.state.runtime !== null ||
      this.state.container === null ||
      this.state.leaving
    ) {
      return;
    }
    const source = this.state.pendingSource;
    if (source === null) {
      return;
    }
    this.state.frameStarted = true;
    const client = new RuntimeHostClient({
      runtimeOrigin: this.state.defaults.runtimeOrigin,
      container: this.state.container,
      onEvent: (event) => this.handleHostEvent(event),
      ...(this.state.defaults.seams.createChannel !== undefined
        ? { createChannel: this.state.defaults.seams.createChannel }
        : {}),
      ...(this.state.defaults.seams.waitForFrameLoad !== undefined
        ? { waitForFrameLoad: this.state.defaults.seams.waitForFrameLoad }
        : {}),
      ...(this.state.defaults.seams.bootstrapTimeoutMs !== undefined
        ? { bootstrapTimeoutMs: this.state.defaults.seams.bootstrapTimeoutMs }
        : {}),
    });
    this.state.runtime = client;
    this.resetFrameInstance();
    try {
      await client.load({
        gameId: source.gameId,
        gameSource: source.source,
        player: {
          memberId: this.state.identity.memberId,
          displayName: this.state.identity.displayName,
        },
        gameTitle: source.title,
        sessionId: this.state.party?.material.sessionId,
      });
    } catch (error) {
      // A superseded load must not clear its replacement frame.
      if (this.state.runtime !== client) return;
      this.state.runtime = null;
      this.state.frameStarted = false;
      this.state.registered = false;
      const message = errorMessage(error);
      this.services().snapshot.addNotice("error", `Your game could not start: ${message}`);
      this.services().snapshot.emit();
    }
  }

  handleHostEvent(event: RuntimeHostEvent): void {
    switch (event.type) {
      case "registration":
        if (this.reloadPending) break;
        this.state.registered = true;
        if (this.state.game !== null) {
          // The game's own declaration is the only source of its player limits.
          const { gameId, title } = this.state.game;
          this.state.game = { gameId, title, ...playerLimitsOf(event.message) };
        }
        this.state.frameTickRate = event.message.tickRate ?? null;
        this.state.session?.setTickRate(this.state.frameTickRate);
        // Registration implies readiness; explicit nova.ready() is idempotent.
        this.state.session?.ready();
        // Session attachment precedes frame creation, so registration must replay identity and peers.
        this.pushSessionSnapshot();
        this.services().snapshot.emit();
        break;
      case "apiCall":
        this.routeApiCall(event.message);
        break;
      case "error":
        this.services().snapshot.addNotice(
          "error",
          `Runtime error (${event.message.category}): ${event.message.message}`,
        );
        this.services().snapshot.emit();
        break;
      case "fatal":
        this.services().snapshot.addNotice("error", event.message);
        this.services().snapshot.emit();
        break;
      case "unresponsive":
        this.services().snapshot.addNotice(
          "warn",
          "Your game stopped answering — it may be wedged.",
        );
        this.services().snapshot.emit();
        break;
      case "responsive":
        this.services().snapshot.addNotice("info", "Your game is responsive again.");
        this.services().snapshot.emit();
        break;
      case "port-closed":
        this.services().snapshot.addNotice(
          "warn",
          "Your game's runtime channel closed — reloading it.",
        );
        this.services().snapshot.emit();
        if (this.state.runtime !== null && !this.state.leaving) {
          this.resetFrameInstance();
          void this.state.runtime.restart().catch((error: unknown) => {
            this.services().snapshot.addNotice(
              "error",
              `The game could not be reloaded: ${errorMessage(error)}`,
            );
            this.services().snapshot.emit();
          });
        }
        break;
      case "lifecycle":
        if (event.message.event === "reloaded") this.reloadPending = false;
        break;
      case "ready":
      case "metadata":
        break; // handled by the runtime; not lobby-facing
      case "console": {
        const { level, message, details, dropped } = event.message;
        const entry: ArenaLogEntry = {
          id: `party-log-${++partyLogCounter}`,
          timestamp: Date.now(),
          level: level === "debug" ? "log" : level,
          message,
          ...(details !== undefined ? { details } : {}),
        };
        this.state.runtimeLogs = [...this.state.runtimeLogs, entry].slice(-MAX_PARTY_LOG_ENTRIES);
        if ((dropped ?? 0) > 0) {
          const droppedEntry: ArenaLogEntry = {
            id: `party-log-${++partyLogCounter}`,
            timestamp: Date.now(),
            level: "warn",
            message: `${dropped} console ${dropped === 1 ? "entry" : "entries"} dropped (rate limit)`,
          };
          this.state.runtimeLogs = [...this.state.runtimeLogs, droppedEntry].slice(
            -MAX_PARTY_LOG_ENTRIES,
          );
        }
        this.services().snapshot.emit();
        break;
      }
    }
  }

  private routeApiCall(message: { method: string; payload: unknown }): void {
    const session = this.state.session;
    if (session === null) {
      return;
    }
    const payload = message.payload as Record<string, unknown>;
    switch (message.method) {
      case "ready":
        if (arenaApiCallSchemas.ready.safeParse(payload).success) {
          session.ready();
        }
        break;
      case "dispatch": {
        const parsed = arenaApiCallSchemas.dispatch.safeParse(payload);
        if (parsed.success) {
          void session
            .dispatch(parsed.data.action as NovaAction, parsed.data.actionId)
            .catch((error: unknown) => {
              this.services().snapshot.addNotice(
                "error",
                `nova.dispatch() failed: ${errorMessage(error)}`,
              );
              const code =
                error instanceof Error && "code" in error ? String(error.code) : "invalid_options";
              this.state.runtime?.pushApiEvent({
                kind: "actionAck",
                actionId: parsed.data.actionId,
                status: "rejected",
                errorCode: code,
                errorMessage: errorMessage(error),
              });
            });
        }
        break;
      }
      case "controls.set": {
        const parsed = arenaApiCallSchemas["controls.set"].safeParse(payload);
        if (parsed.success) {
          try {
            session.setControls(parsed.data.controls);
          } catch (error) {
            const code =
              error instanceof Error && "code" in error ? String(error.code) : "invalid_options";
            this.state.runtime?.pushApiEvent({ kind: "error", code, message: errorMessage(error) });
          }
        }
        break;
      }
      case "stateResponse": {
        const parsed = arenaApiCallSchemas.stateResponse.safeParse(payload);
        if (parsed.success) {
          this.state.stateExecutor?.handleResponse(parsed.data as FrameStateResponsePayload);
        }
        break;
      }
    }
  }

  /**
   * Deliver start once per registered frame. Games need their view first
   * because onStart may read state or dispatch an action.
   */
  deliverStartToFrame(): void {
    const runtime = this.state.runtime;
    if (runtime === null || !this.state.registered || !this.state.gameStarted) return;
    if (this.state.frameStartDelivered) return;
    if (this.state.lastStateApiEvent === null) return;
    this.state.frameStartDelivered = true;
    runtime.pushApiEvent({ kind: "start" });
  }

  /**
   * Replay identity, connection, roster, and state missed before frame boot.
   * The game client deduplicates players by id.
   */
  private pushSessionSnapshot(): void {
    const session = this.state.session;
    const runtime = this.state.runtime;
    if (session === null || runtime === null) {
      return;
    }
    runtime.pushApiEvent({ kind: "identity", player: session.player });
    runtime.pushApiEvent({ kind: "connection", status: session.connectionStatus });
    for (const player of session.players) {
      runtime.pushApiEvent({ kind: "playerJoined", player });
    }
    // Replay the view before onStart can dispatch against it.
    if (this.state.lastStateApiEvent !== null) {
      runtime.pushApiEvent(this.state.lastStateApiEvent);
    }
    // Followers do not set session.isStarted(); gameStarted tracks received starts too.
    this.deliverStartToFrame();
  }

  clearRuntimeLogs(): void {
    if (this.state.runtimeLogs.length === 0) return;
    this.state.runtimeLogs = [];
    this.services().snapshot.emit();
  }
}
