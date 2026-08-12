/**
 * Wire format helpers for the Trystero adapter.
 *
 * Trystero actions deliver one payload plus a `metadata` (JsonValue) object
 * per message, multiplexed over the peer's single reliable-ordered data
 * channel. The adapter uses one action namespace (`"nova"`) for every
 * message and carries the transport envelope (messageId, sentAt, channel,
 * sessionId, seq, deliverySeq, binary flag, serialized size) in the
 * metadata, so the receiver can rebuild the interface's `TransportMessage`
 * without guessing. This keeps channel names free of Trystero's 32-byte
 * action-name limit and matches how the F5 spike carried `sentAt`/`totalBytes`
 * metadata for large transfers.
 *
 * Peer identity (memberId + connectionId + displayName) is exchanged during
 * Trystero's built-in peer handshake, mirroring the F5 spike's admission
 * handshake pattern. The handshake runs before a peer is activated, so
 * `peer:joined` always carries the peer's real identity.
 */

/** One message envelope serialized into Trystero action metadata. */
export interface WireEnvelope {
  /** Wire format version (1). */
  readonly v: 1;
  readonly messageId: string;
  readonly sentAt: number;
  readonly channel: string;
  readonly sessionId: string;
  readonly seq?: number;
  readonly version?: number;
  readonly deliverySeq?: number;
  readonly binary?: boolean;
  /** Serialized payload size in bytes (drives progress accounting). */
  readonly totalBytes?: number;
}

/** Inputs for {@link buildWireEnvelope}. */
export interface WireEnvelopeInput {
  readonly messageId: string;
  readonly sentAt: number;
  readonly channel: string;
  readonly sessionId: string;
  readonly seq?: number;
  readonly version?: number;
  readonly deliverySeq?: number;
  readonly binary?: boolean;
  readonly totalBytes?: number;
}

/** Build a wire envelope (optional fields via spread, keep types immutable). */
export function buildWireEnvelope(input: WireEnvelopeInput): WireEnvelope {
  return {
    v: 1,
    messageId: input.messageId,
    sentAt: input.sentAt,
    channel: input.channel,
    sessionId: input.sessionId,
    ...(input.seq !== undefined ? { seq: input.seq } : {}),
    ...(input.version !== undefined ? { version: input.version } : {}),
    ...(input.deliverySeq !== undefined ? { deliverySeq: input.deliverySeq } : {}),
    ...(input.binary === true ? { binary: true } : {}),
    ...(input.totalBytes !== undefined ? { totalBytes: input.totalBytes } : {}),
  };
}

/** Payload exchanged during the peer identity handshake. */
export interface IdentityPayload {
  readonly v: 1;
  readonly memberId: string;
  readonly connectionId: string;
  readonly displayName?: string;
}

const IDENTITY_VALIDATOR = {
  memberId: (value: string): boolean => value.length >= 1 && value.length <= 64,
  connectionId: (value: string): boolean => value.length >= 1 && value.length <= 64,
  displayName: (value: string): boolean => value.length >= 1 && value.length <= 32,
};

/**
 * Validate an identity payload received from a peer. The adapter never
 * trusts peer input (threat model T10); malformed identities fail the
 * handshake, which fails the peer with a structured join error.
 */
export function parseIdentityPayload(value: unknown): IdentityPayload | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const candidate = value as Record<string, unknown>;
  if (candidate["v"] !== 1) {
    return null;
  }
  const memberId = candidate["memberId"];
  const connectionId = candidate["connectionId"];
  const displayName = candidate["displayName"];
  if (typeof memberId !== "string" || !IDENTITY_VALIDATOR.memberId(memberId)) {
    return null;
  }
  if (typeof connectionId !== "string" || !IDENTITY_VALIDATOR.connectionId(connectionId)) {
    return null;
  }
  if (displayName !== undefined) {
    if (typeof displayName !== "string" || !IDENTITY_VALIDATOR.displayName(displayName)) {
      return null;
    }
  }
  return { v: 1, memberId, connectionId, displayName };
}

/**
 * Validate the wire envelope decoded from received metadata. Returns null
 * for malformed metadata (dropped, never delivered — T10).
 */
export function parseWireEnvelope(value: unknown): WireEnvelope | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const candidate = value as Record<string, unknown>;
  if (candidate["v"] !== 1) {
    return null;
  }
  const messageId = candidate["messageId"];
  const sentAt = candidate["sentAt"];
  const channel = candidate["channel"];
  const sessionId = candidate["sessionId"];
  if (typeof messageId !== "string" || messageId.length === 0) {
    return null;
  }
  if (typeof sentAt !== "number" || !Number.isFinite(sentAt)) {
    return null;
  }
  if (typeof channel !== "string" || channel.length === 0) {
    return null;
  }
  if (typeof sessionId !== "string" || sessionId.length === 0) {
    return null;
  }
  return buildWireEnvelope({
    messageId,
    sentAt,
    channel,
    sessionId,
    ...(typeof candidate["seq"] === "number" &&
    Number.isInteger(candidate["seq"]) &&
    (candidate["seq"] as number) >= 0
      ? { seq: candidate["seq"] as number }
      : {}),
    ...(typeof candidate["version"] === "number" && Number.isInteger(candidate["version"])
      ? { version: candidate["version"] as number }
      : {}),
    ...(typeof candidate["deliverySeq"] === "number" &&
    Number.isInteger(candidate["deliverySeq"]) &&
    (candidate["deliverySeq"] as number) > 0
      ? { deliverySeq: candidate["deliverySeq"] as number }
      : {}),
    ...(candidate["binary"] === true || candidate["binary"] === false
      ? { binary: candidate["binary"] === true }
      : {}),
    ...(typeof candidate["totalBytes"] === "number" &&
    Number.isInteger(candidate["totalBytes"]) &&
    (candidate["totalBytes"] as number) >= 0
      ? { totalBytes: candidate["totalBytes"] as number }
      : {}),
  });
}

/** True when the payload is a raw binary blob (ADR-0006 raw mode). */
export function isBinaryPayload(payload: unknown): boolean {
  return payload instanceof Uint8Array || payload instanceof ArrayBuffer;
}

/** Normalize a received binary payload to a detached Uint8Array copy. */
export function normalizePayload(payload: unknown): unknown {
  if (payload instanceof Uint8Array) {
    return payload.slice();
  }
  if (payload instanceof ArrayBuffer) {
    return new Uint8Array(payload).slice();
  }
  if (ArrayBuffer.isView(payload)) {
    return new Uint8Array(payload.buffer, payload.byteOffset, payload.byteLength).slice();
  }
  return payload;
}

/** Serialized size of a payload in bytes (progress accounting). */
export function payloadSize(payload: unknown): number {
  if (payload instanceof Uint8Array) {
    return payload.byteLength;
  }
  if (payload instanceof ArrayBuffer) {
    return payload.byteLength;
  }
  if (ArrayBuffer.isView(payload)) {
    return payload.byteLength;
  }
  if (typeof payload === "string") {
    return new TextEncoder().encode(payload).byteLength;
  }
  const json = JSON.stringify(payload);
  return json === undefined ? 0 : new TextEncoder().encode(json).byteLength;
}
