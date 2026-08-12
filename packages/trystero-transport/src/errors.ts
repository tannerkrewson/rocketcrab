/**
 * Join-error mapping (P1 deliverable; F5 finding F5 / S9).
 *
 * Trystero surfaces structured `JoinError`s only for handshake-stage
 * failures (password mismatch, admission rejection, handshake timeout, SDP
 * exchange failure). It does NOT report unreachable relays — the socket stays
 * CLOSED and Trystero silently retries with backoff. The adapter therefore
 * detects relay failures itself (relay `readyState` monitoring + join
 * timeouts, see `trystero-transport.ts`) and reports both sources through one
 * user-actionable category union.
 */

/** User-actionable join failure categories (F5 recommendation table). */
export type TrysteroJoinErrorCategory =
  /** Wrong room password (F8: structured Trystero error). */
  | "password_mismatch"
  /** Peer rejected the join/admission or the identity handshake failed. */
  | "rejected"
  /** Peer handshake timed out (Trystero `handshakeTimeoutMs`). */
  | "handshake_timeout"
  /** Peer disconnected while negotiating. */
  | "peer_disconnected"
  /** SDP/ICE exchange failed — TURN likely required (F5 S3, Blocker B2). */
  | "peer_connection_failed"
  /** Adapter-detected: no relay socket reached OPEN within the timeout. */
  | "relay_unreachable"
  /** Adapter-detected: join did not complete within the overall timeout. */
  | "join_timeout"
  /** Local usage error: already in a room. */
  | "already_joined"
  /** Local usage error: operation requires a live connection. */
  | "not_connected"
  /** Local usage error: operation not valid in the current state. */
  | "invalid_state"
  /** The operation was cancelled (e.g. leave() during join). */
  | "cancelled"
  /** Anything Trystero reports that we cannot classify. */
  | "unknown";

/** Categories that can never recover without user action (S1 retry UX). */
const FATAL_CATEGORIES: ReadonlySet<TrysteroJoinErrorCategory> = new Set([
  "password_mismatch",
  "relay_unreachable",
  "join_timeout",
  "cancelled",
]);

export interface TrysteroJoinErrorDetails {
  readonly category: TrysteroJoinErrorCategory;
  readonly message: string;
  /** Trystero peer ID of the failing peer, when Trystero supplied one. */
  readonly peerId?: string;
  readonly appId?: string;
  readonly roomId?: string;
  readonly cause?: unknown;
}

/** Structured, categorized join error surfaced by the adapter. */
export class TrysteroJoinError extends Error {
  readonly category: TrysteroJoinErrorCategory;
  readonly peerId?: string;
  readonly appId?: string;
  readonly roomId?: string;
  override readonly cause?: unknown;

  constructor(details: TrysteroJoinErrorDetails) {
    super(details.message);
    this.name = "TrysteroJoinError";
    this.category = details.category;
    this.peerId = details.peerId;
    this.appId = details.appId;
    this.roomId = details.roomId;
    if (details.cause !== undefined) {
      this.cause = details.cause;
    }
  }

  /** True when retrying without user input cannot succeed (S1 retry UX). */
  get isFatal(): boolean {
    return FATAL_CATEGORIES.has(this.category);
  }
}

/** Raw join error Trystero passes to `onJoinError`. */
export interface TrysteroJoinErrorReport {
  readonly error: string;
  readonly appId: string;
  readonly roomId: string;
  readonly peerId: string;
}

/**
 * Map a Trystero `onJoinError` report (or any error message) to a
 * user-actionable category. Order matters: password errors and SDP exchange
 * failures have very specific phrasing (verified from Trystero 0.25.3
 * sources and the F5/F8 findings).
 */
export function categorizeJoinError(message: string): TrysteroJoinErrorCategory {
  if (/password/i.test(message)) {
    return "password_mismatch";
  }
  if (/handshake timed out/i.test(message)) {
    return "handshake_timeout";
  }
  if (/could not connect to peer/i.test(message)) {
    return "peer_connection_failed";
  }
  if (/disconnected during handshake/i.test(message)) {
    return "peer_disconnected";
  }
  if (/admission|rejected|handshake failed/i.test(message)) {
    return "rejected";
  }
  return "unknown";
}

/** Build a categorized error from a Trystero join-error report. */
export function toTrysteroJoinError(report: TrysteroJoinErrorReport): TrysteroJoinError {
  return new TrysteroJoinError({
    category: categorizeJoinError(report.error),
    message: report.error,
    peerId: report.peerId,
    appId: report.appId,
    roomId: report.roomId,
  });
}
