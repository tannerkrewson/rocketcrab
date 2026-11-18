import { z } from "zod";
import { peerEnvelopeFields } from "../envelope";
import {
  channelNameSchema,
  displayNameSchema,
  gameIdSchema,
  memberIdSchema,
  monotonicSequenceSchema,
  sha256Schema,
  timestampSchema,
  titleSchema,
} from "../ids";
import { stateDeltaMaxDepth, stateDeltaMaxOps, stateHistoryLimit } from "../limits";
import { gameEndReasonSchema, gameModeSchema } from "./shared";

/**
 * Peer-plane messages (party plane): messages between party members over the
 * transport (InMemoryTransport, TrysteroTransport). Every schema
 * extends the peer envelope, so each message carries the protocol version,
 * message type, session ID, sender member ID, sender connection ID, unique
 * message ID, and timestamp. Ordered families (actions, state, authority,
 * controls) additionally require the per-sender monotonic `seq`.
 *
 * All peer messages travel only inside the private password-protected party room.
 */

/** Shell-control context, shared only inside the private party room.
 * The original creator is preferred while connected; otherwise the lowest
 * connected member ID owns shell controls. No secret or admission data.
 */
export const partyContextMessageSchema = z.object({
  ...peerEnvelopeFields,
  type: z.literal("party.context"),
  creatorMemberId: memberIdSchema,
});
export type PartyContextMessage = z.infer<typeof partyContextMessageSchema>;

/**
 * Player identity: a member announces or updates their profile to the party
 * (ADR-0007 member identity: stable member ID, connection ID, display name,
 * authority eligibility).
 */
export const playerIdentityMessageSchema = z.object({
  ...peerEnvelopeFields,
  type: z.literal("player.identity"),
  displayName: displayNameSchema,
  avatarUrl: z.url().optional(),
  authorityEligible: z.boolean(),
});
export type PlayerIdentityMessage = z.infer<typeof playerIdentityMessageSchema>;

/**
 * Party rename: a member announces a display-name change to every connected
 * member on the party control plane. The join handshake remains the
 * source of truth for new/reconnecting peers; this message only lets
 * already-connected members update their view of the renamed member
 * promptly, without waiting for a rejoin.
 */
export const partyRenameMessageSchema = z.object({
  ...peerEnvelopeFields,
  type: z.literal("party.rename"),
  displayName: displayNameSchema,
});
export type PartyRenameMessage = z.infer<typeof partyRenameMessageSchema>;

/**
 * Classic external iframe game URL spec: the embeddable room URL
 * plus optional per-game query/hash extras (classic `ConnectedGameURL`).
 */
export const classicUrlSpecMessageSchema = z.object({
  url: z.string().min(1).max(2048),
  customQueryParams: z.record(z.string(), z.string()).optional(),
  afterQueryParams: z.string().max(512).optional(),
});
export type ClassicUrlSpecMessage = z.infer<typeof classicUrlSpecMessageSchema>;

/**
 * Classic room: the host created a room on an external service and shares
 * the URL spec so every player embeds the SAME room with their own
 * rocketcrab/name/ishost params. The optional `host` overrides are
 * merged only for the host's own frame.
 */
export const partyClassicRoomMessageSchema = z.object({
  ...peerEnvelopeFields,
  type: z.literal("party.classicRoom"),
  gameId: gameIdSchema,
  player: classicUrlSpecMessageSchema,
  host: classicUrlSpecMessageSchema.partial().optional(),
});
export type PartyClassicRoomMessage = z.infer<typeof partyClassicRoomMessageSchema>;

/**
 * Classic room request: a late joiner (or a reconnecting member) asks the
 * party for the current classic room. The host re-announces the
 * `party.classicRoom` message in reply.
 */
export const partyClassicRoomRequestMessageSchema = z.object({
  ...peerEnvelopeFields,
  type: z.literal("party.classicRoom.request"),
});
export type PartyClassicRoomRequestMessage = z.infer<typeof partyClassicRoomRequestMessageSchema>;

