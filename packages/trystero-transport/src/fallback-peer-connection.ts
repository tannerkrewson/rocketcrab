/**
 * Connection fallback wrapper for Trystero's `rtcPolyfill` (PLAN.md §5.5).
 *
 * `createFallbackPeerConnectionClass` returns a constructor that delegates to
 * the browser's real RTCPeerConnection. When a pair's data channel has not
 * opened within `fallbackAfterMs` of both descriptions existing, or the native
 * connection reports `failed`, the pair's single data channel moves onto the
 * edge tunnel (`/tunnel/:pairId`, see deploy/edge/tunnel.ts). Trystero keeps
 * the same channel object and sees `connecting` until the tunnel reports
 * `paired`, then `connected`.
 *
 * Rules that follow from the Trystero 0.27 code (`peer.mjs`, `strategy.mjs`):
 * - "Healthy" means the data channel has opened, and nothing else. Trystero
 *   needs an open channel. A peer connection that is connected while the
 *   channel stays closed (for example SCTP blackholed) must not stall.
 * - The timer starts only once BOTH descriptions exist. Initiator offers are
 *   pooled before a remote description exists (PLAN.md §5.1).
 * - `failed` and `disconnected` are never shown to Trystero while the pair is
 *   switching or tunnelled. Trystero closes a peer on either. Mid-session
 *   `disconnected` after the pair has connected is passed through; there is no
 *   switch mid-session (PLAN.md §5.5).
 * - A native channel close before its first open is held back until the
 *   deadline decides, so it cannot hide a dead peer for longer than that.
 * - The native connection is NOT closed at the switch. Closing it would send a
 *   DTLS close, and a partner still on native WebRTC would tear the peer down.
 * - The switch is one-way for the connection's lifetime.
 * - One data channel per connection. Trystero uses exactly one.
 * - Sends are paced to the edge's per-socket budget (see the pace constants).
 * - Each instance reports one connection outcome at most (`onOutcome`, PLAN.md
 *   §8.2). The first success or failure claims it; a later event cannot.
 *
 * The transport wires this in through `rtcPolyfill` (trystero-transport.ts,
 * PLAN.md §5.6).
 */
import type { SessionSecret } from "@rocketcrab/protocol";
import {
  TUNNEL_FRAME_OVERHEAD_BYTES,
  TunnelCipher,
  TunnelFrameError,
  computeTunnelPairing,
  decodeTunnelMessage,
  deriveTunnelKeys,
  encodeTunnelMessage,
  type TunnelFrameErrorCode,
} from "./tunnel-crypto";
import { selectedCandidateOutcome } from "./selected-candidate-outcome";

/**
 * Client-side cap on a whole binary frame. The edge accepts up to 262208
 * bytes (MAX_TUNNEL_FRAME_BYTES in deploy/edge/tunnel.ts); this stays at the
 * stricter 256 KiB so a frame is never rejected by the server.
 */
export const TUNNEL_MAX_FRAME_BYTES = 262144;
/**
 * Client-side pacing of tunnel frames, in wire bytes (payload + 29). The edge
 * gives each socket a 512 KiB/s refill and a 4 MiB burst, and closes the pair
 * with 1008 when its bucket empties (deploy/edge/tunnel.ts RATE_BYTES_PER_SECOND
 * and BURST_BYTES). These sit below both, so repeated 2 MiB game-source
 * transfers never empty the server's bucket.
 */
export const TUNNEL_PACE_BYTES_PER_SECOND = 448 * 1024;
export const TUNNEL_PACE_BURST_BYTES = 3.5 * 1024 * 1024;
/** Delay from both descriptions existing to the tunnel fallback (PLAN.md §5). */
export const FALLBACK_AFTER_MS = 8000;
/** Server text frame that marks a completed pair. Any other text is fatal. */
export const TUNNEL_PAIRED_FRAME = "paired";

const LOW_WATER_POLL_MS = 10;
/**
 * A graceful close (Trystero leaving) gets this long to deliver frames that are
 * already queued. Terminal failures never wait. The flush stays paced, because
 * an unpaced burst could empty the server's bucket and close the pair with 1008.
 */
const GRACEFUL_FLUSH_MS = 2000;

/** A cancellable wait, so teardown can wake a waiter. */
interface PauseSlot {
  timer?: unknown;
  wake?: () => void;
}
/**
 * The edge answers 409 while a previous socket on the same pairId is still
 * closing. A browser reports that as a failed open with no status, so it is
 * retried: up to OPEN_ATTEMPTS tries, backing off from OPEN_RETRY_BASE_MS
 * (doubling), and never scheduling a retry past the fallback deadline.
 */
export const OPEN_ATTEMPTS = 5;
export const OPEN_RETRY_BASE_MS = 250;
/**
 * How long a native open waits for its selected-pair read (`getStats`) before
 * the outcome is `unknown` (PLAN.md §8.2). The outcome is claimed at open
 * either way; only the path resolves late.
 */
export const STATS_TIMEOUT_MS = 2000;
const WS_CONNECTING = 0;
const WS_OPEN = 1;
/** Close codes a browser accepts: 1000, or 3000-4999 (WHATWG WebSocket.close). */
const CLOSE_NORMAL = 1000;
const CLOSE_FAILED = 4011;

/** The tunnel never opened within the retry budget. */
class TunnelOpenError extends Error {
  readonly attempts: number;

