import {
  PROTOCOL_VERSION,
  assertPeerMessage,
  parsePeerMessage,
  partyContextMessageSchema,
  partyRenameMessageSchema,
  partyClassicRoomMessageSchema,
  partyClassicRoomRequestMessageSchema,
  partyKickMessageSchema,
  partyReloadAllMessageSchema,
  type ClassicUrlSpecMessage,
  type ParseResult,
  type PeerMessage,
} from "@rocketcrab/protocol";

/**
 * Party control message builders and parsing (P2).
 *
 * Control traffic stays inside the private password-protected party room.
 * Messages are validated before sending and again against the transport sender
 * on receipt. The invite secret is never transmitted as a control message.
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

/** Build private shell-control context. */
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

/** Build and validate a `party.classicRoom` announcement (private room, 7.7.4). */
export function buildPartyClassicRoomMessage(
  base: PartyControlBase,
  input: {
    gameId: string;
    player: ClassicUrlSpecMessage;
    host?: Partial<ClassicUrlSpecMessage>;
  },
): PeerMessage {
  return assertPeerMessage(
    partyClassicRoomMessageSchema.parse({
      ...envelope(base),
      type: "party.classicRoom",
      gameId: input.gameId,
      player: input.player,
      ...(input.host !== undefined ? { host: input.host } : {}),
    }),
  );
}

/** Build and validate a `party.classicRoom.request` (private room, 7.7.4). */
export function buildPartyClassicRoomRequestMessage(base: PartyControlBase): PeerMessage {
  return assertPeerMessage(
    partyClassicRoomRequestMessageSchema.parse({
      ...envelope(base),
      type: "party.classicRoom.request",
    }),
  );
}

/** Build and validate a `party.kick` (private room, 7.29). */
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

/** Build and validate a `party.reloadAll` (private room, 7.29). */
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
