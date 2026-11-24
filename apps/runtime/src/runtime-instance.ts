/**
 * Per-bootstrap execution context: owns the channel, sandboxed frame,
 * bridge hook, registration timeout, and rate-limited reporting. Revalidate
 * all game-originated data before forwarding it to the host.
 */
import {
  parseRuntimeMessage,
  runtimeGameDeclarationSchema,
  novaApiCallSchemas,
  type NovaApiCallMethod,
  type GameApiEventMessage,
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
  registrationFields,
  serializeConsoleArgs,
} from "./nova-bridge";
import { RateLimitedSink, createRuntimeLimiters } from "./rate-limiter";

/** Bounded protocol-message history kept for tests and diagnostics. */
const OUTGOING_LOG_LIMIT = 500;

/** How long the runtime waits for `nova.defineGame` before reporting. */
const REGISTRATION_TIMEOUT_MS = 10_000;

/** A port we can drive from tests (real MessagePorts satisfy this). */
export interface PortLike {
  postMessage(message: unknown): void;
  close(): void;
  onmessage: ((event: MessageEvent) => void) | null;
  onmessageerror?: ((event: MessageEvent) => void) | null;
}

interface GameFrame {
  readonly window: Window | null;
  destroy(): void;
}

/** Creates game frames; the real implementation lives in `main.ts`. */
export interface FrameFactory {
  create(source: string, allowTokens: readonly string[]): GameFrame;
}

interface RuntimeInstanceOptions {
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
  private readonly gameTitle: string | undefined;
  private readonly allowTokens: readonly string[];
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
    this.gameTitle = options.bootstrap.gameTitle;
    this.allowTokens = options.bootstrap.permissions?.allow ?? [];
    const limiters = createRuntimeLimiters();
    this.consoleSink = new RateLimitedSink(limiters.console, (entry, dropped) => {
      this.send(
        buildConsoleMessage(this.runtimeInstanceId, entry.level, entry.message, {
          ...(entry.details.length > 0 ? { details: entry.details } : {}),
          ...(dropped > 0 ? { dropped } : {}),
          ...(this.sessionId !== undefined ? { sessionId: this.sessionId } : {}),
        }),
      );
    });
    this.errorSink = new RateLimitedSink(limiters.errors, (report, dropped) => {
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

  isDestroyed(): boolean {
    return this.destroyed;
  }

  hasFrame(): boolean {
    return this.frame !== null;
  }

  /** Bounded history of messages this instance sent (test/observability). */
  outgoingMessages(): readonly RuntimeMessage[] {
    return this.outgoing;
  }

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

  /** Page-visibility pause diagnostic: mobile browsers suspend backgrounded pages. */
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
    // Inject identity before the bridge so window.nova.player is correct immediately.
    // JSON string escaping alone does not stop HTML's script end-tag parser.
    // Names are player-controlled and may contain </script>.
    const identity = JSON.stringify({
      memberId: this.bootstrap.player.memberId,
      displayName: this.bootstrap.player.displayName,
    }).replace(/</g, "\\u003c");
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
      case "controls.set":
      case "stateResponse":
        this.handleApiCall(kind, payload);
        break;
      case "error":
        this.handleGameError(payload);
        break;
      case "viewError":
        this.handleViewError(payload);
        break;
      case "unhandledrejection":
        this.handleRejection(payload);
        break;
      case "console":
        this.handleConsole(payload);
        break;
      default:
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
    const parsed = runtimeGameDeclarationSchema.safeParse(options);
    if (!parsed.success) {
      this.sendError("runtime", "nova.defineGame options failed validation; registration ignored.");
      return;
    }
    const declaration = parsed.data;
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
      bootstrapTitle: this.gameTitle,
      declaration,
    });
    this.registered = true;
    this.clearRegistrationTimer();
    this.send(buildRegistrationMessage(this.runtimeInstanceId, fields, this.sessionId));
    this.send(buildLifecycleMessage(this.runtimeInstanceId, "started", undefined, this.sessionId));
  }

  /** Validate game API calls before forwarding to the host; never silently drop failures. */
  private handleApiCall(method: NovaApiCallMethod, payload: unknown): void {
    const parsed = novaApiCallSchemas[method].safeParse(payload);
    if (!parsed.success) {
      this.sendError("runtime", `nova.${method}() call failed validation; ignored.`);
      return;
    }
    this.send(buildApiCallMessage(this.runtimeInstanceId, method, parsed.data, this.sessionId));
  }

  /**
   * Deliver validated host events through the same-origin bridge. Events begin
   * after registration, when the bridge is already installed; safely drop them
   * if teardown has removed the frame.
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

  /**
   * A selectView failure for one viewer. Non-fatal: only that viewer lacks a
   * view, so the run continues.
   */
  private handleViewError(payload: unknown): void {
    const p = (payload ?? {}) as { memberId?: unknown; message?: unknown };
    const memberId = typeof p.memberId === "string" ? p.memberId.slice(0, 128) : "unknown";
    const message = typeof p.message === "string" ? p.message.slice(0, 256) : "selectView failed";
    this.sendError("game", `selectView failed for member ${memberId}: ${message}`, {
      memberId,
    });
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
    } catch (error) {
      // Surface clone/send failures so dispatch promises cannot wait forever.
      // Do not recurse if reporting the failure also fails.
      if (message.type !== "runtime.error") {
        const what = message.type === "game.apiCall" ? `nova.${message.method}()` : message.type;
        const reason = error instanceof Error ? error.message : String(error);
        this.sendError(
          "game",
          `${what} could not be delivered to the host: ${reason.slice(0, 256)}`,
        );
      }
      return;
    }
    this.outgoing.push(message);
    if (this.outgoing.length > OUTGOING_LOG_LIMIT) {
      this.outgoing.splice(0, this.outgoing.length - OUTGOING_LOG_LIMIT);
    }
  }
}
