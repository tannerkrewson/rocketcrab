/** Map Trystero 0.27 typed room errors and adapter failures to actionable categories. */

import type { RoomError, RoomErrorCode } from "@trystero-p2p/ws-relay";

/** User-actionable join failure categories (F5 recommendation table). */
export type TrysteroJoinErrorCategory =
  /** Wrong room password (F8: structured Trystero error). */
  | "password_mismatch"
  /** The remote room has reached its configured capacity. */
  | "room_full"
  /** Incompatible transport/action wire format; all players must reload. */
  | "incompatible_version"
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
  "room_full",
  "incompatible_version",
  "relay_unreachable",
  "join_timeout",
  "cancelled",
]);

export interface TrysteroJoinErrorDetails {
  readonly category: TrysteroJoinErrorCategory;
  readonly code?: RoomErrorCode;
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
  readonly code?: RoomErrorCode;
  readonly peerId?: string;
  readonly appId?: string;
  readonly roomId?: string;
  override readonly cause?: unknown;

  constructor(details: TrysteroJoinErrorDetails) {
    super(details.message);
    this.name = "TrysteroJoinError";
    this.category = details.category;
    this.code = details.code;
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

/** Map 0.27 room errors by code, never by implementation-specific wording. */
export function fromRoomError(error: RoomError): TrysteroJoinError {
  const categories: Record<RoomErrorCode, TrysteroJoinErrorCategory> = {
    "room-full": "room_full",
    banned: "rejected",
    "relay-failed": "relay_unreachable",
    "identity-failed": "invalid_state",
    "plugin-failed": "invalid_state",
    "decrypt-failed": "password_mismatch",
    "peer-connect-failed": "peer_connection_failed",
    "handshake-failed": "rejected",
    "peer-error": "peer_disconnected",
  };
  return new TrysteroJoinError({
    category: categories[error.code],
    code: error.code,
    message: error.message,
    appId: error.appId,
    roomId: error.roomId,
    peerId: "peerId" in error ? error.peerId : undefined,
    cause: error.cause,
  });
}