/**
 * Party kick: the host removes a member from the party. Broadcast so the
 * kicked member sees the reason and others can update their view; the
 * kicked member's client leaves.
 */
export const partyKickMessageSchema = z.object({
  ...peerEnvelopeFields,
  type: z.literal("party.kick"),
  targetMemberId: memberIdSchema,
  reason: z.string().max(256).optional(),
});
export type PartyKickMessage = z.infer<typeof partyKickMessageSchema>;

/**
 * Reload every player's game frame. Sent by the host;
 * each member re-runs its own frame (runtime.reload or a classic iframe
 * remount).
 */
export const partyReloadAllMessageSchema = z.object({
  ...peerEnvelopeFields,
  type: z.literal("party.reloadAll"),
});
export type PartyReloadAllMessage = z.infer<typeof partyReloadAllMessageSchema>;

/**
 * Connection status: a member's self-reported connectivity. Advisory only —
 * transport-level join/leave events remain authoritative for local UI (relay
 * state and leave events come from the transport).
 */
export const connectionStatusMessageSchema = z.object({
  ...peerEnvelopeFields,
  type: z.literal("peer.connectionStatus"),
  status: z.enum(["online", "offline", "reconnecting", "suspended"]),
  detail: z.string().max(256).optional(),
});
export type ConnectionStatusMessage = z.infer<typeof connectionStatusMessageSchema>;

/** Peer capability declaration (ADR-0003 transport abstraction). */
export const peerCapabilitiesMessageSchema = z.object({
  ...peerEnvelopeFields,
  type: z.literal("peer.capabilities"),
  protocolVersions: z.array(z.number().int().min(1)).min(1),
  gameModes: z.array(gameModeSchema).min(1),
  chunkedMessages: z.boolean(),
  binaryPayloads: z.boolean(),
  maxMessageBytes: z.number().int().positive().optional(),
});
export type PeerCapabilitiesMessage = z.infer<typeof peerCapabilitiesMessageSchema>;

/**
 * Action dispatch (ADR-0006 state mode): an ordered action with a base
 * revision, deduplication ID, and timeout. Payload size is bounded by
 * `actionPayloadBytes` at the serialization boundary.
 */
export const actionDispatchMessageSchema = z.object({
  ...peerEnvelopeFields,
  seq: monotonicSequenceSchema,
  type: z.literal("action.dispatch"),
  actionId: z.string().min(1).max(64),
  baseRevision: z.number().int().nonnegative(),
  actionType: z.string().min(1).max(64),
  // An omitted game action payload is valid; JSON drops undefined properties.
  payload: z.unknown().optional(),
  expiresAtMs: timestampSchema.optional(),
});
export type ActionDispatchMessage = z.infer<typeof actionDispatchMessageSchema>;

/** Action acknowledgement: result of an applied or rejected action. */
export const actionAcknowledgementMessageSchema = z.object({
  ...peerEnvelopeFields,
  seq: monotonicSequenceSchema,
  type: z.literal("action.ack"),
  actionId: z.string().min(1).max(64),
  status: z.enum(["accepted", "rejected", "superseded"]),
  /** New state revision when the action was accepted. */
  revision: z.number().int().nonnegative().optional(),
  errorCode: z.string().min(1).max(64).optional(),
  errorMessage: z.string().max(256).optional(),
});
export type ActionAcknowledgementMessage = z.infer<typeof actionAcknowledgementMessageSchema>;

/** Keys a state delta may never address: they would reach prototype chains. */
const forbiddenDeltaKeys = new Set(["__proto__", "constructor", "prototype"]);

const deltaPathSegment = z
  .string()
  .min(1)
  .max(64)
  .refine((key) => !forbiddenDeltaKeys.has(key), "forbidden state key");

/**
 * One state delta operation: `set` replaces the value at `path` (an empty path
 * replaces the whole state), `del` removes the key at `path`. Arrays are always
 * replaced whole, so paths only name object keys.
 */
