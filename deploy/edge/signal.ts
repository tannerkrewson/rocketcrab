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
}

declare const WebSocketPair: { new (): { 0: WebSocket; 1: HibernatingSocket } };

const validTopic = /^[A-Za-z0-9_-]+$/;
const maxFrameBytes = 262144;

export class SignalHub {
  constructor(private readonly state: SignalState) {}

  fetch(request: Request): Response {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("WebSocket upgrade required", { status: 426 });
    }
    const pair = new WebSocketPair();
    this.state.acceptWebSocket(pair[1]);
    pair[1].serializeAttachment({ topics: [], tokens: 400, lastRefillMs: Date.now() });
    return new Response(null, { status: 101, webSocket: pair[0] } as ResponseInit);
  }

  webSocketMessage(socket: HibernatingSocket, message: string | ArrayBuffer): void {
    const attachment = socket.deserializeAttachment();
    if (!attachment) return;
    const now = Date.now();
    attachment.tokens = Math.min(
      400,
      attachment.tokens + Math.max(0, now - attachment.lastRefillMs) * 0.2,
    );
    attachment.lastRefillMs = now;
    if (attachment.tokens < 1) return this.reject(socket, "rate limit exceeded");
    attachment.tokens -= 1;
    const size =
      typeof message === "string"
        ? new TextEncoder().encode(message).byteLength
        : message.byteLength;
    if (size > maxFrameBytes) {
      socket.close(1009, "message too big");
      return;
    }
    let value: unknown;
    try {
      value = JSON.parse(typeof message === "string" ? message : new TextDecoder().decode(message));
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
      for (const subscriber of this.state.getWebSockets()) {
        if (
          subscriber.readyState === 1 &&
          subscriber.deserializeAttachment()?.topics.includes(msg.topic)
        )
          subscriber.send(outgoing);
      }
    }
    socket.serializeAttachment(attachment);
  }

  webSocketClose(socket: HibernatingSocket, code: number, reason: string): void {
    socket.close(code, reason);
  }

  webSocketError(socket: HibernatingSocket): void {
    socket.close(1011, "websocket error");
  }

  private reject(socket: HibernatingSocket, reason: string): void {
    socket.serializeAttachment({ topics: [], tokens: 0, lastRefillMs: Date.now() });
    socket.close(1008, reason);
  }
}
