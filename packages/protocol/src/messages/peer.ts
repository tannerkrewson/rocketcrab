import { z } from "zod";
import { peerEnvelopeFields } from "../envelope";
import {
  channelNameSchema,
  displayNameSchema,
  gameIdSchema,
  memberIdSchema,
  monotonicSequenceSchema,
  partyCodeSchema,
  sessionSecretSchema,
  sha256Schema,
  timestampSchema,
  titleSchema,
} from "../ids";
import { messageBytesBeforeChunking } from "../limits";
import { gameEndReasonSchema, gameModeSchema } from "./shared";

/**
 * Peer-plane messages (party plane): messages between party members over the
 * transport (InMemoryTransport U5, TrysteroTransport P1). Every schema
 * extends the peer envelope, so each message carries the protocol version,
 * message type, session ID, sender member ID, sender connection ID, unique
 * message ID, and timestamp. Ordered families (actions, state, authority,
 * simulation) additionally require the per-sender monotonic `seq`.
 *
 * Pre-admission messages (party advert, join request, admission response)
 * travel through the rendezvous room and use the rendezvous session ID as
 * `sessionId` (ADR-0004); the private room session ID is used once admitted.
 */

/**
 * Party advert: the minimal party summary advertised through the rendezvous
 * room (ADR-0004). Never carries game source or session secrets.
 */
export const partyIdentityMessageSchema = z.object({
  ...peerEnvelopeFields,
  type: z.literal("party.identity"),
  partyCode: partyCodeSchema,
  partyName: z.string().min(1).max(64).optional(),
  gameTitle: titleSchema.optional(),
  memberCount: z.number().int().nonnegative(),
  greeterMemberId: memberIdSchema.optional(),
});
export type PartyIdentityMessage = z.infer<typeof partyIdentityMessageSchema>;

/**
 * Party session handoff: the greeter sends the private session secret to an
 * admitted joiner over the established encrypted peer connection (ADR-0004
 * step 9; ADR-0011). Never advertised, never sent before admission, never a
 * game-plane message. Both sides derive the private room name, Trystero
 * password, and private session ID from the secret with the same Web Crypto
 * derivation (P2). The party code travels along so invite-link joiners can
 * serve as greeter after migration.
 */
export const partySessionMessageSchema = z.object({
  ...peerEnvelopeFields,
  type: z.literal("party.session"),
  partyCode: partyCodeSchema,
  secret: sessionSecretSchema,
});
export type PartySessionMessage = z.infer<typeof partySessionMessageSchema>;

/**
 * Greeter announcement: broadcast in the private room whenever the
 * rendezvous greeter changes (greeter migration, ADR-0004). Greeter status
 * is separate from game authority (ADR-0007) — the announcement names the
 * greeter only, never a term or authority role.
 */
export const partyGreeterMessageSchema = z.object({
  ...peerEnvelopeFields,
  type: z.literal("party.greeter"),
  greeterMemberId: memberIdSchema,
});
export type PartyGreeterMessage = z.infer<typeof partyGreeterMessageSchema>;

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
 * member on the party control plane (7.25). The join handshake remains the
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
 * Classic external iframe game URL spec (7.7.4): the embeddable room URL
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
 * rocketcrab/name/ishost params (7.7.4). The optional `host` overrides are
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
 * party for the current classic room (7.7.4). The host re-announces the
 * `party.classicRoom` message in reply.
 */
export const partyClassicRoomRequestMessageSchema = z.object({
  ...peerEnvelopeFields,
  type: z.literal("party.classicRoom.request"),
});
export type PartyClassicRoomRequestMessage = z.infer<typeof partyClassicRoomRequestMessageSchema>;

/**
 * Party kick: the host removes a member from the party (7.29 classic
 * parity). Broadcast so the kicked member sees the reason and the other
 * members can update their view; the kicked member's client leaves.
 */
export const partyKickMessageSchema = z.object({
  ...peerEnvelopeFields,
  type: z.literal("party.kick"),
  targetMemberId: memberIdSchema,
  reason: z.string().max(256).optional(),
});
export type PartyKickMessage = z.infer<typeof partyKickMessageSchema>;

/**
 * Reload every player's game frame (7.29 classic parity). Sent by the host;
 * each member re-runs its own frame (runtime.reload or a classic iframe
 * remount).
 */
export const partyReloadAllMessageSchema = z.object({
  ...peerEnvelopeFields,
  type: z.literal("party.reloadAll"),
});
export type PartyReloadAllMessage = z.infer<typeof partyReloadAllMessageSchema>;

/** Join request: a joiner asks the greeter for admission (ADR-0004). */
export const joinRequestMessageSchema = z.object({
  ...peerEnvelopeFields,
  type: z.literal("join.request"),
  partyCode: partyCodeSchema,
  displayName: displayNameSchema,
});
export type JoinRequestMessage = z.infer<typeof joinRequestMessageSchema>;

