import { z } from "zod";
import {
  connectionIdSchema,
  memberIdSchema,
  messageIdSchema,
  monotonicSequenceSchema,
  runtimeInstanceIdSchema,
  sessionIdSchema,
  timestampSchema,
} from "./ids";
import { protocolVersionSchema } from "./version";

/**
 * Message envelopes.
 *
 * Two envelope shapes exist because messages cross two different boundaries:
 *
 * - **Peer envelopes** (party plane): messages between party members over the
 *   transport (U5/P1). Every peer message carries the protocol version,
 *   message type, session ID, sender member ID, sender connection ID, a
 *   unique message ID, a timestamp, and — for ordered message families — a
 *   per-sender monotonic sequence.
 * - **Runtime envelopes** (host ↔ runtime): messages between the Nova shell
 *   and the runtime frame over the dedicated MessageChannel (U3). They carry
 *   the protocol version, message type, runtime instance ID, message ID, and
 *   a timestamp; `sessionId` is present when the runtime is attached to a
 *   party session.
 */

/** Fields common to every peer message envelope. */
export const peerEnvelopeFields = {
  version: protocolVersionSchema,
  sessionId: sessionIdSchema,
  senderMemberId: memberIdSchema,
  senderConnectionId: connectionIdSchema,
  messageId: messageIdSchema,
  sentAt: timestampSchema,
  /** Per-sender monotonic sequence; required for ordered message families. */
  seq: monotonicSequenceSchema.optional(),
};

export const peerEnvelopeSchema = z.object(peerEnvelopeFields);
export type PeerEnvelope = z.infer<typeof peerEnvelopeSchema>;

/** Fields common to every host ↔ runtime message envelope. */
export const runtimeEnvelopeFields = {
  version: protocolVersionSchema,
  runtimeInstanceId: runtimeInstanceIdSchema,
  sessionId: sessionIdSchema.optional(),
  messageId: messageIdSchema,
  sentAt: timestampSchema,
};

export const runtimeEnvelopeSchema = z.object(runtimeEnvelopeFields);
export type RuntimeEnvelope = z.infer<typeof runtimeEnvelopeSchema>;

/**
 * Accepts any object with an integer `version` field. Used by the parse
 * helpers to produce a useful error for missing or unsupported versions
 * before full schema validation runs.
 */
export const envelopeVersionFieldSchema = z.object({
  version: z.number().int(),
});
