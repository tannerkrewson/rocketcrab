/**
 * Host-side runtime bridge (U3 "bridge" half).
 *
 * A small versioned RPC layer over a dedicated MessageChannel (F4 spike
 * shape, F6 schemas) that the Nova shell uses to embed the runtime origin
 * (ADR-0001) and control game execution:
 *
 * - embeds the runtime iframe on the separate runtime origin;
 * - performs the exact-origin postMessage bootstrap, transferring one
 *   dedicated MessageChannel per runtime instance;
 * - sends validated protocol messages (bootstrap / ping / reload / end);
 * - validates every inbound message with `parseRuntimeMessage`;
 * - keeps a heartbeat (missed pongs -> `unresponsive` event) so a wedged
 *   runtime is visible to the shell (threat model T6);
 * - exposes parent-controlled load / reload / destroy / restart and a
 *   composed `diagnose()` for pause/suspend diagnostics (ADR-0012, B6);
 * - never leaks secrets: game HTML and game-declared metadata are forwarded
 *   only through validated protocol messages, and the runtime origin is
 *   never handed main-origin credentials.
 *
 * Comlink was evaluated against this handshake (F4 design note) and not
 * adopted: it has no message validation (it would bypass the protocol
 * boundary), no explicit lifecycle control (destroy/reload/restart), and
 * no restart semantics. See apps/runtime/README.md.
 */
import {
  PROTOCOL_VERSION,
  assertRuntimeMessage,
  gameApiEventMessageSchema,
  parseRuntimeMessage,
  runtimeBootstrapMessageSchema,
  type GameApiCallMessage,
  type GameApiEvent,
  type GameLifecycleEventMessage,
  type GameMetadataMessage,
  type GameMode,
  type GameRegistrationMessage,
  type RuntimeBootstrapMessage,
  type RuntimeConsoleMessage,
  type RuntimeErrorMessage,
  type RuntimeMessage,
} from "@rocketcrab/protocol";
import { runtimeBasePath } from "./runtime-origin";

/** Minimal port surface the bridge drives (real MessagePorts satisfy it). */
export interface ChannelPort {
  postMessage(message: unknown): void;
  close(): void;
  onmessage: ((event: MessageEvent) => void) | null;
  onmessageerror: ((event: MessageEvent) => void) | null;
}

export type RuntimeHostEvent =
  | { type: "ready"; message: RuntimeReadinessMessageEvent }
  | { type: "registration"; message: GameRegistrationMessage }
  | { type: "metadata"; message: GameMetadataMessage }
  | { type: "error"; message: RuntimeErrorMessage }
  | { type: "console"; message: RuntimeConsoleMessage }
  | { type: "lifecycle"; message: GameLifecycleEventMessage }
  | { type: "apiCall"; message: GameApiCallMessage }
  | { type: "unresponsive" }
  | { type: "responsive" }
  | { type: "port-closed" }
  | { type: "fatal"; message: string };

type RuntimeReadinessMessageEvent = Extract<RuntimeMessage, { type: "runtime.ready" }>;

export interface LoadGameInput {
  gameId: string;
  gameMode: GameMode;
  gameSource: string;
  player: { memberId: string; displayName: string };
  gameTitle?: string;
  permissions?: { allow: string[] };
  sessionId?: string;
}

export interface RuntimeHostOptions {
  /** Full origin of the runtime app (dev: http://localhost:5174). */
  runtimeOrigin: string;
  /** Element that hosts the runtime iframe. */
  container: HTMLElement;
  /** Event sink for validated runtime-plane events. */
  onEvent: (event: RuntimeHostEvent) => void;
  heartbeatIntervalMs?: number;
  missedPongsBeforeUnresponsive?: number;
  bootstrapTimeoutMs?: number;
  /** Test seam: how to wait for the runtime iframe to load. */
  waitForFrameLoad?: (iframe: HTMLIFrameElement) => Promise<void>;
  /** Test seam: jsdom has no MessageChannel. */
  createChannel?: () => { port1: ChannelPort; port2: unknown };
}

