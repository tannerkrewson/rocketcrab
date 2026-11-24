/**
 * Hibernating per-pair WebSocket tunnel (GET /tunnel/:pairId).
 *
 * The server sends text `paired` once when the second socket joins. Client
 * data must be binary; text closes both sides with 1003 so it cannot spoof
 * control frames. Before pairing, drop rather than buffer data; afterward,
 * losing the partner closes the sender with 1011. Protocol violations close
 * the whole pair because silent drops would corrupt an ordered channel.
 *
 * Socket attachments retain pairing generations, server-close flags, and
 * token buckets across hibernation. Derive pairing from live sockets and
 * attachments, not memory. Mark server closes before sending them and match
 * partners by generation so late close echoes cannot reach a new pair.
 *
 * Awake buckets live in memory and are persisted on close or traffic-driven
 * interval/spend thresholds. Rebuilding from attachments can over-credit
 * at most about one second of rate (see deploy/README.md).
 *
 * A Durable Object alarm enforces the lone-socket deadline across hibernation;
 * ordinary timers would not survive. Clear it when the second socket joins.
 */

import { jsonError } from "./http";

/**
 * Largest binary frame. The client's payload budget is 256 KiB, and each
 * encrypted frame adds 29 bytes of AES-GCM framing (1 tag byte, a 12-byte IV
 * and a 16-byte GCM tag). The 64-byte allowance covers that with margin.
 */
export const MAX_TUNNEL_FRAME_BYTES = 262144 + 64;
/**
 * Allow the 256 KiB/s game budget plus up-to-2 MiB source transfers: sustain
 * 512 KiB/s with a 4 MiB burst. Exhausting a bucket closes the pair with 1008.
 */
export const RATE_BYTES_PER_SECOND = 512 * 1024;
export const BURST_BYTES = 4 * 1024 * 1024;
// Every frame costs a Durable Object event even when its payload is empty.
export const MIN_TUNNEL_FRAME_CHARGE = 256;
/**
 * Persist on traffic after one second or 512 KiB spent, and on close. A wake
 * may restore unpersisted spending, bounded to about one second of refill.
 */
const PERSIST_INTERVAL_MS = 1000;
const PERSIST_SPENT_BYTES = 512 * 1024;
/** A lone socket is dropped if no partner arrives within this window. */
export const PARTNER_WAIT_MS = 30_000;
/** Server-to-client text frame sent to both sides once the pair is complete. */
export const PAIRED_FRAME = "paired";
const MAX_SOCKETS = 2;
const OPEN = 1;
const CLOSING = 2;

interface Attachment {
  /** Shared by the two sockets of one pair; null until paired. */
  generation: string | null;
  /** Set before the server closes the socket, so its close echo is ignored. */
  closedByServer: boolean;
  /** Token bucket as last written: bytes available as of `lastRefillMs`. */
  tokens: number;
  lastRefillMs: number;
}

/** A socket's bucket while the object is awake. */
interface Bucket {
  tokens: number;
  lastRefillMs: number;
  /** The `lastRefillMs` last written to the attachment. */
  persistedMs: number;
  spentSincePersist: number;
}

type TunnelSocket = WebSocket & {
  serializeAttachment(value: Attachment): void;
  deserializeAttachment(): Attachment | null;
};

interface TunnelState {
  acceptWebSocket(socket: TunnelSocket): void;
  getWebSockets(): TunnelSocket[];
  storage: {
    setAlarm(scheduledTime: number): void | Promise<void>;
    deleteAlarm(): void | Promise<void>;
  };
}

declare const WebSocketPair: { new (): { 0: WebSocket; 1: WebSocket } };

/** Stands in for a socket whose attachment is missing: treated as already closed. */
const DEAD: Attachment = { generation: null, closedByServer: true, tokens: 0, lastRefillMs: 0 };

function attachmentOf(socket: TunnelSocket): Attachment {
  return socket.deserializeAttachment() ?? DEAD;
}

