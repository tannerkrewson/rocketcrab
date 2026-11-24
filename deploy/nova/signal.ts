import { jsonError } from "./http";

// Trystero ws-relay 0.27 protocol. Socket attachments survive hibernation.
interface Attachment {
  topics: string[];
  tokens: number;
  lastRefillMs: number;
}

interface HibernatingSocket extends WebSocket {
  serializeAttachment(value: Attachment): void;
  deserializeAttachment(): Attachment | null;
}

interface SignalState {
  acceptWebSocket(socket: WebSocket): void;
  getWebSockets(): HibernatingSocket[];
  storage: { setAlarm(time: number): Promise<void> };
}

declare const WebSocketPair: { new (): { 0: WebSocket; 1: HibernatingSocket } };

const validTopic = /^[A-Za-z0-9_-]+$/;
const maxFrameBytes = 64 * 1024;
const maxSockets = 128;
const burst = 100;
const refillPerMs = 20 / 1000;
const idleMs = 10 * 60 * 1000;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export class SignalHub {
  private readonly sockets = new Map<HibernatingSocket, Attachment>();

  constructor(private readonly state: SignalState) {
    for (const socket of state.getWebSockets()) {
      const attachment = socket.deserializeAttachment();
      if (socket.readyState === 1 && attachment) this.sockets.set(socket, attachment);
    }
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("WebSocket upgrade required", { status: 426 });
    }
    if (this.sockets.size >= maxSockets) {
      return jsonError(503, "signal_full", "signaling room is full");
    }
    const pair = new WebSocketPair();
    const socket = pair[1];
    const first = this.sockets.size === 0;
    const attachment = { topics: [], tokens: burst, lastRefillMs: Date.now() };
    this.state.acceptWebSocket(socket);
    this.sockets.set(socket, attachment);
    socket.serializeAttachment(attachment);
    if (first) {
      try {
        await this.state.storage.setAlarm(attachment.lastRefillMs + idleMs);
      } catch (error) {
        this.close(socket, 1011, "idle timer unavailable");
        throw error;
      }
    }
    return new Response(null, { status: 101, webSocket: pair[0] } as ResponseInit);
  }

  webSocketMessage(socket: HibernatingSocket, message: string | ArrayBuffer): void {
    const attachment = this.sockets.get(socket);
    if (!attachment) return;
    const now = Date.now();
    attachment.tokens = Math.min(
      burst,
      attachment.tokens + Math.max(0, now - attachment.lastRefillMs) * refillPerMs,
    );
    attachment.lastRefillMs = now;
    if (attachment.tokens < 1) return this.reject(socket, "rate limit exceeded");
    attachment.tokens -= 1;
    const size =
      typeof message === "string" ? encoder.encode(message).byteLength : message.byteLength;
    if (size > maxFrameBytes) {
      this.close(socket, 1009, "message too big");
      return;
    }
    let value: unknown;
    try {
      value = JSON.parse(typeof message === "string" ? message : decoder.decode(message));
    } catch {
      return this.reject(socket, "invalid message");
    }
    if (typeof value !== "object" || value === null || Array.isArray(value))
      return this.reject(socket, "invalid message");
    const msg = value as Record<string, unknown>;
    if (
      typeof msg.topic !== "string" ||
      !["subscribe", "unsubscribe", "publish"].includes(String(msg.type)) ||
      (msg.type === "publish" && !("payload" in msg))
    ) {
      return this.reject(socket, "invalid message");
    }
    if (msg.topic.length > 256 || !validTopic.test(msg.topic))
      return this.reject(socket, "invalid topic");
    if (msg.type === "subscribe" && !attachment.topics.includes(msg.topic)) {
      if (attachment.topics.length >= 128)
        return this.reject(socket, "subscription limit exceeded");
      attachment.topics.push(msg.topic);
    } else if (msg.type === "unsubscribe") {
      attachment.topics = attachment.topics.filter((topic) => topic !== msg.topic);
    } else if (msg.type === "publish") {
      const outgoing = JSON.stringify({ topic: msg.topic, payload: msg.payload });
      for (const [subscriber, subscription] of this.sockets) {
        if (subscriber.readyState !== 1 || !subscription.topics.includes(msg.topic)) continue;
        try {
          subscriber.send(outgoing);
        } catch {
          this.close(subscriber, 1011, "delivery failed");
        }
      }
    }
    if (this.sockets.has(socket)) socket.serializeAttachment(attachment);
  }

  webSocketClose(socket: HibernatingSocket, code: number, reason: string): void {
    this.sockets.delete(socket);
    // 1005, 1006 and 1015 are reserved and cannot be sent in a close frame.
    if (code === 1005 || code === 1006 || code === 1015) return;
    socket.close(code, reason);
  }

  webSocketError(socket: HibernatingSocket): void {
    this.close(socket, 1011, "websocket error");
  }

  async alarm(): Promise<void> {
    const now = Date.now();
    let next = Infinity;
    for (const [socket, attachment] of this.sockets) {
      const deadline = attachment.lastRefillMs + idleMs;
      if (deadline <= now) this.close(socket, 1008, "signaling idle");
      else next = Math.min(next, deadline);
    }
    if (Number.isFinite(next)) await this.state.storage.setAlarm(next);
  }

  private reject(socket: HibernatingSocket, reason: string): void {
    this.close(socket, 1008, reason);
  }

  private close(socket: HibernatingSocket, code: number, reason: string): void {
    this.sockets.delete(socket);
    socket.serializeAttachment({ topics: [], tokens: 0, lastRefillMs: 0 });
    if (socket.readyState < 2) socket.close(code, reason);
  }
}
