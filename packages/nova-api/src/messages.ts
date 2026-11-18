/**
 * Outgoing peer-plane message construction for the Nova session.
 *
 * Every message the session sends is built from its Zod schema and validated
 * with `assertPeerMessage` before it touches the transport (threat model
 * T10; never emit an unvalidated message or accept `any` at the boundary).
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
  gameControlsMessageSchema,
  gameReadyMessageSchema,
  gameStartMessageSchema,
  playerIdentityMessageSchema,
  rawChannelCloseMessageSchema,
  rawChannelMetadataMessageSchema,
  stateResyncMessageSchema,
  stateSnapshotMessageSchema,
  stateViewMessageSchema,
  type GameEndReason,
  type PeerMessage,
  type StateSnapshotMessage,
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

/** Build and validate a player's `game.controls` update. */
export function buildGameControlsMessage(base: PeerMessageBase, controls: unknown): PeerMessage {
  return assertPeerMessage(
    gameControlsMessageSchema.parse({ ...envelope(base), type: "game.controls", controls }),
  );
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
  authorityEligible = true,
): PeerMessage {
  return assertPeerMessage(
    playerIdentityMessageSchema.parse({
      ...envelope(base),
      type: "player.identity",
      displayName,
      // False only while this player's page is hidden (see NovaSession.setAway).
      authorityEligible,
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

/** Build and validate an `action.ack` message (action protocol). */
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

/** Build and validate a `state.snapshot` message (state mode). */
export function buildStateSnapshotMessage(
  base: PeerMessageBase,
  input: {
    seq: number;
    revision: number;
    stateHash?: string;
    term: number;
    authorityMemberId: string;
    historyMode: "full" | "increment";
    baseStateHash?: string;
    historyComplete: boolean;
    stateMode: "full" | "delta";
    ops?: readonly unknown[];
    processedActionIds: readonly string[];
    actionRejections?: Readonly<NonNullable<StateSnapshotMessage["actionRejections"]>>;
    state?: unknown;
    viewIsState?: true;
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
      historyMode: input.historyMode,
      ...(input.baseStateHash !== undefined ? { baseStateHash: input.baseStateHash } : {}),
      historyComplete: input.historyComplete,
      stateMode: input.stateMode,
      ...(input.ops !== undefined ? { ops: input.ops } : {}),
      processedActionIds: input.processedActionIds,
      ...(input.actionRejections ? { actionRejections: input.actionRejections } : {}),
      state: input.state,
      ...(input.viewIsState === true ? { viewIsState: true } : {}),
    }),
  );
}

/** Build and validate a `state.resync` request (gap in the snapshot stream). */
export function buildStateResyncMessage(
  base: PeerMessageBase,
  input: { seq: number; knownRevision: number },
): PeerMessage {
  return assertPeerMessage(
    stateResyncMessageSchema.parse({
      ...envelope(base),
      seq: input.seq,
      type: "state.resync",
      knownRevision: input.knownRevision,
    }),
  );
}

/** Build and validate a `state.view` message (per-player views). */
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

/** Build and validate an `authority.announce` message. */
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

/** Build and validate an `authority.heartbeat` message. */
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

/** Build and validate an `authority.election` message. */
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

/** Build and validate a `raw.close` announcement. */
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
