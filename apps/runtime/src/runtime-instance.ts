/**
 * One runtime instance: the per-bootstrap execution context (deliverable:
 * one dedicated MessageChannel per runtime instance).
 *
 * An instance owns:
 * - its MessagePort (validated incoming messages, pong replies);
 * - the sandboxed game frame created from the bootstrap's HTML source;
 * - the per-instance `window.__novaRuntime` hook the injected Nova bridge
 *   reports through (errors, unhandled rejections, console entries, and
 *   `nova.defineGame` declarations);
 * - the game registration timeout;
 * - rate-limited error/console forwarding (F6 limits);
 * - reload and destroy (parent-controlled).
 *
 * Game code must never reach the host origin; everything the game reports is
 * treated as untrusted input and validated here before it becomes a protocol
 * message (threat model T10; engineering rules 15/21).
 */
import {
  PROTOCOL_VERSION,
  parseRuntimeMessage,
  type GameApiEventMessage,
  type GameLifecycleEventMessage,
  type GameMode,
  type RuntimeBootstrapMessage,
  type RuntimeErrorMessage,
  type RuntimeMessage,
} from "@rocketcrab/protocol";
import { classifyHtmlSource } from "./html-source";
import {
  buildApiCallMessage,
  buildConsoleMessage,
  buildErrorMessage,
  buildLifecycleMessage,
  buildPongMessage,
  buildReadyMessage,
  buildRegistrationMessage,
} from "./messages";
import {
  NOVA_BRIDGE_SCRIPT,
  SUPPORTED_NOVA_API_VERSIONS,
  gameDeclarationSchema,
  novaApiCallSchemas,
  registrationFields,
  serializeConsoleArgs,
  type GameDeclaration,
  type NovaApiCallMethod,
} from "./nova-bridge";
import { RateLimitedSink, createRuntimeLimiters, type RateLimiter } from "./rate-limiter";

/** Bounded protocol-message history kept for tests and diagnostics. */
export const OUTGOING_LOG_LIMIT = 500;

/** How long the runtime waits for `nova.defineGame` before reporting. */
export const REGISTRATION_TIMEOUT_MS = 10_000;

/** A port we can drive from tests (real MessagePorts satisfy this). */
export interface PortLike {
  postMessage(message: unknown): void;
  close(): void;
  onmessage: ((event: MessageEvent) => void) | null;
  onmessageerror?: ((event: MessageEvent) => void) | null;
}

/** The sandboxed game frame, as seen by the runtime. */
export interface GameFrame {
  readonly window: Window | null;
  destroy(): void;
}

/** Creates game frames; the real implementation lives in `main.ts`. */
export interface FrameFactory {
  create(source: string, allowTokens: readonly string[]): GameFrame;
}

export interface RuntimeInstanceOptions {
  runtimeInstanceId: string;
  bootstrap: RuntimeBootstrapMessage;
  port: PortLike;
  frameFactory: FrameFactory;
  registrationTimeoutMs?: number;
}

interface ErrorReport {
  category: RuntimeErrorMessage["category"];
  message: string;
  details?: Record<string, unknown>;
}

export class RuntimeInstance {
  readonly runtimeInstanceId: string;
  private readonly bootstrap: RuntimeBootstrapMessage;
  private readonly port: PortLike;
  private readonly frameFactory: FrameFactory;
  private readonly registrationTimeoutMs: number;
  private readonly sessionId: string | undefined;
  private readonly gameId: string;
  private readonly gameMode: GameMode;
  private readonly gameTitle: string | undefined;
  private readonly allowTokens: readonly string[];
  private readonly consoleLimiter: RateLimiter;
  private readonly errorLimiter: RateLimiter;
  private readonly consoleSink: RateLimitedSink<{
    level: "debug" | "log" | "info" | "warn" | "error";
    message: string;
    details: string;
  }>;
  private readonly errorSink: RateLimitedSink<ErrorReport>;

  private frame: GameFrame | null = null;
  private currentSource = "";
  private registrationTimer: ReturnType<typeof setTimeout> | undefined;
  private registered = false;
  private destroyed = false;
  private readonly outgoing: RuntimeMessage[] = [];
  private readonly hook: { report: (kind: unknown, payload: unknown) => void };