/** Admission response: the greeter's decision on a join request (ADR-0004). */
export const admissionResponseMessageSchema = z.object({
  ...peerEnvelopeFields,
  type: z.literal("join.admission"),
  partyCode: partyCodeSchema,
  decision: z.enum(["approved", "rejected"]),
  reason: z.enum(["party_full", "greeter_rejected", "timed_out", "invalid_request"]).optional(),
});
export type AdmissionResponseMessage = z.infer<typeof admissionResponseMessageSchema>;

/**
 * Connection status: a member's self-reported connectivity. Advisory only —
 * transport-level join/leave events remain authoritative for local UI (F5:
 * relay state and leave events come from the transport).
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
  payload: z.unknown(),
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
  processedActionIds: z.array(z.string().min(1).max(64)),
  state: z.unknown(),
});
export type StateSnapshotMessage = z.infer<typeof stateSnapshotMessageSchema>;

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
 * Simulation input: an ordered player input on the shared simulation clock
 * (ADR-0006 simulation mode).
 */
export const simulationInputMessageSchema = z.object({
  ...peerEnvelopeFields,
  seq: monotonicSequenceSchema,
  type: z.literal("simulation.input"),
  inputId: z.string().min(1).max(64),
  inputType: z.string().min(1).max(64),
  payload: z.unknown(),
  targetTick: z.number().int().nonnegative().optional(),
  expiresAtMs: timestampSchema.optional(),
});
export type SimulationInputMessage = z.infer<typeof simulationInputMessageSchema>;

/**
 * Simulation snapshot: a periodic authoritative snapshot for restore after
 * migration (ADR-0006 simulation mode).
 */
export const simulationSnapshotMessageSchema = z.object({
  ...peerEnvelopeFields,
  seq: monotonicSequenceSchema,
  type: z.literal("simulation.snapshot"),
  tick: z.number().int().nonnegative(),
  term: z.number().int().min(1),
  authorityMemberId: memberIdSchema,
  stateHash: sha256Schema.optional(),
  state: z.unknown(),
});
export type SimulationSnapshotMessage = z.infer<typeof simulationSnapshotMessageSchema>;

/**
 * Player ready announcement (S1 ready lifecycle): the sender's game
 * finished loading and is ready to play. The sender's identity comes from
 * the peer envelope; the message carries no payload fields.
 */
export const gameReadyMessageSchema = z.object({
  ...peerEnvelopeFields,
  type: z.literal("game.ready"),
});
export type GameReadyMessage = z.infer<typeof gameReadyMessageSchema>;

/**
 * Game start (S1): announced to every player when the game begins. The
 * start policy (who decides when to start) is host/arena policy, not game
 * code — games only observe the start event. Idempotent: a session that is
 * already started ignores further announcements.
 */
export const gameStartMessageSchema = z.object({
  ...peerEnvelopeFields,
  type: z.literal("game.start"),
});
export type GameStartMessage = z.infer<typeof gameStartMessageSchema>;

/** Game end (S1): announced to every player when the game ends. */
export const gameEndMessageSchema = z.object({
  ...peerEnvelopeFields,
  type: z.literal("game.end"),
  reason: gameEndReasonSchema,
});
export type GameEndMessage = z.infer<typeof gameEndMessageSchema>;

/**
 * Raw channel metadata: declares a named raw-mode channel and its delivery
 * guarantees (ADR-0006 raw mode: named channels, reliable/unreliable,
 * ordered/unordered, binary, broadcast/targeted). Peers joining mid-game
 * receive the declarations of every open channel (targeted re-announcement
 * on join), so channel lifecycle survives peer joins.
 */
export const rawChannelMetadataMessageSchema = z.object({
  ...peerEnvelopeFields,
  type: z.literal("raw.channel"),
  channelName: channelNameSchema,
  reliability: z.enum(["reliable", "unreliable"]),
  ordering: z.enum(["ordered", "unordered"]),
  binaryPayloads: z.boolean(),
  broadcast: z.boolean(),
});
export type RawChannelMetadataMessage = z.infer<typeof rawChannelMetadataMessageSchema>;

/**
 * Raw channel close: the declaring player closed one of its raw channels
 * (A2 channel lifecycle). Receivers drop the channel declaration: local
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
 * source transfer (P3). Receivers can decide to accept before any bytes move.
 * The optional `title`, `apiVersion`, and `mode` fields (P3 additions, F6
 * additive) let the receiver run its runtime compatibility check and show
 * lobby UI before any bytes move.
 */
export const gameSourceMetadataMessageSchema = z.object({
  ...peerEnvelopeFields,
  type: z.literal("game.source.metadata"),
  gameId: gameIdSchema,
  title: titleSchema.optional(),
  /** Nova API version the game was built against (S1 `nova.defineGame`). */
  apiVersion: z.number().int().min(1).optional(),
  /** Execution mode the host will launch (state / simulation / raw). */
  mode: gameModeSchema.optional(),
  sourceSha256: sha256Schema,
  sourceSizeBytes: z.number().int().nonnegative(),
  chunkCount: z.number().int().min(1),
});
export type GameSourceMetadataMessage = z.infer<typeof gameSourceMetadataMessageSchema>;

