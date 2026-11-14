/**
 * Connection fallback wrapper for Trystero's `rtcPolyfill` (PLAN.md §5.5).
 *
 * `createFallbackPeerConnectionClass` returns a constructor that delegates to
 * the browser's real RTCPeerConnection. When a pair has not connected within
 * `fallbackAfterMs`, or the native connection reports `failed`, the pair's
 * single data channel moves onto the edge tunnel (`/tunnel/:pairId`, see
 * deploy/edge/tunnel.ts). Trystero keeps the same channel object and sees
 * `connecting` until the tunnel reports `paired`, then `connected`.
 *
 * Rules that follow from the Trystero 0.27 code (`peer.mjs`, `strategy.mjs`):
 * - The timer starts only once BOTH descriptions exist. Initiator offers are
 *   pooled before a remote description exists (PLAN.md §5.1).
 * - `failed` and `disconnected` are never shown to Trystero while the pair is
 *   switching or tunnelled. Trystero closes a peer on either.
 * - The native connection is NOT closed at the switch. Closing it would send a
 *   DTLS close, and a partner still on native WebRTC would tear the peer down.
 * - The switch is one-way for the connection's lifetime.
 * - One data channel per connection. Trystero uses exactly one.
 *
 * Nothing in the transport uses this module yet; wiring is PLAN.md §5.6.
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

/**
 * Client-side cap on a whole binary frame. The edge accepts up to 262208
 * bytes (MAX_TUNNEL_FRAME_BYTES in deploy/edge/tunnel.ts); this stays at the
 * stricter 256 KiB so a frame is never rejected by the server.
 */
export const TUNNEL_MAX_FRAME_BYTES = 262144;
/** Delay from both descriptions existing to the tunnel fallback (PLAN.md §5). */
export const FALLBACK_AFTER_MS = 8000;
/** Server text frame that marks a completed pair. Any other text is fatal. */
export const TUNNEL_PAIRED_FRAME = "paired";

const LOW_WATER_POLL_MS = 10;
/**
 * The edge answers 409 while a previous socket on the same pairId is still
 * closing. A browser reports that as a failed open with no status, so it is
 * retried: up to OPEN_ATTEMPTS tries, backing off from OPEN_RETRY_BASE_MS
 * (doubling), and never scheduling a retry past the fallback deadline.
 */
export const OPEN_ATTEMPTS = 5;
export const OPEN_RETRY_BASE_MS = 250;
const WS_CONNECTING = 0;
const WS_OPEN = 1;
const CLOSE_NORMAL = 1000;
const CLOSE_FAILED = 1011;

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

export interface FallbackPeerConnectionOptions {
  readonly NativePeerConnection: typeof RTCPeerConnection;
  readonly WebSocketImpl: typeof WebSocket;
  readonly tunnelUrl: (pairId: string) => string;
  readonly roomId: string;
  readonly partySecret: SessionSecret;
  readonly fallbackAfterMs?: number;
  readonly now?: () => number;
  readonly setTimeout?: (callback: () => void, ms: number) => unknown;
  readonly clearTimeout?: (handle: unknown) => void;
  readonly onTunnel?: (info: TunnelStartInfo) => void;
  readonly onTerminalFailure?: (info: TerminalFailureInfo) => void;
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
  readonly now: () => number;
  readonly schedule: (callback: () => void, ms: number) => unknown;
  readonly cancel: (handle: unknown) => void;
  readonly onTunnel: ((info: TunnelStartInfo) => void) | undefined;
  readonly onTerminalFailure: ((info: TerminalFailureInfo) => void) | undefined;
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
    if (this.closed) throw new Error("Data channel is closed.");
    if (this.tunnelled) {
      this.session.tunnelSend(data);
      return;
    }
    if (!this.native) throw new Error("Data channel has no native transport.");
    if (typeof data === "string") this.native.send(data);
    else if (data instanceof ArrayBuffer) this.native.send(data);
    // The DOM types want an ArrayBuffer-backed view; a SharedArrayBuffer view
    // from a caller is not something Trystero sends.
    else this.native.send(data as ArrayBufferView<ArrayBuffer>);
  }

  close(): void {
    if (this.closed) return;
    if (this.tunnelled) {
      // One channel per connection, so closing it closes the connection.
      this.session.close();
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
      this.hub.dispatch("open", { type: "open" });
    }
  }

  deliver(data: string | ArrayBuffer): void {
    if (this.closed) return;
    this.hub.dispatch("message", { type: "message", data });
  }

  dispatchBufferedLow(): void {
    if (this.closed) return;
    this.hub.dispatch("bufferedamountlow", { type: "bufferedamountlow" });
  }

  /** Mark closed without an event. The session's own close does this. */
  markClosed(): void {
    this.closed = true;
  }

  /** Mark closed and tell Trystero, once. */
  emitClose(): void {
    this.closed = true;
    this.hub.dispatch("close", { type: "close" });
  }

  private attach(native: RTCDataChannel): void {
    this.native = native;
    native.binaryType = this.kind;
    native.addEventListener("open", (event) => {
      if (this.tunnelled || this.closed) return;
      this.opened = true;
      this.hub.dispatch("open", event);
    });
    native.addEventListener("message", (event) => {
      if (this.tunnelled || this.closed) return;
      this.hub.dispatch("message", event);
    });
    native.addEventListener("error", (event) => {
      if (this.tunnelled || this.closed) return;
      this.hub.dispatch("error", event);
    });
    native.addEventListener("bufferedamountlow", (event) => {
      if (this.tunnelled || this.closed) return;
      this.hub.dispatch("bufferedamountlow", event);
    });
    native.addEventListener("close", (event) => {
      if (this.tunnelled || this.closed) return;
      // A close before the first open is the failed native attempt. The
      // fallback owns that decision, so it is not forwarded (PLAN.md §5.5).
      if (!this.opened && !this.session.nativeConnectionClosed()) return;
      this.closed = true;
      this.session.close();
      this.hub.dispatch("close", event);
    });
  }
}

