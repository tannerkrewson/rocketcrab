import {
  PROTOCOL_VERSION,
  assertPeerMessage,
  parsePeerMessage,
  partyContextMessageSchema,
  partyRenameMessageSchema,
  partyGamesMessageSchema,
  partyExternalRoomMessageSchema,
  partyExternalRoomRequestMessageSchema,
  partyKickMessageSchema,
  partyReloadAllMessageSchema,
  type ExternalRoom,
  type OfferedGame,
  type ParseResult,
  type PeerMessage,
} from "@rocketcrab/protocol";

/**
 * Party control message builders and parsing.
 *
 * Control traffic stays inside the private password-protected party room.
 * Messages are validated before sending and again against the transport sender
 * on receipt. The invite secret is never transmitted as a control message.
 *
 * The channel is distinct from `nova.protocol` (the game-facing channel),
 * so party control never reaches game code and game protocol messages never
 * reach the party layer.
 */

/** Transport channel carrying party control messages. */
export const PARTY_CONTROL_CHANNEL = "nova.party";

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

export function buildPartyContextMessage(
  base: PartyControlBase,
  input: { creatorMemberId: string },
): PeerMessage {
  return assertPeerMessage(
    partyContextMessageSchema.parse({
      ...envelope(base),
      type: "party.context",
      creatorMemberId: input.creatorMemberId,
    }),
  );
}

/** Build and validate a `party.rename` announcement (private room). */
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

/** Build and validate a `party.games` offer, replacing the sender's last one. */
export function buildPartyGamesMessage(
  base: PartyControlBase,
  input: { games: readonly OfferedGame[] },
): PeerMessage {
  return assertPeerMessage(
    partyGamesMessageSchema.parse({ ...envelope(base), type: "party.games", games: input.games }),
  );
}

/** Build and validate a `party.externalRoom` announcement (private room). */
export function buildPartyExternalRoomMessage(
  base: PartyControlBase,
  input: { gameId: string; room: ExternalRoom; creatorMemberId: string },
): PeerMessage {
  return assertPeerMessage(
    partyExternalRoomMessageSchema.parse({
      ...envelope(base),
      type: "party.externalRoom",
      gameId: input.gameId,
      room: input.room,
      creatorMemberId: input.creatorMemberId,
    }),
  );
}

/** Build and validate a `party.externalRoom.request` (private room). */
export function buildPartyExternalRoomRequestMessage(base: PartyControlBase): PeerMessage {
  return assertPeerMessage(
    partyExternalRoomRequestMessageSchema.parse({
      ...envelope(base),
      type: "party.externalRoom.request",
    }),
  );
}

/** Build and validate a `party.kick` (private room). */
export function buildPartyKickMessage(
  base: PartyControlBase,
  input: { targetMemberId: string; reason?: string },
): PeerMessage {
  return assertPeerMessage(
    partyKickMessageSchema.parse({
      ...envelope(base),
      type: "party.kick",
      targetMemberId: input.targetMemberId,
      ...(input.reason !== undefined ? { reason: input.reason } : {}),
    }),
  );
}

/** Build and validate a `party.reloadAll` (private room). */
export function buildPartyReloadAllMessage(base: PartyControlBase): PeerMessage {
  return assertPeerMessage(
    partyReloadAllMessageSchema.parse({
      ...envelope(base),
      type: "party.reloadAll",
    }),
  );
}

/** Validate an inbound party control payload at the protocol boundary. */
export function parsePartyControlMessage(payload: unknown): ParseResult<PeerMessage> {
  return parsePeerMessage(payload);
}

// ---------------------------------------------------------------------------
// Envelope ids/timestamps (same pattern as nova-api; kept local so the party
// package stays free of the game-facing API surface).
// ---------------------------------------------------------------------------

export function newMessageId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

export function nowSentAt(): number {
  return Date.now();
}