export interface RuntimeDiagnostic {
  ready: boolean;
  unresponsive: boolean;
  missedPongs: number;
  runtimeInstanceId: string | null;
  hasRuntimeFrame: boolean;
  lastEvent: RuntimeHostEvent | null;
  recentEvents: RuntimeHostEvent[];
}

const DEFAULT_HEARTBEAT_INTERVAL_MS = 1_000;
const DEFAULT_MISSED_PONGS_BEFORE_UNRESPONSIVE = 3;
const DEFAULT_BOOTSTRAP_TIMEOUT_MS = 10_000;

function newMessageId(): string {
  return crypto.randomUUID();
}

function buildBootstrapMessage(
  game: LoadGameInput,
  runtimeInstanceId: string,
  sessionId: string | undefined,
): RuntimeBootstrapMessage {
  const message = runtimeBootstrapMessageSchema.parse({
    version: PROTOCOL_VERSION,
    runtimeInstanceId,
    ...(sessionId !== undefined ? { sessionId } : {}),
    messageId: newMessageId(),
    sentAt: Date.now(),
    type: "runtime.bootstrap",
    gameId: game.gameId,
    ...(game.gameTitle !== undefined ? { gameTitle: game.gameTitle } : {}),
    gameMode: game.gameMode,
    gameSource: game.gameSource,
    player: game.player,
    ...(game.permissions !== undefined ? { permissions: game.permissions } : {}),
  });
  assertRuntimeMessage(message); // never emit an unvalidated message
  return message;
}

function buildPingMessage(
  runtimeInstanceId: string,
  sessionId: string | undefined,
): RuntimeMessage {
  return assertRuntimeMessage({
    version: PROTOCOL_VERSION,
    runtimeInstanceId,
    ...(sessionId !== undefined ? { sessionId } : {}),
    messageId: newMessageId(),
    sentAt: Date.now(),
    type: "runtime.ping",
  });
}

function buildReloadMessage(
  runtimeInstanceId: string,
  sessionId: string | undefined,
): RuntimeMessage {
  return assertRuntimeMessage({
    version: PROTOCOL_VERSION,
    runtimeInstanceId,
    ...(sessionId !== undefined ? { sessionId } : {}),
    messageId: newMessageId(),
    sentAt: Date.now(),
    type: "runtime.reload",
  });
}

function buildEndGameMessage(
  runtimeInstanceId: string,
  sessionId: string | undefined,
  reason: "user_exit" | "host_closed" | "error",
): RuntimeMessage {
  return assertRuntimeMessage({
    version: PROTOCOL_VERSION,
    runtimeInstanceId,
    ...(sessionId !== undefined ? { sessionId } : {}),
    messageId: newMessageId(),
    sentAt: Date.now(),
    type: "game.end",
    reason,
  });
}

export class RuntimeHostClient {
  readonly runtimeOrigin: string;
  private readonly container: HTMLElement;
  private readonly onEvent: (event: RuntimeHostEvent) => void;
  private readonly heartbeatIntervalMs: number;
  private readonly missedPongsBeforeUnresponsive: number;
  private readonly bootstrapTimeoutMs: number;
  private readonly waitForFrameLoad: (iframe: HTMLIFrameElement) => Promise<void>;
  private readonly createChannel: () => { port1: ChannelPort; port2: unknown };

  private iframe: HTMLIFrameElement | null = null;
  private port: ChannelPort | null = null;
  private runtimeInstanceId: string | null = null;
  private sessionId: string | undefined;
  private ready = false;
  private unresponsive = false;
  private missedPongs = 0;
  private heartbeatTimer: number | undefined;
  private pageHidden = false;
  private readonly lifecycleUnsubscribers: Array<() => void> = [];
  private lastGame: LoadGameInput | null = null;
  private lastEvent: RuntimeHostEvent | null = null;
  private readonly recentEvents: RuntimeHostEvent[] = [];
  private readonly recentEventsLimit = 50;