  constructor(options: RuntimeInstanceOptions) {
    this.runtimeInstanceId = options.runtimeInstanceId;
    this.bootstrap = options.bootstrap;
    this.port = options.port;
    this.frameFactory = options.frameFactory;
    this.registrationTimeoutMs = options.registrationTimeoutMs ?? REGISTRATION_TIMEOUT_MS;
    this.sessionId = options.bootstrap.sessionId;
    this.gameId = options.bootstrap.gameId;
    this.gameMode = options.bootstrap.gameMode;
    this.gameTitle = options.bootstrap.gameTitle;
    this.allowTokens = options.bootstrap.permissions?.allow ?? [];
    const limiters = createRuntimeLimiters();
    this.consoleLimiter = limiters.console;
    this.errorLimiter = limiters.errors;
    this.consoleSink = new RateLimitedSink(this.consoleLimiter, (entry, dropped) => {
      this.send(
        buildConsoleMessage(this.runtimeInstanceId, entry.level, entry.message, {
          ...(entry.details.length > 0 ? { details: entry.details } : {}),
          ...(dropped > 0 ? { dropped } : {}),
          ...(this.sessionId !== undefined ? { sessionId: this.sessionId } : {}),
        }),
      );
    });
    this.errorSink = new RateLimitedSink(this.errorLimiter, (report, dropped) => {
      this.send(
        buildErrorMessage(this.runtimeInstanceId, report.category, report.message, {
          ...(report.details !== undefined ? { details: report.details } : {}),
          ...(dropped > 0 ? { details: { ...report.details, dropped } } : {}),
          ...(this.sessionId !== undefined ? { sessionId: this.sessionId } : {}),
        }),
      );
    });

    this.hook = { report: (kind, payload) => this.handleReport(kind, payload) };
    this.port.onmessage = (event: MessageEvent) => this.handlePortMessage(event.data);
    (
      globalThis as { __novaRuntime?: { report: (kind: unknown, payload: unknown) => void } }
    ).__novaRuntime = this.hook;

    this.send(buildReadyMessage(this.runtimeInstanceId, this.sessionId));
    this.startGame();
  }

  /** The game frame's window (test/observability hook, same-origin only). */
  getGameWindow(): Window | null {
    return this.frame?.window ?? null;
  }

  /** True once the instance has been torn down (destroy / replacement). */
  isDestroyed(): boolean {
    return this.destroyed;
  }

  /** The game frame is present (test/observability hook). */
  hasFrame(): boolean {
    return this.frame !== null;
  }

  /** Bounded history of messages this instance sent (test/observability). */
  outgoingMessages(): readonly RuntimeMessage[] {
    return this.outgoing;
  }