export const stateDeltaOpSchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("set"),
    path: z.array(deltaPathSegment).max(stateDeltaMaxDepth),
    value: z.unknown(),
  }),
  z.object({
    op: z.literal("del"),
    path: z.array(deltaPathSegment).min(1).max(stateDeltaMaxDepth),
  }),
]);
export type StateDeltaOp = z.infer<typeof stateDeltaOpSchema>;

/**
 * True when `ops` is a valid state delta: every operation passes the schema
 * and the list is within `stateDeltaMaxOps`. A sender uses this before it
 * chooses a delta, so a delta it sends is always one receivers accept.
 */
export function stateDeltaOpsFit(ops: unknown): boolean {
  return z.array(stateDeltaOpSchema).max(stateDeltaMaxOps).safeParse(ops).success;
}

/**
 * State snapshot: canonical replicated state with the conflict-reconciliation
 * envelope fields (ADR-0007: revision, term, authority member ID, state hash,
 * recent processed action IDs). Inspectable by party peers by design
 * (ADR-0010). Size is bounded by `stateSnapshotBytes` at the serialization
 * boundary.
 */
export const stateSnapshotMessageSchema = z.object({
  ...peerEnvelopeFields,
  seq: monotonicSequenceSchema,
  type: z.literal("state.snapshot"),
  revision: z.number().int().nonnegative(),
  stateHash: sha256Schema.optional(),
  term: z.number().int().nonnegative(),
  authorityMemberId: memberIdSchema,
  /**
   * `full`: `processedActionIds` is the authority's whole dedup window (late
   * join, restore, resync, migration). `increment`: it lists only the IDs
   * added since the authority's previous broadcast, which is revision - 1;
   * a receiver at any other revision has a gap and must request a resync.
   */
  historyMode: z.enum(["full", "increment"]).default("full"),
  /**
   * For `increment`: the state hash the increment applies on top of (the
   * authority's previous broadcast). A receiver whose state hash differs is on
   * another lineage, which is a gap. Absent on full snapshots.
   */
  baseStateHash: sha256Schema.optional(),
  /**
   * False when the sender's window has a known gap. A complete shell merges
   * such a full snapshot instead of replacing its own window. Absent from
   * older senders, which always sent complete windows, so it defaults to true.
   */
  historyComplete: z.boolean().default(true),
  /**
   * `full`: `state` is the whole canonical state. `delta`: `ops` transform the
   * receiver's state at `baseStateHash` into this revision's state, and `state`
   * is absent. Absent from older senders, which always sent full states.
   */
  stateMode: z.enum(["full", "delta"]).default("full"),
  ops: z.array(stateDeltaOpSchema).max(stateDeltaMaxOps).optional(),
  processedActionIds: z.array(z.string().min(1).max(64)).max(stateHistoryLimit),
  actionRejections: z
    .array(
      z.object({
        actionId: z.string().min(1).max(64),
        status: z.enum(["rejected", "superseded"]),
        errorCode: z.string().min(1).max(64).optional(),
      }),
    )
    .max(stateHistoryLimit)
    .optional(),
  /** Present on full snapshots; absent on deltas. A full snapshot without it is invalid (checked by the engine). */
  state: z.unknown().optional(),
  /** The game has no selectView: every frame's view is this state, so no per-player views follow. */
  viewIsState: z.literal(true).optional(),
});
export type StateSnapshotMessage = z.infer<typeof stateSnapshotMessageSchema>;
export type StateActionRejection = NonNullable<StateSnapshotMessage["actionRejections"]>[number];

/**
 * State resync request: a member that detected a gap in the authority's
 * snapshot stream asks the current authority, targeted, for a full snapshot
 * (state plus full processed-action history). The authority rate-limits
 * repeats per requester.
 */
export const stateResyncMessageSchema = z.object({
  ...peerEnvelopeFields,
  seq: monotonicSequenceSchema,
  type: z.literal("state.resync"),
  knownRevision: z.number().int().nonnegative(),
});
export type StateResyncMessage = z.infer<typeof stateResyncMessageSchema>;

/**
 * State view: the per-player view delivered to a specific member; non-
 * authority frames receive only their selected view (ADR-0006).
 */