  constructor(options: RuntimeHostOptions) {
    this.runtimeOrigin = options.runtimeOrigin;
    this.container = options.container;
    this.onEvent = options.onEvent;
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;
    this.missedPongsBeforeUnresponsive =
      options.missedPongsBeforeUnresponsive ?? DEFAULT_MISSED_PONGS_BEFORE_UNRESPONSIVE;
    this.bootstrapTimeoutMs = options.bootstrapTimeoutMs ?? DEFAULT_BOOTSTRAP_TIMEOUT_MS;
    this.waitForFrameLoad = options.waitForFrameLoad ?? defaultWaitForFrameLoad;
    this.createChannel =
      options.createChannel ??
      (() => {
        const channel = new MessageChannel();
        return { port1: channel.port1, port2: channel.port2 };
      });
    // Page-visibility awareness (M1, ADR-0012): Mobile Safari suspends
    // timers while the page is backgrounded, so the heartbeat must not
    // accumulate missed pongs (or fire at all) while hidden; it pauses and
    // re-syncs with an immediate ping on return.
    if (typeof window !== "undefined") {
      const onVisibility = (): void => this.setPageVisibility(document.hidden);
      const onPageHide = (): void => this.setPageVisibility(true);
      const onPageShow = (): void => this.setPageVisibility(false);
      window.addEventListener("visibilitychange", onVisibility);
      window.addEventListener("pagehide", onPageHide);
      window.addEventListener("pageshow", onPageShow);
      this.lifecycleUnsubscribers.push(
        () => window.removeEventListener("visibilitychange", onVisibility),
        () => window.removeEventListener("pagehide", onPageHide),
        () => window.removeEventListener("pageshow", onPageShow),
      );
    }
  }

  /**
   * Page visibility for the heartbeat (Mobile Safari backgrounding). While
   * hidden the heartbeat pauses; on return it resets the missed-pong
   * counter and pings immediately so a stale "unresponsive" state never
   * survives a background/foreground cycle. Wired to the browser's
   * visibility/pagehide/pageshow events and exposed publicly for tests.
   */
  setPageVisibility(hidden: boolean): void {
    this.pageHidden = hidden;
    if (hidden) {
      this.stopHeartbeat();
      return;
    }
    this.missedPongs = 0;
    if (this.ready && this.port && this.runtimeInstanceId !== null) {
      // Re-sync immediately instead of waiting for the next interval tick.
      this.send(buildPingMessage(this.runtimeInstanceId, this.sessionId));
    }
    this.startHeartbeat();
  }

  /**
   * Embed the runtime iframe, perform the exact-origin bootstrap with a
   * dedicated MessageChannel, and resolve once the runtime reports ready.
   */
  async load(game: LoadGameInput): Promise<void> {
    this.lastGame = game;
    // A fresh bootstrap starts a fresh runtime instance on a fresh channel:
    // establish the channel (and its handler) before the frame handshake so
    // no runtime reply can be missed.
    if (this.port) {
      this.port.onmessage = null;
      this.port.onmessageerror = null;
      this.port.close();
    }
    const channel = this.createChannel();
    this.port = channel.port1;
    this.port.onmessage = (event: MessageEvent) => this.handleMessage(event.data);
    this.port.onmessageerror = () => this.emit({ type: "port-closed" });
    this.runtimeInstanceId = newMessageId();
    this.sessionId = game.sessionId;
    this.ready = false;
    this.missedPongs = 0;
    this.unresponsive = false;

    const frame = await this.ensureFrame();
    frame.contentWindow?.postMessage(
      buildBootstrapMessage(game, this.runtimeInstanceId, this.sessionId),
      this.runtimeOrigin,
      [channel.port2 as Transferable],
    );
    await this.waitForReady();
  }

