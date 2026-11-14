/**
 * Connection fallback tunnel: one hibernating Durable Object per pair
 * (`GET /tunnel/:pairId`). It forwards frames between exactly two sockets.
 *
 * Design notes (see PLAN.md §5):
 * - Control and data are kept apart. The server sends the text frame
 *   `paired` to each side exactly when the second socket is accepted. Client
 *   data frames must be binary (the client encrypts them); a client text
 *   frame closes both sockets with 1003, so text can never reach the peer.
 * - Nothing is stored in storage. Each socket's attachment (which survives
 *   hibernation, as in signal.ts) holds its pairing generation, a
 *   "closed by server" flag and a copy of its token bucket. Frames are
 *   forwarded as they arrive. Before pairing, a frame is dropped rather than
 *   buffered: the client only sends once `paired` has arrived. After pairing,
 *   a frame with no open partner closes the sender with 1011.
 * - While awake, each socket's bucket lives in memory. The attachment copy is
 *   written when a socket closes, at most once per second, and after every
 *   512 KiB spent since the last write. After a wake, buckets are rebuilt from
 *   the attachments. Spending since the last write is at most 512 KiB, so a
 *   woken socket is over-credited by at most about one second of rate. See the
 *   runbook.
 * - Pairing state is derived from `getWebSockets()` and the attachments on
 *   every event, not from memory, so it survives hibernation. `paired` is sent
 *   only from `fetch`, the one place a second socket joins, so a wake-up never
 *   repeats it.
 * - A close the server starts is marked in the socket's attachment before the
 *   close is sent. The peer's echo of that close is then ignored, so it cannot
 *   reach a socket that joined later. Partners are matched only within the
 *   same pairing generation.
 * - Dropping a frame silently would corrupt an ordered data channel, so any
 *   protocol violation (text, oversize or over-budget traffic) tears down the
 *   whole pair.
 * - Storage use is one Durable Object alarm per pairing lifecycle (set when the
 *   first socket joins, cleared when the second does). Timers do not survive
 *   hibernation; alarms do.
 */

import { jsonError } from "./http";

/**
 * Largest binary frame. The client's payload budget is 256 KiB, and each
 * encrypted frame adds 29 bytes of AES-GCM framing (1 tag byte, a 12-byte IV
 * and a 16-byte GCM tag). The 64-byte allowance covers that with margin.
 */
export const MAX_TUNNEL_FRAME_BYTES = 262144 + 64;
/**
 * Per-socket relay budget. Legitimate traffic is the 256 KiB/s game budget
 * (PLAN §6) plus up-to-2 MiB game-source transfers, so 512 KiB/s sustained
 * with a 4 MiB burst covers both. A socket that empties its bucket closes the
 * pair with 1008.
 */
export const RATE_BYTES_PER_SECOND = 512 * 1024;
export const BURST_BYTES = 4 * 1024 * 1024;
/**
 * The attachment copy of a bucket is written at least once per second, and
 * also after every 512 KiB spent. Spending not yet written is therefore always
 * under 512 KiB, so a wake over-credits by at most about one second of rate.
 */
const PERSIST_INTERVAL_MS = 1000;
const PERSIST_SPENT_BYTES = 512 * 1024;
/** A lone socket is dropped if no partner arrives within this window. */
export const PARTNER_WAIT_MS = 30_000;
/** Server-to-client text frame sent to both sides once the pair is complete. */
export const PAIRED_FRAME = "paired";
/** Pairs hold at most two sockets; a third connection gets HTTP 409. */
const MAX_SOCKETS = 2;
const OPEN = 1;
const CLOSING = 2;

/** Per-socket state, kept in the socket attachment. */
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
  /** Bytes spent since the last write. */
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

/** Bytes in the bucket at `now`, including refill since its last update. */
function refilled(bucket: Bucket, now: number): number {
  const elapsed = Math.max(0, now - bucket.lastRefillMs);
  return Math.min(BURST_BYTES, bucket.tokens + (elapsed / 1000) * RATE_BYTES_PER_SECOND);
}

/** Runs a storage call; a failure is swallowed (see the callers). */
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
      // Second socket: the pair is complete. Both sockets get a new generation,
      // so only they can be partners, and each side is told once. The
      // lone-socket deadline no longer applies; if clearing it fails, the alarm
      // is harmless (alarm() does nothing once two sockets are live).
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
    if (!(tokens >= message.byteLength)) {
      this.closePair(socket, 1008, "rate limit");
      return;
    }
    bucket.tokens = tokens - message.byteLength;
    bucket.lastRefillMs = now;
    bucket.spentSincePersist += message.byteLength;
    if (
      bucket.lastRefillMs - bucket.persistedMs >= PERSIST_INTERVAL_MS ||
      bucket.spentSincePersist >= PERSIST_SPENT_BYTES
    )
      this.write(socket, {});
    // Before pairing there is no partner yet: drop the frame (see module comment).
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
    // The echo of a close we started is not a new event; nothing to relay.
    if (echo) return;
    this.dissolve(socket, forwarded, "partner closed");
  }

  webSocketError(socket: TunnelSocket): void {
    const echo = attachmentOf(socket).closedByServer;
    this.answer(socket, 1011, "websocket error");
    if (echo) return;
    this.dissolve(socket, 1011, "partner error");
  }

  /** Runs when the partner deadline passes; does nothing once paired. */
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

  /** The socket's bucket, rebuilt from its attachment when this object has just woken. */
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
      // Already fully closed; nothing left to answer.
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

  /** Closes the sender and its partner with the same code and reason. */
  private closePair(socket: TunnelSocket, code: number, reason: string): void {
    const partner = this.partnerOf(socket);
    this.close(socket, code, reason);
    if (partner) this.close(partner, code, reason);
  }

  /** Closes whichever socket remains after `gone` has closed or errored. */
  private dissolve(gone: TunnelSocket, code: number, reason: string): void {
    const partner = this.partnerOf(gone);
    if (partner) this.close(partner, code, reason);
    else void settle(() => this.ctx.storage.deleteAlarm());
  }
}