  constructor(attempts: number) {
    super(`Tunnel did not open after ${attempts} attempt(s).`);
    this.name = "TunnelOpenError";
    this.attempts = attempts;
  }
}

/** Why a pair moved to the tunnel. */
export type FallbackReason = "timeout" | "native-failed";

export interface TunnelStartInfo {
  readonly reason: FallbackReason;
  /** Milliseconds from the timer start to the switch (0 if never started). */
  readonly elapsedMs: number;
}

export type TerminalFailureInfo =
  | { readonly reason: "setup-failed"; readonly error: unknown }
  | { readonly reason: "open-failed"; readonly attempts: number }
  | { readonly reason: "frame-error"; readonly code: TunnelFrameErrorCode; readonly error: unknown }
  | { readonly reason: "receive-failed"; readonly error: unknown }
  | { readonly reason: "send-failed"; readonly error: unknown }
  | { readonly reason: "protocol-violation"; readonly detail: string }
  | { readonly reason: "socket-error" }
  | { readonly reason: "socket-closed"; readonly closeCode: number };

/**
 * How one physical connection attempt ended (PLAN.md §8.2). `direct` and `turn`
 * come from the native selected candidate pair; `unknown` is a native open whose
 * path cannot be read; `tunnel` and `failed` come from the tunnel.
 */
export type ConnectionOutcome = "direct" | "turn" | "tunnel" | "failed" | "unknown";

/** The single outcome of one wrapper instance. */
export interface ConnectionOutcomeInfo {
  readonly outcome: ConnectionOutcome;
  /**
   * Whole milliseconds from both descriptions existing to the success. 0 for
   * `failed`, which has no success time. Never above MAX_CONNECT_MS.
   */
  readonly msToConnect: number;
}

/** The connection-log schema's ceiling for ms_to_connect (deploy/edge/log.ts). */
export const MAX_CONNECT_MS = 3600000;

export interface FallbackPeerConnectionOptions {
  readonly NativePeerConnection: typeof RTCPeerConnection;
  readonly WebSocketImpl: typeof WebSocket;
  readonly tunnelUrl: (pairId: string) => string;
  readonly roomId: string;
  readonly partySecret: SessionSecret;
  readonly fallbackAfterMs?: number;
  /**
   * TEST ONLY. The native connection is created with no ICE servers and
   * `iceTransportPolicy: "relay"`, so it cannot gather a usable candidate and
   * the pair falls back to the tunnel (PLAN.md §5.1). The transport exposes
   * this only to test builds; production never sets it.
   */
  readonly forceRelayOnlyNoServers?: boolean;
  readonly now?: () => number;
  readonly setTimeout?: (callback: () => void, ms: number) => unknown;
  readonly clearTimeout?: (handle: unknown) => void;
  readonly onTunnel?: (info: TunnelStartInfo) => void;
  readonly onTerminalFailure?: (info: TerminalFailureInfo) => void;
  /**
   * Called at most once per wrapper instance with its connection outcome. An
   * instance that never gets both descriptions (an unclaimed pooled offer)
   * reports nothing. An attempt that has started and is closed before any
   * success or failure reports `failed`, unless `isTearingDown()` is true at the
   * close: a close caused by a deliberate local teardown reports nothing.
   */
  readonly onOutcome?: (info: ConnectionOutcomeInfo) => void;
  /** True during a deliberate local teardown of the room (PLAN.md §8.2). Default: false. */
  readonly isTearingDown?: () => boolean;
}

/** Whether a connection returned by Trystero is running on the tunnel. */
export function isTunnelledConnection(connection: RTCPeerConnection): boolean {
  return (
    (connection as RTCPeerConnection & { readonly isTunnelled?: boolean }).isTunnelled === true
  );
}

type EventFn = (event: unknown) => void;

interface Deps {
  readonly NativePeerConnection: typeof RTCPeerConnection;
  readonly WebSocketImpl: typeof WebSocket;
  readonly tunnelUrl: (pairId: string) => string;
  readonly roomId: string;
  readonly partySecret: SessionSecret;
  readonly fallbackAfterMs: number;
  readonly forceRelayOnlyNoServers: boolean;
  readonly now: () => number;
  readonly schedule: (callback: () => void, ms: number) => unknown;
  readonly cancel: (handle: unknown) => void;
  readonly onTunnel: ((info: TunnelStartInfo) => void) | undefined;
  readonly onTerminalFailure: ((info: TerminalFailureInfo) => void) | undefined;
  readonly onOutcome: ((info: ConnectionOutcomeInfo) => void) | undefined;
  readonly isTearingDown: () => boolean;
}

/** Event-handler properties and listeners for one target. */
class EventHub {
  private readonly handlers = new Map<string, EventFn | null>();
  private readonly listeners = new Map<string, Set<EventFn>>();

  handler(type: string): EventFn | null {
    return this.handlers.get(type) ?? null;
  }

  setHandler(type: string, fn: EventFn | null): void {
    this.handlers.set(type, fn);
  }

  add(type: string, fn: EventFn): void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(fn);
  }

  remove(type: string, fn: EventFn): void {
    this.listeners.get(type)?.delete(fn);
  }

  dispatch(type: string, event: object): void {
    const handler = this.handlers.get(type);
    if (handler) invokeListener(handler, event);
    // Snapshot: a listener may remove itself or another during dispatch.
    for (const listener of Array.from(this.listeners.get(type) ?? [])) {
      invokeListener(listener, event);
    }
  }
}

