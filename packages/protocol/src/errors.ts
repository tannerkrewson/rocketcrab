import { z, type ZodIssue } from "zod";
import { envelopeVersionFieldSchema } from "./envelope";
import { PEER_MESSAGE_TYPES, peerMessagesSchema, type PeerMessage } from "./messages/peer";
import {
  RUNTIME_MESSAGE_TYPES,
  runtimeMessagesSchema,
  type RuntimeMessage,
} from "./messages/runtime";
import { SUPPORTED_PROTOCOL_VERSIONS, isSupportedProtocolVersion } from "./version";

/**
 * Protocol boundary parsing.
 *
 * Every external message is validated at the boundary (threat model T10;
 * engineering rules 15/21): no `any` is accepted, unknown protocol versions
 * fail with a useful error, and unknown message types fail with the list of
 * supported types.
 */

/** Failure modes when parsing protocol messages. */
export type ProtocolErrorCode =
  | "invalid_envelope" // not an object, or missing/non-integer version field
  | "unsupported_version" // valid integer, but not a supported protocol version
  | "unknown_message_type" // supported version, but unrecognized message type
  | "invalid_message"; // envelope and type OK, payload failed validation

/** Structured error produced when a protocol message fails validation. */
export class ProtocolError extends Error {
  readonly code: ProtocolErrorCode;
  readonly issues: ZodIssue[];

  constructor(code: ProtocolErrorCode, message: string, issues: ZodIssue[] = []) {
    super(message);
    this.name = "ProtocolError";
    this.code = code;
    this.issues = issues;
  }
}

/** Result of a boundary parse: a validated message or a structured error. */
export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: ProtocolError };

function parseVersioned<T>(
  data: unknown,
  messageSchema: z.ZodType<T>,
  knownTypes: readonly string[],
  messageKind: "peer" | "runtime",
): ParseResult<T> {
  const versionCheck = envelopeVersionFieldSchema.safeParse(data);
  if (!versionCheck.success) {
    return {
      ok: false,
      error: new ProtocolError(
        "invalid_envelope",
        "Protocol message must be an object with an integer `version` field.",
        versionCheck.error.issues,
      ),
    };
  }
  if (!isSupportedProtocolVersion(versionCheck.data.version)) {
    return {
      ok: false,
      error: new ProtocolError(
        "unsupported_version",
        `Unsupported protocol version ${versionCheck.data.version}. Supported versions: [${SUPPORTED_PROTOCOL_VERSIONS.join(", ")}].`,
      ),
    };
  }
  const typeCheck = z.object({ type: z.string() }).safeParse(data);
  if (typeCheck.success && !knownTypes.includes(typeCheck.data.type)) {
    return {
      ok: false,
      error: new ProtocolError(
        "unknown_message_type",
        `Unknown ${messageKind} message type "${typeCheck.data.type}". Supported types: [${knownTypes.join(", ")}].`,
      ),
    };
  }
  const result = messageSchema.safeParse(data);
  if (result.success) {
    return { ok: true, value: result.data };
  }
  return {
    ok: false,
    error: new ProtocolError(
      "invalid_message",
      `Invalid ${messageKind} message; see issues for details.`,
      result.error.issues,
    ),
  };
}

/** Validate an incoming peer-plane message at the protocol boundary. */
export function parsePeerMessage(data: unknown): ParseResult<PeerMessage> {
  return parseVersioned(data, peerMessagesSchema, PEER_MESSAGE_TYPES, "peer");
}

/** Validate an incoming runtime-plane message at the protocol boundary. */
export function parseRuntimeMessage(data: unknown): ParseResult<RuntimeMessage> {
  return parseVersioned(data, runtimeMessagesSchema, RUNTIME_MESSAGE_TYPES, "runtime");
}

/** Type guard over {@link parsePeerMessage}. */
export function isPeerMessage(data: unknown): data is PeerMessage {
  return parsePeerMessage(data).ok;
}

/** Type guard over {@link parseRuntimeMessage}. */
export function isRuntimeMessage(data: unknown): data is RuntimeMessage {
  return parseRuntimeMessage(data).ok;
}

/** Parse or throw {@link ProtocolError} for a peer-plane message. */
export function assertPeerMessage(data: unknown): PeerMessage {
  const result = parsePeerMessage(data);
  if (!result.ok) {
    throw result.error;
  }
  return result.value;
}

/** Parse or throw {@link ProtocolError} for a runtime-plane message. */
export function assertRuntimeMessage(data: unknown): RuntimeMessage {
  const result = parseRuntimeMessage(data);
  if (!result.ok) {
    throw result.error;
  }
  return result.value;
}