  /** Parent-controlled destroy: tear down the game and the channel. */
  destroy(reason?: string): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.clearRegistrationTimer();
    this.frame?.destroy();
    this.frame = null;
    delete (globalThis as { __novaRuntime?: unknown }).__novaRuntime;
    this.port.onmessage = null;
    this.send(buildLifecycleMessage(this.runtimeInstanceId, "destroyed", reason, this.sessionId));
    try {
      this.port.close();
    } catch {
      // Port already closed — host is gone.
    }
  }

  /** Page-visibility pause diagnostic (Mobile Safari backgrounding, B6). */
  pageVisibilityChanged(hidden: boolean): void {
    if (this.destroyed) return;
    this.send(
      buildLifecycleMessage(
        this.runtimeInstanceId,
        hidden ? "paused" : "resumed",
        hidden ? "page hidden" : "page visible",
        this.sessionId,
      ),
    );
  }

  private startGame(): void {
    const issue = classifyHtmlSource(this.bootstrap.gameSource);
    if (issue === "empty") {
      this.sendError("empty_source", "Game source is empty.");
      return;
    }
    if (issue === "missing_structure") {
      this.sendError(
        "invalid_html",
        "Game source has no <!doctype> or <html> tag; treating it as a fragment.",
      );
    }
    this.currentSource = this.bootstrap.gameSource;
    this.createFrame();
  }

  private createFrame(): void {
    if (this.destroyed) return;
    this.frame?.destroy();
    this.frame = this.frameFactory.create(
      this.injectedSource(this.currentSource),
      this.allowTokens,
    );
    this.send(buildLifecycleMessage(this.runtimeInstanceId, "created", undefined, this.sessionId));
    this.send(buildLifecycleMessage(this.runtimeInstanceId, "loaded", undefined, this.sessionId));
    this.armRegistrationTimer();
  }

  private injectedSource(html: string): string {
    // The validated bootstrap player identity is injected before the bridge
    // script so `window.nova.player` is correct from the first game tick
    // (same-origin forwarding of data the host already validated; the game
    // frame never sees the host origin).
    const identity = JSON.stringify({
      memberId: this.bootstrap.player.memberId,
      displayName: this.bootstrap.player.displayName,
    });
    return `<script>window.__novaBootstrap = { player: ${identity} };</script>\n<script>\n${NOVA_BRIDGE_SCRIPT}\n</script>\n${html}`;
  }

  private armRegistrationTimer(): void {
    this.clearRegistrationTimer();
    this.registrationTimer = setTimeout(() => {
      this.registrationTimer = undefined;
      if (!this.registered && !this.destroyed) {
        this.sendError(
          "missing_registration",
          `Game did not call nova.defineGame within ${this.registrationTimeoutMs}ms.`,
        );
      }
    }, this.registrationTimeoutMs);
  }

  private clearRegistrationTimer(): void {
    if (this.registrationTimer !== undefined) {
      clearTimeout(this.registrationTimer);
      this.registrationTimer = undefined;
    }
  }

  private handlePortMessage(data: unknown): void {
    if (this.destroyed) return;
    const parsed = parseRuntimeMessage(data);
    if (!parsed.ok) {
      this.sendError("security", `Rejected invalid runtime message: ${parsed.error.message}`);
      return;
    }
    switch (parsed.value.type) {
      case "runtime.ping":
        this.send(buildPongMessage(this.runtimeInstanceId, this.sessionId));
        break;
      case "runtime.reload":
        this.reload();
        break;
      case "game.end":
        this.destroy(parsed.value.reason);
        break;
      case "game.apiEvent":
        this.handleApiEvent(parsed.value.event);
        break;
      default:
        this.sendError(
          "security",
          `Unexpected message type "${parsed.value.type}" from host on the runtime channel.`,
        );
    }
  }

  private reload(): void {
    if (this.destroyed) return;
    this.registered = false;
    this.clearRegistrationTimer();
    const issue = classifyHtmlSource(this.currentSource);
    if (issue === "empty") {
      this.frame?.destroy();
      this.frame = null;
      this.sendError("empty_source", "Game source is empty.");
      return;
    }
    this.frame?.destroy();
    this.frame = this.frameFactory.create(
      this.injectedSource(this.currentSource),
      this.allowTokens,
    );
    this.send(buildLifecycleMessage(this.runtimeInstanceId, "reloaded", undefined, this.sessionId));
    this.armRegistrationTimer();
  }

  private handleReport(kind: unknown, payload: unknown): void {
    if (this.destroyed) return;
    switch (kind) {
      case "defineGame":
        this.handleDeclaration(payload);
        break;
      case "ready":
      case "dispatch":
      case "raw.createChannel":
      case "raw.send":
      case "simulation.register":
      case "simulation.sendInput":
        this.handleApiCall(kind, payload);
        break;
      case "error":
        this.handleGameError(payload);
        break;
      case "unhandledrejection":
        this.handleRejection(payload);
        break;
      case "console":
        this.handleConsole(payload);
        break;
      default:
        // Unknown report kind — ignore silently (game-originated junk).
        break;
    }
  }

  private handleDeclaration(payload: unknown): void {
    if (this.registered) return;
    const options = (payload as { options?: unknown } | null | undefined)?.options;
    if (options === null || options === undefined) {
      this.sendError(
        "runtime",
        "nova.defineGame was called without options; registration ignored.",
      );
      return;
    }
    const parsed = gameDeclarationSchema.safeParse(options);
    if (!parsed.success) {
      this.sendError("runtime", "nova.defineGame options failed validation; registration ignored.");
      return;
    }
    const declaration = parsed.data as GameDeclaration;
    // Unsupported Nova API version fails registration with a clear error
    // (S1 policy: unknown versions fail rather than being guessed at).
    // The message keeps the U4 diagnostics prefix for the editor panel.
    if (
      declaration.apiVersion !== undefined &&
      !SUPPORTED_NOVA_API_VERSIONS.includes(declaration.apiVersion)
    ) {
      this.sendError(
        "unsupported",
        `Unsupported Nova API version ${declaration.apiVersion}. Supported versions: [${SUPPORTED_NOVA_API_VERSIONS.join(", ")}]. Registration ignored.`,
      );
      return;
    }
    const fields = registrationFields({
      bootstrapGameId: this.gameId,
      bootstrapGameMode: this.gameMode,
      bootstrapTitle: this.gameTitle,
      declaration,
    });
    this.registered = true;
    this.clearRegistrationTimer();
    this.send(buildRegistrationMessage(this.runtimeInstanceId, fields, this.sessionId));
    this.send(buildLifecycleMessage(this.runtimeInstanceId, "started", undefined, this.sessionId));
  }

  /**
   * A forwarded Nova API call: validate the payload (never trust game
   * input), then forward it to the host session router (U6/P1) as a
   * `game.apiCall` message. The host routes the call into this game's
   * NovaSession over the transport; host-pushed events come back as
   * `game.apiEvent`. Never dropped silently.
   */
  private handleApiCall(method: NovaApiCallMethod, payload: unknown): void {
    const parsed = novaApiCallSchemas[method].safeParse(payload);
    if (!parsed.success) {
      this.sendError("runtime", `nova.${method}() call failed validation; ignored.`);
      return;
    }
    this.send(buildApiCallMessage(this.runtimeInstanceId, method, parsed.data, this.sessionId));
  }

  /**
   * A host-pushed session event (`game.apiEvent`): deliver it into the game
   * frame through the same-origin bridge hook. Events only flow after the
   * game registered (the host joins the session on registration), so the
   * bridge is installed by the time the first event arrives; a missing
   * frame (torn down between messages) drops the event safely.
   */
  private handleApiEvent(event: GameApiEventMessage["event"]): void {
    const bridge = this.frame?.window as
      | (Window & { __novaGameBridge?: { receive?: (kind: string, payload: unknown) => void } })
      | null
      | undefined;
    try {
      bridge?.__novaGameBridge?.receive?.(event.kind, event);
    } catch {
      // Game-originated handler exceptions never break the runtime loop.
    }
  }

  private handleGameError(payload: unknown): void {
    const p = (payload ?? {}) as {
      message?: unknown;
      filename?: unknown;
      lineno?: unknown;
      colno?: unknown;
      tag?: unknown;
    };
    const tag = typeof p.tag === "string" ? p.tag.slice(0, 32) : "";
    const message = typeof p.message === "string" ? p.message.slice(0, 512) : "Script error";
    const details: Record<string, unknown> = {};
    if (typeof p.filename === "string" && p.filename.length > 0) {
      details.filename = p.filename.slice(0, 512);
    }
    if (typeof p.lineno === "number") details.lineno = p.lineno;
    if (typeof p.colno === "number") details.colno = p.colno;
    if (tag.length > 0) details.resource = tag;

    let category: ErrorReport["category"];
    if (tag.length > 0) {
      category = "remote_load";
    } else if (message.startsWith("SyntaxError")) {
      category = "syntax";
    } else {
      category = "runtime";
    }
    this.sendError(category, message, details);
  }

  private handleRejection(payload: unknown): void {
    const p = (payload ?? {}) as { message?: unknown };
    const message =
      typeof p.message === "string" && p.message.length > 0
        ? p.message.slice(0, 512)
        : "Unhandled promise rejection";
    this.sendError("runtime", `Unhandled rejection: ${message}`);
  }

  private handleConsole(payload: unknown): void {
    const p = (payload ?? {}) as { level?: unknown; args?: unknown };
    const level = typeof p.level === "string" ? p.level : "";
    if (
      level !== "debug" &&
      level !== "log" &&
      level !== "info" &&
      level !== "warn" &&
      level !== "error"
    ) {
      return;
    }
    // The injected bridge always sends an args array; anything else is
    // game-originated junk and is ignored at the boundary.
    if (!("args" in p) || !Array.isArray(p.args)) {
      return;
    }
    const serialized = serializeConsoleArgs(p.args);
    this.consoleSink.send({ level, ...serialized });
  }

  private sendError(
    category: Parameters<typeof buildErrorMessage>[1],
    message: string,
    details?: Record<string, unknown>,
  ): void {
    this.errorSink.send({ category, message, details });
  }

  private send(message: RuntimeMessage): void {
    if (this.destroyed && message.type !== "game.lifecycle") return;
    try {
      this.port.postMessage(message);
      this.outgoing.push(message);
      if (this.outgoing.length > OUTGOING_LOG_LIMIT) {
        this.outgoing.splice(0, this.outgoing.length - OUTGOING_LOG_LIMIT);
      }
    } catch {
      // Port closed — host is gone.
    }
  }
}