export const stateViewMessageSchema = z.object({
  ...peerEnvelopeFields,
  seq: monotonicSequenceSchema,
  type: z.literal("state.view"),
  revision: z.number().int().nonnegative(),
  stateHash: sha256Schema.optional(),
  forMemberId: memberIdSchema,
  view: z.unknown(),
});
export type StateViewMessage = z.infer<typeof stateViewMessageSchema>;

/**
 * Authority announcement: a term claim including term and state revision
 * (ADR-0007). Conflicting announcements reconcile deterministically.
 */
export const authorityAnnouncementMessageSchema = z.object({
  ...peerEnvelopeFields,
  seq: monotonicSequenceSchema,
  type: z.literal("authority.announce"),
  term: z.number().int().min(1),
  authorityMemberId: memberIdSchema,
  stateRevision: z.number().int().nonnegative(),
  stateHash: sha256Schema.optional(),
  eligibleMemberIds: z.array(memberIdSchema),
});
export type AuthorityAnnouncementMessage = z.infer<typeof authorityAnnouncementMessageSchema>;

/** Authority heartbeat: liveness for the current term (ADR-0007). */
export const authorityHeartbeatMessageSchema = z.object({
  ...peerEnvelopeFields,
  seq: monotonicSequenceSchema,
  type: z.literal("authority.heartbeat"),
  term: z.number().int().min(1),
  authorityMemberId: memberIdSchema,
  stateRevision: z.number().int().nonnegative(),
  heartbeatSeq: z.number().int().nonnegative(),
});
export type AuthorityHeartbeatMessage = z.infer<typeof authorityHeartbeatMessageSchema>;

/**
 * Authority election: a candidate term with observed membership and state
 * observations so peers elect deterministically (ADR-0007). Terms are
 * monotonic.
 */
export const authorityElectionMessageSchema = z.object({
  ...peerEnvelopeFields,
  seq: monotonicSequenceSchema,
  type: z.literal("authority.election"),
  term: z.number().int().min(1),
  candidateMemberId: memberIdSchema,
  observed: z.array(
    z.object({
      memberId: memberIdSchema,
      revision: z.number().int().nonnegative(),
      stateHash: sha256Schema.optional(),
    }),
  ),
});
export type AuthorityElectionMessage = z.infer<typeof authorityElectionMessageSchema>;

/**
 * Player ready announcement: the sender's game
 * finished loading and is ready to play. The sender's identity comes from
 * the peer envelope; the message carries no payload fields.
 */
export const gameReadyMessageSchema = z.object({
  ...peerEnvelopeFields,
  type: z.literal("game.ready"),
});
export type GameReadyMessage = z.infer<typeof gameReadyMessageSchema>;

/**
 * A player's latest controls for a ticking game, sent to the authority only
 * when they change. Latest value wins; the authority reads them each tick.
 */
export const gameControlsMessageSchema = z.object({
  ...peerEnvelopeFields,
  type: z.literal("game.controls"),
  controls: z.unknown(),
});
export type GameControlsMessage = z.infer<typeof gameControlsMessageSchema>;

/**
 * Game start: announced to every player when the game begins. The
 * start policy (who decides when to start) is host/arena policy, not game
 * code — games only observe the start event. Idempotent: a session that is
 * already started ignores further announcements.
 */
export const gameStartMessageSchema = z.object({
  ...peerEnvelopeFields,
  type: z.literal("game.start"),
});
export type GameStartMessage = z.infer<typeof gameStartMessageSchema>;

/** Game end: announced to every player when the game ends. */
export const gameEndMessageSchema = z.object({
  ...peerEnvelopeFields,
  type: z.literal("game.end"),
  reason: gameEndReasonSchema,
});
export type GameEndMessage = z.infer<typeof gameEndMessageSchema>;

/**
 * Raw channel metadata: declares a named raw-mode channel. Every raw channel
 * is reliable and ordered (the party transport offers nothing else). Peers joining mid-game
 * receive the declarations of every open channel (targeted re-announcement
 * on join), so channel lifecycle survives peer joins.
 */