/**
 * Game source transfer: one chunk of the exact HTML source string, verified
 * by SHA-256 so all players run byte-identical documents (ADR-0002, P3).
 * Each chunk is bounded by `messageBytesBeforeChunking`; receivers enforce
 * `chunkIndex < chunkCount` and total-size limits.
 */
export const gameSourceTransferMessageSchema = z.object({
  ...peerEnvelopeFields,
  type: z.literal("game.source.chunk"),
  gameId: gameIdSchema,
  sourceSha256: sha256Schema,
  chunkIndex: z.number().int().nonnegative(),
  chunkCount: z.number().int().min(1),
  chunk: z.string().max(messageBytesBeforeChunking),
});
export type GameSourceTransferMessage = z.infer<typeof gameSourceTransferMessageSchema>;

/** Transfer acknowledgement: receiver result for a source transfer (P3). */
export const transferAcknowledgementMessageSchema = z.object({
  ...peerEnvelopeFields,
  type: z.literal("game.source.ack"),
  gameId: gameIdSchema,
  sourceSha256: sha256Schema,
  status: z.enum(["received", "failed"]),
  errorMessage: z.string().max(256).optional(),
});
export type TransferAcknowledgementMessage = z.infer<typeof transferAcknowledgementMessageSchema>;

/**
 * Game source request: a joiner asks a source holder for the game document
 * (P3). Requests travel on the private-party transport only, so only admitted
 * members can ask (ADR-0004, ADR-0010). A request without `gameId` asks every
 * holder to announce the current game (refresh after a missed announcement);
 * a request with `gameId` (and its SHA-256) asks one holder to start the
 * transfer. `sourceSha256` is only meaningful with `gameId`, so the schema
 * rejects that combination.
 */
export const gameSourceRequestMessageSchema = z
  .object({
    ...peerEnvelopeFields,
    type: z.literal("game.source.request"),
    gameId: gameIdSchema.optional(),
    sourceSha256: sha256Schema.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.sourceSha256 !== undefined && value.gameId === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sourceSha256"],
        message: "sourceSha256 requires a gameId.",
      });
    }
  });
export type GameSourceRequestMessage = z.infer<typeof gameSourceRequestMessageSchema>;

/**
 * Game source cancellation: either side aborts an in-flight source transfer
 * (P3). The sender stops sending remaining chunks; the receiver discards the
 * partial source and clears its transfer state (engineering rule 22 — no
 * orphaned listeners or partial state after an abort).
 */
export const gameSourceCancelMessageSchema = z.object({
  ...peerEnvelopeFields,
  type: z.literal("game.source.cancel"),
  gameId: gameIdSchema,
  sourceSha256: sha256Schema,
  reason: z.string().max(256).optional(),
});
export type GameSourceCancelMessage = z.infer<typeof gameSourceCancelMessageSchema>;

/** Every peer-plane message schema, discriminated by `type`. */
export const peerMessagesSchema = z.discriminatedUnion("type", [
  partyIdentityMessageSchema,
  partySessionMessageSchema,
  partyGreeterMessageSchema,
  playerIdentityMessageSchema,
  partyRenameMessageSchema,
  partyClassicRoomMessageSchema,
  partyClassicRoomRequestMessageSchema,
  partyKickMessageSchema,
  partyReloadAllMessageSchema,
  joinRequestMessageSchema,
  admissionResponseMessageSchema,
  connectionStatusMessageSchema,
  peerCapabilitiesMessageSchema,
  actionDispatchMessageSchema,
  actionAcknowledgementMessageSchema,
  stateSnapshotMessageSchema,
  stateViewMessageSchema,
  authorityAnnouncementMessageSchema,
  authorityHeartbeatMessageSchema,
  authorityElectionMessageSchema,
  simulationInputMessageSchema,
  simulationSnapshotMessageSchema,
  gameReadyMessageSchema,
  gameStartMessageSchema,
  gameEndMessageSchema,
  rawChannelMetadataMessageSchema,
  rawChannelCloseMessageSchema,
  gameSourceMetadataMessageSchema,
  gameSourceTransferMessageSchema,
  transferAcknowledgementMessageSchema,
  gameSourceRequestMessageSchema,
  gameSourceCancelMessageSchema,
]);

/** All peer-plane message type strings, for useful unknown-type errors. */
export const PEER_MESSAGE_TYPES: readonly string[] = peerMessagesSchema.options.map(
  (option) => option.shape.type.value,
);

/** Any valid peer-plane message. */
export type PeerMessage = z.infer<typeof peerMessagesSchema>;