function invokeListener(fn: EventFn, event: object): void {
  try {
    fn(event);
  } catch (error) {
    // Like the browser: a throwing listener must not break the caller.
    reportError(error);
  }
}

function reportError(error: unknown): void {
  if (typeof globalThis.reportError === "function") globalThis.reportError(error);
  else console.error(error);
}

/**
 * The data channel Trystero sees. It is backed by the native channel until the
 * pair switches, then by the tunnel. The same object survives the switch.
 */
class ChannelFacade {
  readonly hub = new EventHub();
  private native: RTCDataChannel | null = null;
  private tunnelled = false;
  private tunnelReady = false;
  private closed = false;
  private opened = false;
  private threshold = 0;
  private kind: BinaryType = "arraybuffer";

  constructor(
    private readonly session: Session,
    native: RTCDataChannel | null,
  ) {
    if (native) this.attach(native);
  }

  get label(): string {
    return this.native?.label ?? "data";
  }

  get readyState(): RTCDataChannelState {
    if (this.closed) return "closed";
    if (this.tunnelled) return this.tunnelReady ? "open" : "connecting";
    return this.native?.readyState ?? "connecting";
  }

  get binaryType(): BinaryType {
    return this.kind;
  }

  set binaryType(value: BinaryType) {
    this.kind = value;
    if (this.native && !this.tunnelled) this.native.binaryType = value;
  }

  get bufferedAmount(): number {
    if (this.tunnelled) return this.session.tunnelBufferedAmount();
    return this.native?.bufferedAmount ?? 0;
  }

  get bufferedAmountLowThreshold(): number {
    return this.threshold;
  }

  set bufferedAmountLowThreshold(value: number) {
    this.threshold = value;
    if (this.native && !this.tunnelled) this.native.bufferedAmountLowThreshold = value;
  }

  get onopen(): EventFn | null {
    return this.hub.handler("open");
  }
  set onopen(fn: EventFn | null) {
    this.hub.setHandler("open", fn);
  }
  get onmessage(): EventFn | null {
    return this.hub.handler("message");
  }
  set onmessage(fn: EventFn | null) {
    this.hub.setHandler("message", fn);
  }
  get onclose(): EventFn | null {
    return this.hub.handler("close");
  }
  set onclose(fn: EventFn | null) {
    this.hub.setHandler("close", fn);
  }
  get onerror(): EventFn | null {
    return this.hub.handler("error");
  }
  set onerror(fn: EventFn | null) {
    this.hub.setHandler("error", fn);
  }
  get onbufferedamountlow(): EventFn | null {
    return this.hub.handler("bufferedamountlow");
  }
  set onbufferedamountlow(fn: EventFn | null) {
    this.hub.setHandler("bufferedamountlow", fn);
  }

  addEventListener(type: string, fn: EventFn): void {
    this.hub.add(type, fn);
  }

  removeEventListener(type: string, fn: EventFn): void {
    this.hub.remove(type, fn);
  }

  send(data: string | ArrayBuffer | ArrayBufferView): void {
    // Same errors as a native RTCDataChannel.
    if (this.closed) throw new DOMException("Data channel is closed.", "InvalidStateError");
    if (this.tunnelled) {
      if (!this.tunnelReady) {
        throw new DOMException("Data channel is not open.", "InvalidStateError");
      }
      this.session.tunnelSend(data);
      return;
    }
    if (!this.native) throw new DOMException("Data channel is not open.", "InvalidStateError");
    if (typeof data === "string") this.native.send(data);
    else if (data instanceof ArrayBuffer) this.native.send(data);
    // The DOM types want an ArrayBuffer-backed view; a SharedArrayBuffer view
    // from a caller is not something Trystero sends.
    else this.native.send(data as ArrayBufferView<ArrayBuffer>);
  }

  close(): void {
    if (this.closed) return;
    if (this.tunnelled) {
      // One channel per connection, so closing it closes the connection. Frames
      // already queued are flushed first (see Session.closeGracefully).
      this.closed = true;
      this.session.closeGracefully();
      return;
    }
    this.closed = true;
    this.native?.close();
  }

  // ---- Called by the session ----

  hasOpened(): boolean {
    return this.opened;
  }

  /** Native channel events are ignored from here on. */
  enterTunnel(): void {
    if (!this.closed) this.tunnelled = true;
  }

  /** Tunnel paired. Fires `open` once; a channel that was already open stays so. */
  tunnelOpened(): void {
    if (this.closed) return;
    this.tunnelReady = true;
    if (!this.opened) {
      this.opened = true;
      this.fire("open");
    }
  }

  deliver(data: string | ArrayBuffer): void {
    if (this.closed) return;
    // Honour binaryType: "blob" gets a Blob, anything else the ArrayBuffer.
    const payload = typeof data !== "string" && this.kind === "blob" ? new Blob([data]) : data;
    this.fire("message", { data: payload });
  }

  dispatchBufferedLow(): void {
    if (this.closed) return;
    this.fire("bufferedamountlow");
  }

  /** Mark closed without an event. The session's own close does this. */
  markClosed(): void {
    this.closed = true;
  }

  /** Mark closed and tell Trystero, once. */
  emitClose(): void {
    this.closed = true;
    this.fire("close");
  }

