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
  actionAcknowledgementMessageSchema,
  actionDispatchMessageSchema,
  assertPeerMessage,
  authorityAnnouncementMessageSchema,
  authorityElectionMessageSchema,
  authorityHeartbeatMessageSchema,
  gameEndMessageSchema,
  gameReadyMessageSchema,
  gameStartMessageSchema,
  playerIdentityMessageSchema,
  rawChannelCloseMessageSchema,
  rawChannelMetadataMessageSchema,
  simulationInputMessageSchema,
  simulationSnapshotMessageSchema,
  stateSnapshotMessageSchema,
  stateViewMessageSchema,
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
    expiresAtMs?: number;
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
      ...(input.expiresAtMs !== undefined ? { expiresAtMs: input.expiresAtMs } : {}),
    }),
  );
}

/** Build and validate an `action.ack` message (S2 action protocol). */
export function buildActionAckMessage(
  base: PeerMessageBase,
  input: {
    seq: number;
    actionId: string;
    status: "accepted" | "rejected" | "superseded";
    revision?: number;
    errorCode?: string;
    errorMessage?: string;
  },
): PeerMessage {
  return assertPeerMessage(
    actionAcknowledgementMessageSchema.parse({
      ...envelope(base),
      seq: input.seq,
      type: "action.ack",
      actionId: input.actionId,
      status: input.status,
      ...(input.revision !== undefined ? { revision: input.revision } : {}),
      ...(input.errorCode !== undefined ? { errorCode: input.errorCode } : {}),
      ...(input.errorMessage !== undefined ? { errorMessage: input.errorMessage } : {}),
    }),
  );
}

/** Build and validate a `state.snapshot` message (S2 state mode). */
export function buildStateSnapshotMessage(
  base: PeerMessageBase,
  input: {
    seq: number;
    revision: number;
    stateHash?: string;
    term: number;
    authorityMemberId: string;
    processedActionIds: readonly string[];
    state: unknown;
  },
): PeerMessage {
  return assertPeerMessage(
    stateSnapshotMessageSchema.parse({
      ...envelope(base),
      seq: input.seq,
      type: "state.snapshot",
      revision: input.revision,
      ...(input.stateHash !== undefined ? { stateHash: input.stateHash } : {}),
      term: input.term,
      authorityMemberId: input.authorityMemberId,
      processedActionIds: input.processedActionIds,
      state: input.state,
    }),
  );
}

/** Build and validate a `state.view` message (S2 per-player views). */
export function buildStateViewMessage(
  base: PeerMessageBase,
  input: {
    seq: number;
    revision: number;
    stateHash?: string;
    forMemberId: string;
    view: unknown;
  },
): PeerMessage {
  return assertPeerMessage(
    stateViewMessageSchema.parse({
      ...envelope(base),
      seq: input.seq,
      type: "state.view",
      revision: input.revision,
      ...(input.stateHash !== undefined ? { stateHash: input.stateHash } : {}),
      forMemberId: input.forMemberId,
      view: input.view,
    }),
  );
}

/** Build and validate an `authority.announce` message (S2/S3). */
export function buildAuthorityAnnounceMessage(
  base: PeerMessageBase,
  input: {
    seq: number;
    term: number;
    authorityMemberId: string;
    stateRevision: number;
    stateHash?: string;
    eligibleMemberIds: readonly string[];
  },
): PeerMessage {
  return assertPeerMessage(
    authorityAnnouncementMessageSchema.parse({
      ...envelope(base),
      seq: input.seq,
      type: "authority.announce",
      term: input.term,
      authorityMemberId: input.authorityMemberId,
      stateRevision: input.stateRevision,
      ...(input.stateHash !== undefined ? { stateHash: input.stateHash } : {}),
      eligibleMemberIds: input.eligibleMemberIds,
    }),
  );
}

/** Build and validate an `authority.heartbeat` message (S3). */
export function buildAuthorityHeartbeatMessage(
  base: PeerMessageBase,
  input: {
    seq: number;
    term: number;
    authorityMemberId: string;
    stateRevision: number;
    heartbeatSeq: number;
  },
): PeerMessage {
  return assertPeerMessage(
    authorityHeartbeatMessageSchema.parse({
      ...envelope(base),
      seq: input.seq,
      type: "authority.heartbeat",
      term: input.term,
      authorityMemberId: input.authorityMemberId,
      stateRevision: input.stateRevision,
      heartbeatSeq: input.heartbeatSeq,
    }),
  );
}

/** Build and validate an `authority.election` message (S3). */
export function buildAuthorityElectionMessage(
  base: PeerMessageBase,
  input: {
    seq: number;
    term: number;
    candidateMemberId: string;
    observed: readonly { memberId: string; revision: number; stateHash?: string }[];
  },
): PeerMessage {
  return assertPeerMessage(
    authorityElectionMessageSchema.parse({
      ...envelope(base),
      seq: input.seq,
      type: "authority.election",
      term: input.term,
      candidateMemberId: input.candidateMemberId,
      observed: input.observed.map((observation) => ({
        memberId: observation.memberId,
        revision: observation.revision,
        ...(observation.stateHash !== undefined ? { stateHash: observation.stateHash } : {}),
      })),
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

/** Build and validate a `raw.close` announcement (A2 channel lifecycle). */
export function buildRawChannelCloseMessage(
  base: PeerMessageBase,
  channelName: string,
): PeerMessage {
  return assertPeerMessage(
    rawChannelCloseMessageSchema.parse({
      ...envelope(base),
      type: "raw.close",
      channelName,
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

/** Build and validate a `simulation.snapshot` message (A1). */
export function buildSimulationSnapshotMessage(
  base: PeerMessageBase,
  input: {
    seq: number;
    tick: number;
    stateHash?: string;
    term: number;
    authorityMemberId: string;
    state: unknown;
  },
): PeerMessage {
  return assertPeerMessage(
    simulationSnapshotMessageSchema.parse({
      ...envelope(base),
      seq: input.seq,
      type: "simulation.snapshot",
      tick: input.tick,
      term: input.term,
      authorityMemberId: input.authorityMemberId,
      ...(input.stateHash !== undefined ? { stateHash: input.stateHash } : {}),
      state: input.state,
    }),
  );
}