/** Close codes a server may send in a close frame (RFC 6455 §7.4). 1010 is client-only. */
export function sendableCloseCode(code: number): boolean {
  return (
    (code >= 1000 && code <= 1003) ||
    (code >= 1007 && code <= 1009) ||
    code === 1011 ||
    (code >= 3000 && code <= 4999)
  );
}

function refilled(bucket: Bucket, now: number): number {
  const elapsed = Math.max(0, now - bucket.lastRefillMs);
  return Math.min(BURST_BYTES, bucket.tokens + (elapsed / 1000) * RATE_BYTES_PER_SECOND);
}

function settle(operation: () => void | Promise<void>): Promise<void> {
  return new Promise<void>((resolve) => resolve(operation())).catch(() => undefined);
}

export class TunnelPair {
  /** Buckets for sockets touched since this object woke. Rebuilt from attachments after wake. */
  private readonly buckets = new Map<TunnelSocket, Bucket>();

  constructor(private readonly ctx: TunnelState) {}

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("WebSocket upgrade required", { status: 426 });
    }
    const live = this.live();
    if (live.length >= MAX_SOCKETS) {
      return jsonError(409, "pair_full", "tunnel pair already has two sockets");
    }
    // A paired socket whose partner is mid-close must not take a newcomer as its
    // new partner: the newcomer would see the old pair's close. Clients retry 409.
    if (live.length === 1 && attachmentOf(live[0]!).generation !== null) {
      return jsonError(409, "pair_closing", "previous tunnel pair is still closing; retry");
    }
    const pair = new WebSocketPair();
    const server = pair[1] as TunnelSocket;
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({
      generation: null,
      closedByServer: false,
      tokens: BURST_BYTES,
      lastRefillMs: Date.now(),
    });
    if (live.length === 0) {
      // First socket: start the partner clock. Hibernation keeps the alarm.
      try {
        await this.ctx.storage.setAlarm(Date.now() + PARTNER_WAIT_MS);
      } catch (error) {
        this.close(server, 1011, "partner timer unavailable");
        throw error;
      }
    } else {
      // A fresh generation isolates this pair from late close echoes.
      // If alarm clearing fails, alarm() is harmless while both sockets are live.
      const generation = crypto.randomUUID();
      const partner = live[0]!;
      this.write(partner, { generation });
      this.write(server, { generation });
      await settle(() => this.ctx.storage.deleteAlarm());
      partner.send(PAIRED_FRAME);
      server.send(PAIRED_FRAME);
    }
    return new Response(null, { status: 101, webSocket: pair[0] } as ResponseInit);
  }

  webSocketMessage(socket: TunnelSocket, message: string | ArrayBuffer): void {
    const att = attachmentOf(socket);
    if (att.closedByServer) return;
    if (typeof message === "string") {
      // Data is binary only. Text would let a client impersonate the control channel.
      this.closePair(socket, 1003, "binary only");
      return;
    }
    if (message.byteLength > MAX_TUNNEL_FRAME_BYTES) {
      this.closePair(socket, 1009, "message too big");
      return;
    }
    // Charged before the partner check, so a lone socket cannot spam drops either.
    // Fails closed: a missing or NaN bucket is an empty bucket, and `!(>=)` also
    // refuses NaN.
    const now = Date.now();
    const bucket = this.bucketOf(socket, now);
    const tokens = refilled(bucket, now);
    const charge = Math.max(MIN_TUNNEL_FRAME_CHARGE, message.byteLength);
    if (!(tokens >= charge)) {
      this.closePair(socket, 1008, "rate limit");
      return;
    }
    bucket.tokens = tokens - charge;
    bucket.lastRefillMs = now;
    bucket.spentSincePersist += charge;
    if (
      bucket.lastRefillMs - bucket.persistedMs >= PERSIST_INTERVAL_MS ||
      bucket.spentSincePersist >= PERSIST_SPENT_BYTES
    )
      this.write(socket, {});
    if (att.generation === null) return;
    const partner = this.partnerOf(socket);
    if (partner === undefined || partner.readyState !== OPEN) {
      this.close(socket, 1011, "partner gone");
      return;
    }
    partner.send(message);
  }

  webSocketClose(socket: TunnelSocket, code: number, _reason: string): void {
    // 1005, 1006 and 1015 are reserved and cannot be sent in a close frame.
    const forwarded = sendableCloseCode(code) ? code : 1000;
    const echo = attachmentOf(socket).closedByServer;
    this.answer(socket, forwarded, "closed");
    if (echo) return;
    this.dissolve(socket, forwarded, "partner closed");
  }

  webSocketError(socket: TunnelSocket): void {
    const echo = attachmentOf(socket).closedByServer;
    this.answer(socket, 1011, "websocket error");
    if (echo) return;
    this.dissolve(socket, 1011, "partner error");
  }

  alarm(): void {
    const sockets = this.live();
    if (sockets.length >= MAX_SOCKETS) return;
    for (const socket of sockets) this.close(socket, 4408, "no partner");
  }

  /**
   * Writes the attachment. A known bucket is included, so an attachment write
   * never rolls the stored bucket back to an older value.
   */
  private write(socket: TunnelSocket, patch: Partial<Attachment>): void {
    const bucket = this.buckets.get(socket);
    const bucketFields = bucket ? { tokens: bucket.tokens, lastRefillMs: bucket.lastRefillMs } : {};
    socket.serializeAttachment({ ...attachmentOf(socket), ...bucketFields, ...patch });
    if (bucket) {
      bucket.persistedMs = bucket.lastRefillMs;
      bucket.spentSincePersist = 0;
    }
  }

  private bucketOf(socket: TunnelSocket, now: number): Bucket {
    const known = this.buckets.get(socket);
    if (known) return known;
    const att = attachmentOf(socket);
    // A missing, NaN or infinite field makes the bucket empty: fail closed.
    const intact = Number.isFinite(att.tokens) && Number.isFinite(att.lastRefillMs);
    const bucket: Bucket = intact
      ? {
          tokens: att.tokens,
          lastRefillMs: att.lastRefillMs,
          persistedMs: att.lastRefillMs,
          spentSincePersist: 0,
        }
      : { tokens: 0, lastRefillMs: now, persistedMs: now, spentSincePersist: 0 };
    this.buckets.set(socket, bucket);
    return bucket;
  }

  /** Starts a server close: marks the socket first so its echo is ignored. */
  private close(socket: TunnelSocket, code: number, reason: string): void {
    if (socket.readyState >= CLOSING || attachmentOf(socket).closedByServer) return;
    this.write(socket, { closedByServer: true });
    this.buckets.delete(socket);
    try {
      socket.close(code, reason);
    } catch {
      // The socket went away between the check and the close; nothing to send.
    }
  }

  /**
   * Completes a close handshake the peer started. Unlike close(), it does not
   * skip a socket already marked closing, because that is the state a socket
   * is in while the handshake is waiting for this call.
   */
  private answer(socket: TunnelSocket, code: number, reason: string): void {
    this.write(socket, { closedByServer: true });
    this.buckets.delete(socket);
    try {
      socket.close(code, reason);
    } catch {
      // The peer may finish closing before its handshake answer is sent.
    }
  }

  /** Open sockets that the server has not already closed. */
  private live(): TunnelSocket[] {
    return this.ctx
      .getWebSockets()
      .filter((socket) => socket.readyState < CLOSING && !attachmentOf(socket).closedByServer);
  }

  /** The open socket paired with `socket` in the same generation, if any. */
  private partnerOf(socket: TunnelSocket): TunnelSocket | undefined {
    const generation = attachmentOf(socket).generation;
    if (generation === null) return undefined;
    return this.live().find(
      (candidate) => candidate !== socket && attachmentOf(candidate).generation === generation,
    );
  }

  private closePair(socket: TunnelSocket, code: number, reason: string): void {
    const partner = this.partnerOf(socket);
    this.close(socket, code, reason);
    if (partner) this.close(partner, code, reason);
  }

  private dissolve(gone: TunnelSocket, code: number, reason: string): void {
    const partner = this.partnerOf(gone);
    if (partner) this.close(partner, code, reason);
    else void settle(() => this.ctx.storage.deleteAlarm());
  }
}