  /** Every event carries `type` and `target` (this channel). */
  private fire(type: string, props: object = {}): void {
    this.hub.dispatch(type, { type, target: this, ...props });
  }

  private attach(native: RTCDataChannel): void {
    this.native = native;
    native.binaryType = this.kind;
    native.addEventListener("open", () => {
      if (this.tunnelled || this.closed) return;
      this.opened = true;
      this.session.onChannelOpened();
      this.fire("open");
    });
    native.addEventListener("message", (event) => {
      if (this.tunnelled || this.closed) return;
      this.fire("message", { data: event.data });
    });
    native.addEventListener("error", (event) => {
      if (this.tunnelled || this.closed) return;
      this.fire("error", { error: event.error });
    });
    native.addEventListener("bufferedamountlow", () => {
      if (this.tunnelled || this.closed) return;
      this.fire("bufferedamountlow");
    });
    native.addEventListener("close", () => {
      if (this.tunnelled || this.closed) return;
      // A close before the first open is the failed native attempt. The
      // deadline decides (PLAN.md §5.5), so it is not forwarded here.
      if (!this.opened && !this.session.nativeConnectionClosed()) return;
      this.closed = true;
      this.session.close();
      this.fire("close");
    });
  }
}

/** One wrapped connection: native state, the switch decision and the tunnel. */
class Session {
  readonly pcEvents = new EventHub();
  mode: "native" | "tunnel" = "native";
  channel: ChannelFacade | null = null;
  closed = false;
  /** The wrapper handed to Trystero. Set right after construction. */
  self: RTCPeerConnection | null = null;

  private terminated = false;
  private everConnected = false;
  private timerStarted = false;
  private timerStartedAt = 0;
  private timer: unknown = undefined;
  private switchedAt = 0;
  /** When both descriptions first existed. Undefined means no physical attempt (PLAN.md §8.2). */
  private attemptStartedAt: number | undefined = undefined;
  /**
   * The attempt's one outcome is claimed synchronously, when its success or
   * failure happens, so a later event cannot report a second one. A native
   * open's stats read finishes later; the claim does not wait for it.
   */
  private outcomeClaimed = false;
  /** Settles a pending selected-pair read as `unknown`. Set only while one is pending. */
  private settleStats: (() => void) | undefined = undefined;
  private statsTimer: unknown = undefined;
  /** Open retries and send pacing wait in separate slots, so they never share one. */
  private readonly retrySlot: PauseSlot = {};
  private readonly paceSlot: PauseSlot = {};
  private draining = false;
  private drainTimer: unknown = undefined;

  private socket: WebSocket | null = null;
  private cipher: TunnelCipher | null = null;
  private ready = false;
  private readonly readyGate: Promise<void>;
  private openReadyGate: () => void = () => undefined;
  private sendChain: Promise<void> = Promise.resolve();
  private recvChain: Promise<void> = Promise.resolve();
  /** Wire bytes accepted by send() and not yet handed to the socket. */
  private pendingBytes = 0;
  private paceTokens = TUNNEL_PACE_BURST_BYTES;
  private paceRefilledAt: number;
  private lowArmed = false;
  private lowTimer: unknown = undefined;

  constructor(
    private readonly native: RTCPeerConnection,
    private readonly deps: Deps,
  ) {
    this.paceRefilledAt = deps.now();
    this.readyGate = new Promise<void>((resolve) => {
      this.openReadyGate = resolve;
    });
    native.addEventListener("connectionstatechange", () => this.onNativeState());
    native.addEventListener("iceconnectionstatechange", () => this.onNativeState());
    native.addEventListener("datachannel", (event) => this.onNativeChannel(event.channel));
  }

  // ---- Reported state (what Trystero reads) ----

  connectionState(): RTCPeerConnectionState {
    const native = this.native.connectionState;
    if (this.closed) return native;
    if (this.mode === "tunnel") return this.ready ? "connected" : "connecting";
    if (native === "failed") return "connecting";
    if (native === "disconnected" && !this.everConnected) return "connecting";
    return native;
  }

  iceConnectionState(): RTCIceConnectionState {
    const native = this.native.iceConnectionState;
    if (this.closed) return native;
    if (this.mode === "tunnel") return this.ready ? "connected" : "checking";
    if (native === "failed") return "checking";
    if (native === "disconnected" && !this.everConnected) return "checking";
    return native;
  }

  nativeConnectionClosed(): boolean {
    return this.native.connectionState === "closed";
  }

  // ---- Delegated members ----

  setDescription(
    method: "setLocalDescription" | "setRemoteDescription",
    args: unknown[],
  ): Promise<void> {
    const fn = Reflect.get(this.native, method) as (...values: unknown[]) => Promise<void>;
    return fn.apply(this.native, args).then(() => this.maybeStartTimer());
  }

  createChannel(label: string, init?: RTCDataChannelInit): ChannelFacade {
    if (this.channel) throw new Error("FallbackPeerConnection supports one data channel.");
    if (
      init?.ordered === false ||
      init?.maxRetransmits !== undefined ||
      init?.maxPacketLifeTime !== undefined
    ) {
      throw new Error(
        "FallbackPeerConnection needs an ordered, reliable data channel; the tunnel cannot honour other settings.",
      );
    }
    const facade = new ChannelFacade(this, this.native.createDataChannel(label, init));
    this.channel = facade;
    return facade;
  }

