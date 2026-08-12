/**
 * Outgoing peer-plane message construction for the Nova session.
 *
 * Every message the session sends is built from its Zod schema and validated
 * with `assertPeerMessage` before it touches the transport (threat model
 * T10; engineering rules 15/21 — never emit an unvalidated message, no
 * `any` at the boundary).
 */
import {
  PROTOCOL_VERSION,
  actionDispatchMessageSchema,
  assertPeerMessage,
  gameEndMessageSchema,
  gameReadyMessageSchema,
  gameStartMessageSchema,
  playerIdentityMessageSchema,
  rawChannelMetadataMessageSchema,
  simulationInputMessageSchema,
  type GameEndReason,
  type PeerMessage,
} from "@rocketcrab/protocol";
import { newMessageId, nowSentAt } from "./ids";

/** Envelope fields every peer message from this session carries. */
export interface PeerMessageBase {
  readonly sessionId: string;
  readonly senderMemberId: string;
  readonly senderConnectionId: string;
}

function envelope(base: PeerMessageBase) {
  return {
    version: PROTOCOL_VERSION,
    sessionId: base.sessionId,
    senderMemberId: base.senderMemberId,
    senderConnectionId: base.senderConnectionId,
    messageId: newMessageId(),
    sentAt: nowSentAt(),
  };
}

/** Build and validate a `game.ready` announcement. */
export function buildGameReadyMessage(base: PeerMessageBase): PeerMessage {
  return assertPeerMessage(gameReadyMessageSchema.parse({ ...envelope(base), type: "game.ready" }));
}

/** Build and validate a `game.start` announcement. */
export function buildGameStartMessage(base: PeerMessageBase): PeerMessage {
  return assertPeerMessage(gameStartMessageSchema.parse({ ...envelope(base), type: "game.start" }));
}

/** Build and validate a `game.end` announcement. */
export function buildGameEndMessage(base: PeerMessageBase, reason: GameEndReason): PeerMessage {
  return assertPeerMessage(
    gameEndMessageSchema.parse({ ...envelope(base), type: "game.end", reason }),
  );
}

/** Build and validate a `player.identity` announcement. */
export function buildPlayerIdentityMessage(
  base: PeerMessageBase,
  displayName: string,
): PeerMessage {
  return assertPeerMessage(
    playerIdentityMessageSchema.parse({
      ...envelope(base),
      type: "player.identity",
      displayName,
      // S1 has no authority election (S3 owns it); every player is eligible
      // so no game code ever needs to reason about authority roles.
      authorityEligible: true,
    }),
  );
}

/** Build and validate an `action.dispatch` message (state mode). */
export function buildActionDispatchMessage(
  base: PeerMessageBase,
  input: {
    seq: number;
    actionId: string;
    baseRevision: number;
    actionType: string;
    payload: unknown;
  },
): PeerMessage {
  return assertPeerMessage(
    actionDispatchMessageSchema.parse({
      ...envelope(base),
      seq: input.seq,
      type: "action.dispatch",
      actionId: input.actionId,
      baseRevision: input.baseRevision,
      actionType: input.actionType,
      payload: input.payload,
    }),
  );
}

/** Build and validate a `raw.channel` declaration (raw mode). */
export function buildRawChannelMessage(
  base: PeerMessageBase,
  spec: {
    channelName: string;
    reliability: "reliable" | "unreliable";
    ordering: "ordered" | "unordered";
    binaryPayloads: boolean;
    broadcast: boolean;
  },
): PeerMessage {
  return assertPeerMessage(
    rawChannelMetadataMessageSchema.parse({
      ...envelope(base),
      type: "raw.channel",
      ...spec,
    }),
  );
}

/** Build and validate a `simulation.input` message (simulation mode). */
export function buildSimulationInputMessage(
  base: PeerMessageBase,
  input: {
    seq: number;
    inputId: string;
    inputType: string;
    payload: unknown;
    targetTick?: number;
  },
): PeerMessage {
  return assertPeerMessage(
    simulationInputMessageSchema.parse({
      ...envelope(base),
      seq: input.seq,
      type: "simulation.input",
      inputId: input.inputId,
      inputType: input.inputType,
      payload: input.payload,
      ...(input.targetTick !== undefined ? { targetTick: input.targetTick } : {}),
    }),
  );
}