export const rawChannelMetadataMessageSchema = z.object({
  ...peerEnvelopeFields,
  type: z.literal("raw.channel"),
  channelName: channelNameSchema,
});
export type RawChannelMetadataMessage = z.infer<typeof rawChannelMetadataMessageSchema>;

/**
 * Raw channel close: the declaring player closed one of its raw channels.
 * Receivers drop the channel declaration: local
 * sends on it fail with `unknown_channel` unless the receiver declared the
 * channel itself (each player owns its own declarations). The channel name
 * may be re-opened later with a fresh `raw.channel` declaration.
 */
export const rawChannelCloseMessageSchema = z.object({
  ...peerEnvelopeFields,
  type: z.literal("raw.close"),
  channelName: channelNameSchema,
});
export type RawChannelCloseMessage = z.infer<typeof rawChannelCloseMessageSchema>;

/**
 * Game source metadata: the pre-transfer descriptor for a peer-to-peer game
 * source transfer. Receivers can decide to accept before any bytes move.
 * The optional `title`, `apiVersion`, and `mode` fields let the receiver
 * check runtime compatibility and show lobby UI before any bytes move.
 */
export const gameSourceMetadataMessageSchema = z.object({
  ...peerEnvelopeFields,
  type: z.literal("game.source.metadata"),
  gameId: gameIdSchema,
  title: titleSchema.optional(),
  /** Nova API version the game was built against (`nova.defineGame`). */
  apiVersion: z.number().int().min(1).optional(),
  /** Execution mode the host will launch (state / raw). */
  mode: gameModeSchema.optional(),
  sourceSha256: sha256Schema,
  sourceSizeBytes: z.number().int().nonnegative(),
});
export type GameSourceMetadataMessage = z.infer<typeof gameSourceMetadataMessageSchema>;

/** Application acceptance after exact-size and SHA-256 validation, not a
 * transport ACK. No retry follows a rejection. */
export const gameSourceAcceptedMessageSchema = z.object({
  ...peerEnvelopeFields,
  type: z.literal("game.source.accepted"),
  gameId: gameIdSchema,
  sourceSha256: sha256Schema,
});
export type GameSourceAcceptedMessage = z.infer<typeof gameSourceAcceptedMessageSchema>;

/** Ask connected holders to reannounce the current descriptor. */
export const gameSourceDiscoverMessageSchema = z.object({
  ...peerEnvelopeFields,
  type: z.literal("game.source.discover"),
});
export type GameSourceDiscoverMessage = z.infer<typeof gameSourceDiscoverMessageSchema>;

/** Every peer-plane message schema, discriminated by `type`. */
export const peerMessagesSchema = z.discriminatedUnion("type", [
  partyContextMessageSchema,
  playerIdentityMessageSchema,
  partyRenameMessageSchema,
  partyClassicRoomMessageSchema,
  partyClassicRoomRequestMessageSchema,
  partyKickMessageSchema,
  partyReloadAllMessageSchema,
  connectionStatusMessageSchema,
  peerCapabilitiesMessageSchema,
  actionDispatchMessageSchema,
  actionAcknowledgementMessageSchema,
  stateSnapshotMessageSchema,
  stateResyncMessageSchema,
  stateViewMessageSchema,
  authorityAnnouncementMessageSchema,
  authorityHeartbeatMessageSchema,
  authorityElectionMessageSchema,
  gameReadyMessageSchema,
  gameControlsMessageSchema,
  gameStartMessageSchema,
  gameEndMessageSchema,
  rawChannelMetadataMessageSchema,
  rawChannelCloseMessageSchema,
  gameSourceMetadataMessageSchema,
  gameSourceAcceptedMessageSchema,
  gameSourceDiscoverMessageSchema,
]);

/** All peer-plane message type strings, for useful unknown-type errors. */
export const PEER_MESSAGE_TYPES: readonly string[] = peerMessagesSchema.options.map(
  (option) => option.shape.type.value,
);

/** Any valid peer-plane message. */
export type PeerMessage = z.infer<typeof peerMessagesSchema>;