  addListener(type: string, fn: EventFn): void {
    if (OWN_EVENTS.has(type)) this.pcEvents.add(type, fn);
    else this.native.addEventListener(type, fn);
  }

  removeListener(type: string, fn: EventFn): void {
    if (OWN_EVENTS.has(type)) this.pcEvents.remove(type, fn);
    else this.native.removeEventListener(type, fn);
  }

  /**
   * Caller's close (Trystero leaving). Frames already queued on a ready tunnel
   * are sent for up to GRACEFUL_FLUSH_MS, then the socket closes with 1000.
   * Anything else closes at once. Sends are refused while draining.
   */
  closeGracefully(): void {
    if (this.closed || this.draining) return;
    // A started attempt closed before any outcome failed, unless the local user
    // is tearing the room down. Trystero's own TTL destroy of a stuck peer lands here too.
    if (!this.deps.isTearingDown()) this.claimOutcome("failed");
    if (this.mode !== "tunnel" || !this.ready || !this.socket || this.pendingBytes === 0) {
      this.close();
      return;
    }
    this.draining = true;
    this.drainTimer = this.deps.schedule(() => {
      this.drainTimer = undefined;
      this.close();
    }, GRACEFUL_FLUSH_MS);
    // The chain never rejects (its failures are terminal), so this runs once every
    // frame queued before the drain has been sent or refused.
    this.sendChain.then(() => this.close());
  }

  /**
   * Tears everything down: timers, the socket, the native connection and the
   * channel. Idempotent. Never throws, so a caller's teardown always finishes.
   */
  close(code = CLOSE_NORMAL, reason = "closed"): void {
    if (this.closed) return;
    this.closed = true;
    this.pendingBytes = 0;
    this.clearTimer();
    this.clearLowTimer();
    this.clearDrainTimer();
    this.cancelPause(this.retrySlot);
    this.cancelPause(this.paceSlot);
    // A read still pending when the connection closes reports unknown now.
    this.settleStats?.();
    this.openReadyGate();
    const socket = this.socket;
    if (socket && (socket.readyState === WS_CONNECTING || socket.readyState === WS_OPEN)) {
      try {
        socket.close(code, reason);
      } catch {
        // The socket is going away on its own. Teardown must still run.
      }
    }
    this.native.close();
    this.channel?.markClosed();
  }

  private clearDrainTimer(): void {
    if (this.drainTimer !== undefined) {
      this.deps.cancel(this.drainTimer);
      this.drainTimer = undefined;
    }
  }

  // ---- Switch decision ----

  private maybeStartTimer(): void {
    if (this.closed || this.mode !== "native") return;
    if (!this.native.localDescription || !this.native.remoteDescription) return;
    this.attemptStartedAt ??= this.deps.now();
    if (this.timerStarted || this.channel?.hasOpened()) return;
    this.timerStarted = true;
    this.timerStartedAt = this.attemptStartedAt;
    this.timer = this.deps.schedule(() => {
      this.timer = undefined;
      this.onTimeout();
    }, this.deps.fallbackAfterMs);
  }

  /**
   * The deadline. Switch unless the data channel has opened. A connected peer
   * connection with a closed channel is stuck, so it switches too.
   */
  private onTimeout(): void {
    if (this.closed || this.mode !== "native") return;
    if (this.channel?.hasOpened()) return;
    this.switchToTunnel("timeout");
  }

  /**
   * Called by the channel when the native channel opens. The pair is healthy,
   * so the deadline is no longer needed. Only this marks the pair as connected:
   * until then a native `disconnected` stays masked, so Trystero's disconnect
   * grace cannot close the peer before the deadline decides.
   */
  onChannelOpened(): void {
    this.everConnected = true;
    this.clearTimer();
    this.claimNativeOpen();
  }

  /**
   * The native channel opened: this attempt's success, claimed now. The selected
   * pair is read from stats afterwards; a null or failed read is `unknown`.
   */
  private claimNativeOpen(): void {
    const startedAt = this.attemptStartedAt;
    if (this.outcomeClaimed || startedAt === undefined) return;
    this.outcomeClaimed = true;
    const msToConnect = this.elapsedSince(startedAt);
    void this.selectedPath().then((path) => this.reportOutcome(path, msToConnect));
  }

  /**
   * The native selected path, or `unknown` if the read has not settled within
   * STATS_TIMEOUT_MS or the connection closes first. Settles once. The timer is
   * cleared when it settles, so none outlives the read or the connection.
   */
  private selectedPath(): Promise<"direct" | "turn" | "unknown"> {
    return new Promise((resolve) => {
      let settled = false;
      const settle = (path: "direct" | "turn" | "unknown"): void => {
        if (settled) return;
        settled = true;
        this.settleStats = undefined;
        if (this.statsTimer !== undefined) {
          this.deps.cancel(this.statsTimer);
          this.statsTimer = undefined;
        }
        resolve(path);
      };
      this.settleStats = () => settle("unknown");
      this.statsTimer = this.deps.schedule(() => {
        this.statsTimer = undefined;
        settle("unknown");
      }, STATS_TIMEOUT_MS);
      selectedCandidateOutcome(this.native).then(
        (path) => settle(path ?? "unknown"),
        () => settle("unknown"),
      );
    });
  }