/** One wrapped connection: native state, the switch decision and the tunnel. */
class Session {
  readonly pcEvents = new EventHub();
  mode: "native" | "tunnel" = "native";
  channel: ChannelFacade | null = null;
  closed = false;

  private terminated = false;
  private everConnected = false;
  private timerStarted = false;
  private timerStartedAt = 0;
  private timer: unknown = undefined;
  private switchedAt = 0;
  private retryTimer: unknown = undefined;
  private wakeRetry: (() => void) | undefined = undefined;

  private socket: WebSocket | null = null;
  private cipher: TunnelCipher | null = null;
  private ready = false;
  private readonly readyGate: Promise<void>;
  private openReadyGate: () => void = () => undefined;
  private sendChain: Promise<void> = Promise.resolve();
  private recvChain: Promise<void> = Promise.resolve();
  private pendingBytes = 0;
  private lowArmed = false;
  private lowTimer: unknown = undefined;

  constructor(
    private readonly native: RTCPeerConnection,
    private readonly deps: Deps,
  ) {
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

  close(code = CLOSE_NORMAL, reason = "closed"): void {
    if (this.closed) return;
    this.closed = true;
    this.clearTimer();
    this.clearLowTimer();
    this.cancelRetryPause();
    this.openReadyGate();
    const socket = this.socket;
    if (socket && (socket.readyState === WS_CONNECTING || socket.readyState === WS_OPEN)) {
      socket.close(code, reason);
    }
    this.native.close();
    this.channel?.markClosed();
  }

  // ---- Switch decision ----

  private maybeStartTimer(): void {
    if (this.timerStarted || this.closed || this.mode !== "native" || this.everConnected) return;
    if (!this.native.localDescription || !this.native.remoteDescription) return;
    this.timerStarted = true;
    this.timerStartedAt = this.deps.now();
    this.timer = this.deps.schedule(() => {
      this.timer = undefined;
      this.onTimeout();
    }, this.deps.fallbackAfterMs);
  }

  private onTimeout(): void {
    if (this.closed || this.mode !== "native") return;
    if (this.isHealthy()) return;
    this.switchToTunnel("timeout");
  }

  private onNativeState(): void {
    if (this.closed || this.mode !== "native") return;
    if (this.isHealthy()) {
      this.everConnected = true;
      this.clearTimer();
    }
    const native = this.native;
    if (native.connectionState === "failed" || native.iceConnectionState === "failed") {
      this.switchToTunnel("native-failed");
      return;
    }
    this.emitStates();
  }

  private isHealthy(): boolean {
    const native = this.native;
    return (
      native.connectionState === "connected" ||
      native.iceConnectionState === "connected" ||
      native.iceConnectionState === "completed" ||
      (this.channel?.hasOpened() ?? false)
    );
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
        await this.pauseRetry(delay);
        if (this.closed) throw error;
        delay *= 2;
      }
    }
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
        socket.onclose = (event) =>
          this.failTerminal({ reason: "socket-closed", closeCode: event.code });
        resolve();
      };
      socket.onerror = () => reject(new Error("Tunnel socket failed to open."));
      socket.onclose = (event) =>
        reject(new Error(`Tunnel socket closed before open (code ${event.code}).`));
    });
  }

  private pauseRetry(ms: number): Promise<void> {
    return new Promise<void>((resolve) => {
      this.wakeRetry = resolve;
      this.retryTimer = this.deps.schedule(() => {
        this.retryTimer = undefined;
        this.wakeRetry = undefined;
        resolve();
      }, ms);
    });
  }

  private cancelRetryPause(): void {
    if (this.retryTimer !== undefined) {
      this.deps.cancel(this.retryTimer);
      this.retryTimer = undefined;
    }
    const wake = this.wakeRetry;
    this.wakeRetry = undefined;
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
    this.openReadyGate();
    this.emitStates();
    if (!this.channel) {
      // The answering side has no native channel to wrap, so Trystero gets a
      // synthetic `datachannel` event, as it would from a native answer.
      const facade = new ChannelFacade(this, null);
      facade.enterTunnel();
      this.channel = facade;
      this.pcEvents.dispatch("datachannel", { type: "datachannel", channel: facade });
    }
    this.channel?.tunnelOpened();
  }

  tunnelSend(data: string | ArrayBuffer | ArrayBufferView): void {
    if (this.closed) throw new Error("Data channel is closed.");
    const encoded = encodeTunnelMessage(data);
    const payloadBytes = encoded.byteLength - 1;
    const limit = TUNNEL_MAX_FRAME_BYTES - TUNNEL_FRAME_OVERHEAD_BYTES;
    if (payloadBytes > limit) {
      throw new RangeError(`Tunnel message is ${payloadBytes} bytes; the limit is ${limit} bytes.`);
    }
    this.pendingBytes += payloadBytes;
    // One serial chain: frames are sealed and sent in the order sent.
    this.sendChain = this.sendChain
      .then(async () => {
        if (!this.ready) await this.readyGate;
        if (this.closed || !this.cipher || !this.socket) return;
        const frame = await this.cipher.seal(encoded);
        if (this.closed || !this.socket) return;
        this.socket.send(frame);
        this.pendingBytes -= payloadBytes;
        this.checkBufferedLow();
      })
      .catch((error: unknown) => this.failTerminal({ reason: "send-failed", error }));
    this.checkBufferedLow();
  }

  tunnelBufferedAmount(): number {
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

  /** Terminal: close everything, tell Trystero once, then report once. */
  private failTerminal(info: TerminalFailureInfo): void {
    if (this.closed || this.terminated) return;
    this.terminated = true;
    const channel = this.channel;
    this.close(CLOSE_FAILED, "tunnel failed");
    channel?.emitClose();
    invokeCallback(() => this.deps.onTerminalFailure?.(info));
  }

  // ---- Native channel ----

  private onNativeChannel(native: RTCDataChannel): void {
    // After a switch the native channel is left unused. Closing it would send an
    // SCTP close, and the partner's Trystero would tear the peer down.
    if (this.closed || this.mode === "tunnel") return;
    const facade = new ChannelFacade(this, native);
    this.channel = facade;
    this.pcEvents.dispatch("datachannel", { type: "datachannel", channel: facade });
  }

  // ---- Helpers ----

  private emitStates(): void {
    this.pcEvents.dispatch("connectionstatechange", { type: "connectionstatechange" });
    this.pcEvents.dispatch("iceconnectionstatechange", { type: "iceconnectionstatechange" });
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

function invokeCallback(callback: () => void): void {
  try {
    callback();
  } catch (error) {
    reportError(error);
  }
}

function createWrapper(native: RTCPeerConnection, deps: Deps): RTCPeerConnection {
  const session = new Session(native, deps);
  return new Proxy(native, {
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
          return () => session.close();
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
    now: options.now ?? (() => Date.now()),
    schedule: options.setTimeout ?? ((callback, ms) => globalThis.setTimeout(callback, ms)),
    cancel:
      options.clearTimeout ??
      ((handle) => globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>)),
    onTunnel: options.onTunnel,
    onTerminalFailure: options.onTerminalFailure,
  };
  return class FallbackPeerConnection {
    constructor(configuration?: RTCConfiguration) {
      return createWrapper(new deps.NativePeerConnection(configuration), deps);
    }
  } as unknown as typeof RTCPeerConnection;
}