  /** Parent-controlled reload: re-run the current game in a clean frame. */
  reload(): void {
    this.send(buildReloadMessage(this.requireInstanceId(), this.sessionId));
  }

  /**
   * Parent-controlled destroy: ask the runtime to tear the game down, then
   * hard-remove the runtime frame and the channel (the stop control lives
   * outside the frame and cannot be disabled by game code — T6/T21).
   */
  destroy(reason: "user_exit" | "host_closed" | "error" = "user_exit"): void {
    this.stopHeartbeat();
    if (this.port && this.runtimeInstanceId) {
      this.send(buildEndGameMessage(this.runtimeInstanceId, this.sessionId, reason));
    }
    this.teardownFrame();
  }

  /** Hard destroy then a fresh bootstrap with the last game (recovery). */
  async restart(): Promise<void> {
    const game = this.lastGame;
    this.destroy("host_closed");
    if (game) {
      await this.load(game);
    }
  }

  /** Composed pause/suspend diagnostic for the shell (ADR-0012, B6). */
  diagnose(): RuntimeDiagnostic {
    return {
      ready: this.ready,
      unresponsive: this.unresponsive,
      missedPongs: this.missedPongs,
      runtimeInstanceId: this.runtimeInstanceId,
      hasRuntimeFrame: this.iframe !== null,
      lastEvent: this.lastEvent,
      recentEvents: [...this.recentEvents],
    };
  }

  /**
   * Push one session event into the runtime frame (U6 session router): the
   * host-side NovaSession emits events (player joins, connection changes,
   * start/end, raw messages, simulation inputs, errors) and this bridge
   * forwards them over the instance channel as a validated `game.apiEvent`
   * message; the runtime delivers them to the game frame's `window.nova`
   * handlers. No-op when the runtime is not running.
   */
  pushApiEvent(event: GameApiEvent): void {
    if (!this.port || this.runtimeInstanceId === null) {
      return;
    }
    const message = assertRuntimeMessage(
      gameApiEventMessageSchema.parse({
        version: PROTOCOL_VERSION,
        runtimeInstanceId: this.runtimeInstanceId,
        ...(this.sessionId !== undefined ? { sessionId: this.sessionId } : {}),
        messageId: newMessageId(),
        sentAt: Date.now(),
        type: "game.apiEvent",
        event,
      }),
    );
    this.send(message);
  }

  /** Remove the frame and all listeners without sending further messages. */
  dispose(): void {
    this.stopHeartbeat();
    for (const unsubscribe of this.lifecycleUnsubscribers) {
      unsubscribe();
    }
    this.lifecycleUnsubscribers.length = 0;
    this.teardownFrame();
  }

  private async ensureFrame(): Promise<HTMLIFrameElement> {
    if (this.iframe) {
      return this.iframe;
    }
    const iframe = document.createElement("iframe");
    // The runtime iframe runs the runtime app (scripts + same-origin with
    // itself) and must never navigate the parent; permission delegation
    // carries through to the game frame one hop below (F4 finding).
    iframe.setAttribute("sandbox", "allow-scripts allow-same-origin");
    iframe.setAttribute("allow", "camera; microphone; clipboard-read; clipboard-write; fullscreen");
    iframe.allowFullscreen = true;
    iframe.setAttribute("title", "game runtime");
    iframe.style.cssText = "width:100%;height:100%;border:0;display:block";
    this.iframe = iframe;
    this.container.appendChild(iframe);
    // runtimeBasePath() is "/" by default; project-site runtime layouts
    // (M2 deployment strategies (b)/(c)) pin it via VITE_RUNTIME_BASE.
    iframe.src = `${this.runtimeOrigin}${runtimeBasePath()}`;
    try {
      await this.waitForFrameLoad(iframe);
    } catch (error) {
      this.iframe = null;
      throw error;
    }
    return iframe;
  }