  /** Claims a synchronous outcome (`tunnel` or `failed`) if no other one was claimed. */
  private claimOutcome(outcome: "tunnel" | "failed"): void {
    const startedAt = this.attemptStartedAt;
    if (this.outcomeClaimed || startedAt === undefined) return;
    this.outcomeClaimed = true;
    this.reportOutcome(outcome, outcome === "tunnel" ? this.elapsedSince(startedAt) : 0);
  }

  private elapsedSince(startedAt: number): number {
    const ms = Math.round(this.deps.now() - startedAt);
    return Math.min(MAX_CONNECT_MS, Math.max(0, ms));
  }

  private reportOutcome(outcome: ConnectionOutcome, msToConnect: number): void {
    invokeCallback(() => this.deps.onOutcome?.({ outcome, msToConnect }));
  }

  private onNativeState(): void {
    if (this.closed || this.mode !== "native") return;
    const native = this.native;
    if (native.connectionState === "failed" || native.iceConnectionState === "failed") {
      this.switchToTunnel("native-failed");
      return;
    }
    this.emitStates();
  }

  private switchToTunnel(reason: FallbackReason): void {
    if (this.closed || this.mode !== "native") return;
    this.mode = "tunnel";
    this.clearTimer();
    this.switchedAt = this.deps.now();
    this.channel?.enterTunnel();
    const elapsedMs = this.timerStarted ? this.switchedAt - this.timerStartedAt : 0;
    invokeCallback(() => this.deps.onTunnel?.({ reason, elapsedMs }));
    this.emitStates();
    void this.startTunnel();
  }

  private async startTunnel(): Promise<void> {
    try {
      const local = this.native.localDescription?.sdp;
      const remote = this.native.remoteDescription?.sdp;
      if (!local || !remote) throw new Error("Tunnel needs local and remote descriptions.");
      const { pairId, localRole } = await computeTunnelPairing(local, remote, this.deps.roomId);
      const keys = await deriveTunnelKeys(this.deps.partySecret, pairId, localRole);
      if (this.closed) return;
      this.cipher = new TunnelCipher(keys);
      await this.connectWithRetry(this.deps.tunnelUrl(pairId));
    } catch (error) {
      if (error instanceof TunnelOpenError) {
        this.failTerminal({ reason: "open-failed", attempts: error.attempts });
      } else {
        this.failTerminal({ reason: "setup-failed", error });
      }
    }
  }

  /**
   * Opens the tunnel socket, retrying a failed open (the edge's transient 409)
   * with doubling backoff. A retry is never scheduled past the fallback
   * deadline (switch time + fallbackAfterMs).
   */
  private async connectWithRetry(url: string): Promise<void> {
    const deadline = this.switchedAt + this.deps.fallbackAfterMs;
    let delay = OPEN_RETRY_BASE_MS;
    for (let attempt = 1; ; attempt += 1) {
      try {
        await this.openSocket(url);
        return;
      } catch (error) {
        if (this.closed) throw error;
        if (attempt >= OPEN_ATTEMPTS) throw new TunnelOpenError(attempt);
        if (this.deps.now() + delay > deadline) throw new TunnelOpenError(attempt);
        await this.pause(this.retrySlot, delay);
        if (this.closed) throw error;
        delay *= 2;
      }
    }
  }

  /**
   * The partner's socket closed. A clean 1000 close comes after the frames it
   * sent, which may still be decrypting, so those are delivered first. Any
   * other close is a failure and stops at once.
   */
  private onSocketClosed(code: number): void {
    if (this.closed) return;
    if (code !== CLOSE_NORMAL) {
      this.failTerminal({ reason: "socket-closed", closeCode: code });
      return;
    }
    this.recvChain.then(() => this.failTerminal({ reason: "socket-closed", closeCode: code }));
  }

