import {
  PROTOCOL_VERSION,
  admissionResponseMessageSchema,
  assertPeerMessage,
  joinRequestMessageSchema,
  parsePeerMessage,
  partyGreeterMessageSchema,
  partyIdentityMessageSchema,
  partyRenameMessageSchema,
  partySessionMessageSchema,
  type PartyCode,
  type ParseResult,
  type PeerMessage,
} from "@rocketcrab/protocol";

/**
 * Party control message builders and parsing (P2).
 *
 * Pre-admission traffic (advert, join request, admission response, session
 * handoff) travels through the rendezvous room on this channel; post-
 * admission party control traffic (greeter announcements) travels through
 * the private room on the same channel. Every message is built from its Zod
 * schema and validated before it touches the transport (threat model T10;
 * engineering rules 15/21), and every inbound message is validated at the
 * boundary before it is acted on.
 *
 * The channel is distinct from `nova.protocol` (S1's game-facing channel),
 * so party control never reaches game code and game protocol messages never
 * reach the party layer.
 */

/** Transport channel carrying party control messages (P2). */
export const PARTY_CONTROL_CHANNEL = "nova.party";

/** Envelope fields every party control message carries. */
export interface PartyControlBase {
  readonly sessionId: string;
  readonly senderMemberId: string;
  readonly senderConnectionId: string;
}

function envelope(base: PartyControlBase) {
  return {
    version: PROTOCOL_VERSION,
    sessionId: base.sessionId,
    senderMemberId: base.senderMemberId,
    senderConnectionId: base.senderConnectionId,
    messageId: newMessageId(),
    sentAt: nowSentAt(),
  };
}

/** Build and validate a `party.identity` advert (ADR-0004 minimal summary). */
export function buildPartyIdentityMessage(
  base: PartyControlBase,
  input: {
    partyCode: PartyCode;
    partyName?: string;
    gameTitle?: string;
    memberCount: number;
    greeterMemberId: string;
  },
): PeerMessage {
  return assertPeerMessage(
    partyIdentityMessageSchema.parse({
      ...envelope(base),
      type: "party.identity",
      partyCode: input.partyCode,
      ...(input.partyName !== undefined ? { partyName: input.partyName } : {}),
      ...(input.gameTitle !== undefined ? { gameTitle: input.gameTitle } : {}),
      memberCount: input.memberCount,
      greeterMemberId: input.greeterMemberId,
    }),
  );
}

/** Build and validate a `join.request` (joiner → greeter). */
export function buildJoinRequestMessage(
  base: PartyControlBase,
  input: { partyCode: PartyCode; displayName: string },
): PeerMessage {
  return assertPeerMessage(
    joinRequestMessageSchema.parse({
      ...envelope(base),
      type: "join.request",
      partyCode: input.partyCode,
      displayName: input.displayName,
    }),
  );
}

/** Build and validate a `join.admission` response (greeter → joiner). */
export function buildAdmissionResponseMessage(
  base: PartyControlBase,
  input: {
    partyCode: PartyCode;
    decision: "approved" | "rejected";
    reason?: "party_full" | "greeter_rejected" | "timed_out" | "invalid_request";
  },
): PeerMessage {
  return assertPeerMessage(
    admissionResponseMessageSchema.parse({
      ...envelope(base),
      type: "join.admission",
      partyCode: input.partyCode,
      decision: input.decision,
      ...(input.reason !== undefined ? { reason: input.reason } : {}),
    }),
  );
}

/** Build and validate the post-admission `party.session` handoff. */
export function buildPartySessionMessage(
  base: PartyControlBase,
  input: { partyCode: PartyCode; secret: string },
): PeerMessage {
  return assertPeerMessage(
    partySessionMessageSchema.parse({
      ...envelope(base),
      type: "party.session",
      partyCode: input.partyCode,
      secret: input.secret,
    }),
  );
}

/** Build and validate a `party.greeter` announcement (private room). */
export function buildPartyGreeterMessage(
  base: PartyControlBase,
  input: { greeterMemberId: string },
): PeerMessage {
  return assertPeerMessage(
    partyGreeterMessageSchema.parse({
      ...envelope(base),
      type: "party.greeter",
      greeterMemberId: input.greeterMemberId,
    }),
  );
}

/** Build and validate a `party.rename` announcement (private room, 7.25). */
export function buildPartyRenameMessage(
  base: PartyControlBase,
  input: { displayName: string },
): PeerMessage {
  return assertPeerMessage(
    partyRenameMessageSchema.parse({
      ...envelope(base),
      type: "party.rename",
      displayName: input.displayName,
    }),
  );
}

/** Validate an inbound party control payload at the protocol boundary. */
export function parsePartyControlMessage(payload: unknown): ParseResult<PeerMessage> {
  return parsePeerMessage(payload);
}

/** True when a raw payload is a `join.request` (malformed ones included). */
export function looksLikeJoinRequest(payload: unknown): boolean {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    return false;
  }
  return (payload as Record<string, unknown>)["type"] === "join.request";
}

// ---------------------------------------------------------------------------
// Envelope ids/timestamps (same pattern as nova-api; kept local so the party
// package stays free of the game-facing API surface).
// ---------------------------------------------------------------------------

/** Unique protocol message ID (envelope requirement). */
export function newMessageId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

/** Epoch-millisecond timestamp for the message envelope. */
export function nowSentAt(): number {
  return Date.now();
}