  private waitForReady(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.ready) {
        // The runtime may have replied before this promise was set up.
        this.startHeartbeat();
        resolve();
        return;
      }
      this.readyResolver = resolve;
      this.readyTimer = window.setTimeout(() => {
        this.readyResolver = null;
        this.readyTimer = undefined;
        reject(new Error(`Runtime bootstrap timed out after ${this.bootstrapTimeoutMs}ms.`));
      }, this.bootstrapTimeoutMs);
    });
  }

  private readyResolver: (() => void) | null = null;
  private readyTimer: number | undefined;

  private handleMessage(data: unknown): void {
    const parsed = parseRuntimeMessage(data);
    if (!parsed.ok) {
      this.emit({
        type: "fatal",
        message: `Rejected invalid runtime message: ${parsed.error.message}`,
      });
      return;
    }
    const message = parsed.value;
    switch (message.type) {
      case "runtime.ready":
        this.ready = true;
        this.emit({ type: "ready", message });
        this.resolveReady();
        break;
      case "runtime.pong":
        this.missedPongs = 0;
        if (this.unresponsive) {
          this.unresponsive = false;
          this.emit({ type: "responsive" });
        }
        break;
      case "game.registration":
        this.emit({ type: "registration", message });
        break;
      case "game.metadata":
        this.emit({ type: "metadata", message });
        break;
      case "runtime.error":
        this.emit({ type: "error", message });
        break;
      case "runtime.console":
        this.emit({ type: "console", message });
        break;
      case "game.lifecycle":
        this.emit({ type: "lifecycle", message });
        break;
      case "game.apiCall":
        this.emit({ type: "apiCall", message });
        break;
      default:
        // The runtime never sends bootstrap/ping/reload/end back; ignore.
        break;
    }
  }

  private resolveReady(): void {
    if (this.readyResolver) {
      if (this.readyTimer !== undefined) {
        window.clearTimeout(this.readyTimer);
        this.readyTimer = undefined;
      }
      const resolve = this.readyResolver;
      this.readyResolver = null;
      resolve();
      this.startHeartbeat();
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    if (this.pageHidden) {
      // Timers are unreliable while backgrounded (ADR-0012/B6); the
      // heartbeat resumes on setPageVisibility(false).
      return;
    }
    this.heartbeatTimer = window.setInterval(() => {
      if (!this.port || !this.ready) return;
      this.missedPongs += 1;
      this.send(buildPingMessage(this.requireInstanceId(), this.sessionId));
      if (this.missedPongs >= this.missedPongsBeforeUnresponsive && !this.unresponsive) {
        this.unresponsive = true;
        this.emit({ type: "unresponsive" });
      }
    }, this.heartbeatIntervalMs);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer !== undefined) {
      window.clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
  }

  private teardownFrame(): void {
    if (this.port) {
      this.port.onmessage = null;
      this.port.onmessageerror = null;
      this.port.close();
      this.port = null;
    }
    if (this.iframe) {
      this.iframe.remove();
      this.iframe = null;
    }
    this.ready = false;
    this.runtimeInstanceId = null;
  }

  private requireInstanceId(): string {
    if (this.runtimeInstanceId === null) {
      throw new Error("RuntimeHostClient is not started; call load() first.");
    }
    return this.runtimeInstanceId;
  }

  private send(message: RuntimeMessage): void {
    if (!this.port) return;
    try {
      this.port.postMessage(message);
    } catch {
      // Port closed — runtime is gone.
    }
  }

  private emit(event: RuntimeHostEvent): void {
    this.lastEvent = event;
    this.recentEvents.push(event);
    if (this.recentEvents.length > this.recentEventsLimit) {
      this.recentEvents.shift();
    }
    this.onEvent(event);
  }
}

function defaultWaitForFrameLoad(iframe: HTMLIFrameElement): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      reject(new Error("Runtime iframe load timed out."));
    }, 10_000);
    iframe.addEventListener(
      "load",
      () => {
        window.clearTimeout(timeout);
        resolve();
      },
      { once: true },
    );
  });
}