  /** Resolves once the socket is open; rejects if it fails before that. */
  private openSocket(url: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const socket = new this.deps.WebSocketImpl(url);
      socket.binaryType = "arraybuffer";
      // Kept now so close() can stop an in-flight attempt.
      this.socket = socket;
      socket.onopen = () => {
        socket.onmessage = (event) => this.onSocketMessage(event);
        socket.onerror = () => this.failTerminal({ reason: "socket-error" });
        socket.onclose = (event) => this.onSocketClosed(event.code);
        resolve();
      };
      socket.onerror = () => reject(new Error("Tunnel socket failed to open."));
      socket.onclose = (event) =>
        reject(new Error(`Tunnel socket closed before open (code ${event.code}).`));
    });
  }

  /** A cancellable wait in `slot`. Used by open retries and by send pacing. */
  private pause(slot: PauseSlot, ms: number): Promise<void> {
    return new Promise<void>((resolve) => {
      slot.wake = resolve;
      slot.timer = this.deps.schedule(() => {
        slot.timer = undefined;
        slot.wake = undefined;
        resolve();
      }, ms);
    });
  }

  /** Cancels the slot's timer and wakes its waiter, which then sees `closed`. */
  private cancelPause(slot: PauseSlot): void {
    if (slot.timer !== undefined) {
      this.deps.cancel(slot.timer);
      slot.timer = undefined;
    }
    const wake = slot.wake;
    slot.wake = undefined;
    wake?.();
  }

  // ---- Tunnel traffic ----

  private onSocketMessage(event: MessageEvent): void {
    if (this.closed) return;
    const data: unknown = event.data;
    if (!this.ready) {
      if (data === TUNNEL_PAIRED_FRAME) {
        this.becomeReady();
        return;
      }
      this.failTerminal({ reason: "protocol-violation", detail: "frame before paired" });
      return;
    }
    if (!(data instanceof ArrayBuffer)) {
      this.failTerminal({ reason: "protocol-violation", detail: "text frame after paired" });
      return;
    }
    const frame = new Uint8Array(data);
    this.recvChain = this.recvChain.then(() => this.receive(frame));
  }

  private async receive(frame: Uint8Array<ArrayBuffer>): Promise<void> {
    if (this.closed || !this.cipher) return;
    try {
      const plaintext = await this.cipher.open(frame);
      if (this.closed) return;
      this.channel?.deliver(decodeTunnelMessage(plaintext));
    } catch (error) {
      if (error instanceof TunnelFrameError) {
        this.failTerminal({ reason: "frame-error", code: error.code, error });
      } else {
        this.failTerminal({ reason: "receive-failed", error });
      }
    }
  }

  private becomeReady(): void {
    if (this.ready || this.closed) return;
    this.ready = true;
    this.claimOutcome("tunnel");
    this.openReadyGate();
    this.emitStates();
    if (!this.channel) {
      // The answering side has no native channel to wrap, so Trystero gets a
      // synthetic `datachannel` event, as it would from a native answer.
      const facade = new ChannelFacade(this, null);
      facade.enterTunnel();
      this.channel = facade;
      this.firePc("datachannel", { channel: facade });
    }
    this.channel?.tunnelOpened();
  }

  /** Callers check that the tunnel is ready (ChannelFacade.send does). */
  tunnelSend(data: string | ArrayBuffer | ArrayBufferView): void {
    if (this.closed || this.draining) {
      throw new DOMException("Data channel is closed.", "InvalidStateError");
    }
    const encoded = encodeTunnelMessage(data);
    const payloadBytes = encoded.byteLength - 1;
    const limit = TUNNEL_MAX_FRAME_BYTES - TUNNEL_FRAME_OVERHEAD_BYTES;
    if (payloadBytes > limit) {
      throw new RangeError(`Tunnel message is ${payloadBytes} bytes; the limit is ${limit} bytes.`);
    }
    // Wire bytes, the same unit as socket.bufferedAmount and the server's budget.
    const wireBytes = payloadBytes + TUNNEL_FRAME_OVERHEAD_BYTES;
    this.pendingBytes += wireBytes;
    // One serial chain: frames are sealed, paced and sent in the order sent.
    this.sendChain = this.sendChain
      .then(async () => {
        if (!this.ready) await this.readyGate;
        if (this.closed || !this.cipher || !this.socket) return;
        const frame = await this.cipher.seal(encoded);
        await this.paceFrame(frame.byteLength);
        if (this.closed || !this.socket) return;
        this.socket.send(frame);
        this.pendingBytes -= wireBytes;
        this.checkBufferedLow();
      })
      .catch((error: unknown) => this.failTerminal({ reason: "send-failed", error }));
    this.checkBufferedLow();
  }

  /**
   * Waits until the pace bucket holds `bytes` wire bytes, then takes them.
   * The bucket starts full and refills at TUNNEL_PACE_BYTES_PER_SECOND. The
   * frame's bytes count toward bufferedAmount while this waits.
   */
  private async paceFrame(bytes: number): Promise<void> {
    for (;;) {
      this.refillPaceTokens();
      if (this.paceTokens >= bytes) {
        this.paceTokens -= bytes;
        return;
      }
      const waitMs = Math.ceil(((bytes - this.paceTokens) * 1000) / TUNNEL_PACE_BYTES_PER_SECOND);
      await this.pause(this.paceSlot, waitMs);
      if (this.closed) return;
    }
  }

  private refillPaceTokens(): void {
    const now = this.deps.now();
    const elapsedMs = now - this.paceRefilledAt;
    this.paceTokens = Math.min(
      TUNNEL_PACE_BURST_BYTES,
      this.paceTokens + (elapsedMs * TUNNEL_PACE_BYTES_PER_SECOND) / 1000,
    );
    this.paceRefilledAt = now;
  }

  tunnelBufferedAmount(): number {
    if (this.closed) return 0;
    return this.pendingBytes + (this.socket?.bufferedAmount ?? 0);
  }

  /**
   * The socket has no drain event, so poll while above the threshold. Fire
   * once when the amount falls to or below it after having been above.
   */
  private checkBufferedLow(): void {
    const channel = this.channel;
    if (this.closed || !channel) return;
    if (this.tunnelBufferedAmount() > channel.bufferedAmountLowThreshold) {
      this.lowArmed = true;
      this.lowTimer ??= this.deps.schedule(() => {
        this.lowTimer = undefined;
        this.checkBufferedLow();
      }, LOW_WATER_POLL_MS);
    } else if (this.lowArmed) {
      this.lowArmed = false;
      this.clearLowTimer();
      channel.dispatchBufferedLow();
    }
  }

  /**
   * Terminal failure. Teardown always runs (the `finally`). Then Trystero is
   * told: the channel closes, and the connection state reads "closed" even when
   * no channel exists yet (an answerer before pairing). Then the report, once.
   */
  private failTerminal(info: TerminalFailureInfo): void {
    if (this.closed || this.terminated) return;
    this.terminated = true;
    // A failure after any success (native open or tunnel pairing) claims nothing.
    this.claimOutcome("failed");
    const channel = this.channel;
    try {
      this.close(CLOSE_FAILED, "tunnel failed");
    } finally {
      channel?.emitClose();
      this.emitStates();
      invokeCallback(() => this.deps.onTerminalFailure?.(info));
    }
  }

  // ---- Native channel ----

  private onNativeChannel(native: RTCDataChannel): void {
    // After a switch the native channel is left unused. Closing it would send an
    // SCTP close, and the partner's Trystero would tear the peer down.
    if (this.closed || this.mode === "tunnel") return;
    const facade = new ChannelFacade(this, native);
    this.channel = facade;
    this.firePc("datachannel", { channel: facade });
  }

  // ---- Helpers ----

  private emitStates(): void {
    this.firePc("connectionstatechange");
    this.firePc("iceconnectionstatechange");
  }

  /** Every event carries `type` and `target` (the wrapper). */
  private firePc(type: string, props: object = {}): void {
    this.pcEvents.dispatch(type, { type, target: this.self, ...props });
  }

  private clearTimer(): void {
    if (this.timer !== undefined) {
      this.deps.cancel(this.timer);
      this.timer = undefined;
    }
  }

  private clearLowTimer(): void {
    if (this.lowTimer !== undefined) {
      this.deps.cancel(this.lowTimer);
      this.lowTimer = undefined;
    }
  }
}

const OWN_EVENTS = new Set(["connectionstatechange", "iceconnectionstatechange", "datachannel"]);
const HANDLER_EVENTS = new Map([
  ["ondatachannel", "datachannel"],
  ["onconnectionstatechange", "connectionstatechange"],
  ["oniceconnectionstatechange", "iceconnectionstatechange"],
]);

/** Monotonic where available, so a wall-clock change cannot move the deadline. */
function defaultNow(): number {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

function invokeCallback(callback: () => void): void {
  try {
    callback();
  } catch (error) {
    reportError(error);
  }
}

function createWrapper(native: RTCPeerConnection, deps: Deps): RTCPeerConnection {
  const session = new Session(native, deps);
  const wrapper = new Proxy(native, {
    get(target, prop) {
      const handlerEvent = typeof prop === "string" ? HANDLER_EVENTS.get(prop) : undefined;
      if (handlerEvent !== undefined) return session.pcEvents.handler(handlerEvent);
      switch (prop) {
        case "connectionState":
          return session.connectionState();
        case "iceConnectionState":
          return session.iceConnectionState();
        case "isTunnelled":
          return session.mode === "tunnel";
        case "createDataChannel":
          return (label: string, init?: RTCDataChannelInit) =>
            session.createChannel(label, init) as unknown as RTCDataChannel;
        case "setLocalDescription":
          return (...args: unknown[]) => session.setDescription("setLocalDescription", args);
        case "setRemoteDescription":
          return (...args: unknown[]) => session.setDescription("setRemoteDescription", args);
        case "addEventListener":
          return (type: string, fn: EventFn) => session.addListener(type, fn);
        case "removeEventListener":
          return (type: string, fn: EventFn) => session.removeListener(type, fn);
        case "close":
          return () => session.closeGracefully();
        default:
          break;
      }
      const value: unknown = Reflect.get(target, prop, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
    set(target, prop, value: unknown) {
      const handlerEvent = typeof prop === "string" ? HANDLER_EVENTS.get(prop) : undefined;
      if (handlerEvent !== undefined) {
        session.pcEvents.setHandler(
          handlerEvent,
          typeof value === "function" ? (value as EventFn) : null,
        );
        return true;
      }
      return Reflect.set(target, prop, value, target);
    },
  });
  session.self = wrapper;
  return wrapper;
}

/**
 * Returns the `rtcPolyfill` class for Trystero. Each instance wraps one
 * native RTCPeerConnection and falls back to the tunnel once per connection.
 */
export function createFallbackPeerConnectionClass(
  options: FallbackPeerConnectionOptions,
): typeof RTCPeerConnection {
  const deps: Deps = {
    NativePeerConnection: options.NativePeerConnection,
    WebSocketImpl: options.WebSocketImpl,
    tunnelUrl: options.tunnelUrl,
    roomId: options.roomId,
    partySecret: options.partySecret,
    fallbackAfterMs: options.fallbackAfterMs ?? FALLBACK_AFTER_MS,
    forceRelayOnlyNoServers: options.forceRelayOnlyNoServers === true,
    now: options.now ?? defaultNow,
    schedule: options.setTimeout ?? ((callback, ms) => globalThis.setTimeout(callback, ms)),
    cancel:
      options.clearTimeout ??
      ((handle) => globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>)),
    onTunnel: options.onTunnel,
    onTerminalFailure: options.onTerminalFailure,
    onOutcome: options.onOutcome,
    isTearingDown: options.isTearingDown ?? (() => false),
  };
  return class FallbackPeerConnection {
    constructor(configuration?: RTCConfiguration) {
      const effective: RTCConfiguration = deps.forceRelayOnlyNoServers
        ? { ...configuration, iceServers: [], iceTransportPolicy: "relay" }
        : (configuration as RTCConfiguration);
      return createWrapper(new deps.NativePeerConnection(effective), deps);
    }
  } as unknown as typeof RTCPeerConnection;
}
