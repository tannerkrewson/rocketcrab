/**
 * Peer-to-peer game source distribution (P3; ADR-0002, ADR-0004, ADR-0005).
 *
 * Transfers the EXACT saved HTML source from the initiating player to
 * admitted party members, byte-identical, over the established private-party
 * transport (the same transport P2 admission produced — never the rendezvous
 * room). The source lives only in browser-local IndexedDB on the main origin
 * (ADR-0005, engineering rule 4) and is never uploaded to Nova
 * infrastructure: this coordinator only ever moves the HTML string between
 * peers over the transport.
 *
 * Flow (one game per party session):
 * 1. The host registers the game with {@link GameSourceCoordinator.setSource},
 *    which hashes the source with Web Crypto (SHA-256), enforces the F6
 *    source-size limits (`htmlSourceBytes` hard limit — a game too large is
 *    refused with a clear `too_large` error; `htmlSourceWarnBytes` soft limit
 *    emits a warning), and announces `game.source.metadata`.
 * 2. The host re-announces to every newly admitted member (`peer:joined`),
 *    so an admitted joiner learns the game before gameplay starts (P4 wires
 *    launch after the joiner's `received` event).
 * 3. The joiner runs its runtime compatibility check (Nova API version from
 *    the announcement vs. this build's supported versions) and, when
 *    compatible, sends a targeted `game.source.request`.
 * 4. The host streams `game.source.chunk` messages — each carried as a BINARY
 *    transport payload so the transfer uses the transport's binary +
 *    transfer-progress support (U5/P1) — and the coordinator reports
 *    progress on both sides.
 * 5. The joiner reassembles the chunks, verifies the SHA-256 digest and the
 *    source-byte count against the announcement, caches the verified source
 *    in its in-memory session cache, and acknowledges with
 *    `game.source.ack { status: "received" }`.
 * 6. On a failed or mismatched transfer the host retries (bounded by
 *    `maxRetries`); after exhausting retries it sends a terminal failed ack
 *    and emits a `retries_exhausted` error. Either side can cancel an
 *    in-flight transfer with `game.source.cancel`.
 * 7. On reconnect, the joiner's partial receive state is discarded; the host
 *    re-announces to the fresh connection and the transfer restarts only if
 *    the joiner still lacks the verified source (re-transfer after reconnect
 *    *if required* — members who already verified keep their cached copy).
 *
 * Every transfer message is schema-validated at both boundaries (threat
 * model T10; engineering rules 15/21): structured messages go through the
 * transport's validator when one is configured, and the coordinator itself
 * re-validates every inbound message with `parsePeerMessage` — including
 * binary chunk payloads, which it decodes and validates before acting.
 * All transport listeners are detached by {@link GameSourceCoordinator.dispose}
 * (engineering rule 22); in-flight transfers are also aborted on peer leave,
 * connection loss, and cancellation so no partial state or listener outlives
 * the transfer.
 *
 * Blocker Register B4 (remote dependency reliability): the coordinator
 * transfers the HTML source only. Remote dependencies and assets referenced
 * by the HTML are loaded by each player's browser directly; Nova never
 * proxies the web (ADR-0009).
 *
 * The coordinator is transport-neutral: it drives the {@link NovaTransport}
 * interface, so the same flows run over InMemoryTransport in deterministic
 * tests and TrysteroTransport for real parties. Party wiring (P4): create it
 * with `party.privateTransport` (the established private room) and, on the
 * initiating player, call `setSource(...)` with the saved game from the
 * repository (apps/nova `DexieGameRepository`).
 */
import type { ConnectionId, GameId, GameMode, MemberId, Sha256 } from "@rocketcrab/protocol";
import {
  PROTOCOL_VERSION,
  gameSourceCancelMessageSchema,
  gameSourceMetadataMessageSchema,
  gameSourceRequestMessageSchema,
  gameSourceTransferMessageSchema,
  htmlSourceBytes,
  htmlSourceWarnBytes,
  messageBytesBeforeChunking,
  parsePeerMessage,
  transferAcknowledgementMessageSchema,
  type GameSourceCancelMessage,
  type GameSourceMetadataMessage,
  type GameSourceRequestMessage,
  type GameSourceTransferMessage,
  type PeerMessage,
  type TransferAcknowledgementMessage,
} from "@rocketcrab/protocol";
import { NOVA_API_VERSION } from "@rocketcrab/nova-api/version";
import type {
  NovaTransport,
  TransportConnectionState,
  TransportMessage,
  TransportPeerInfo,
} from "@rocketcrab/core";
import { newMessageId, nowSentAt } from "./messages";

/**
 * Transport channel carrying game-source traffic (P3). Distinct from
 * `nova.party` (party control) and `nova.protocol` (game plane), so game
 * source never reaches game code and party secrets never travel here.
 */
export const GAME_SOURCE_CHANNEL = "nova.source";

/** Default retries AFTER the initial attempt before a transfer is given up. */
export const DEFAULT_MAX_RETRIES = 2;

/** A game source to distribute (host side) or a received, verified source. */
export interface GameSourceInfo {
  readonly gameId: GameId;
  /** Optional display title announced with the metadata. */
  readonly title?: string;
  /** Nova API version the game was built against (compatibility check). */
  readonly apiVersion?: number;
  /** Execution mode the host will launch (compatibility check). */
  readonly mode?: GameMode;
  /** The exact HTML document, transferred byte-identical. */
  readonly source: string;
  /** Precomputed SHA-256 (64 lowercase hex); computed when omitted. */
  readonly sourceSha256?: Sha256;
  /** Precomputed UTF-8 byte count; computed when omitted. */
  readonly sourceSizeBytes?: number;
}

/** The announced, pre-transfer descriptor for one game source. */
export interface GameSourceMetadataInfo {
  readonly gameId: GameId;
  readonly title?: string;
  readonly apiVersion?: number;
  readonly mode?: GameMode;
  readonly sourceSha256: Sha256;
  readonly sourceSizeBytes: number;
  readonly chunkCount: number;
}

/** Progress for one transfer direction, computed from source bytes. */
export interface GameSourceTransferProgress {
  readonly direction: "send" | "receive";
  readonly memberId: MemberId;
  readonly gameId: GameId;
  readonly sourceSha256: Sha256;
  readonly bytesTransferred: number;
  readonly totalBytes: number;
  /** Fraction of the source transferred, in [0, 1]. */
  readonly fraction: number;
}

/** Result of a joiner-side runtime compatibility check. */
export interface GameSourceCompatibility {
  readonly compatible: boolean;
  /** Human-readable reason when incompatible. */
  readonly reason?: string;
}

/** Injectable runtime compatibility check (default: Nova API version). */
export type GameSourceCompatibilityCheck = (
  metadata: GameSourceMetadataInfo,
) => GameSourceCompatibility | Promise<GameSourceCompatibility>;

/** Game-source transfer lifecycle events (lobby/UI-facing; P4 builds on). */
export type GameSourceTransferEvent =
  | {
      readonly type: "metadata";
      readonly metadata: GameSourceMetadataInfo;
      readonly fromMemberId: MemberId;
    }
  | {
      readonly type: "transferStart";
      readonly direction: "send" | "receive";
      readonly memberId: MemberId;
      readonly gameId: GameId;
      readonly sourceSha256: Sha256;
    }
  | { readonly type: "progress"; readonly progress: GameSourceTransferProgress }
  | {
      readonly type: "retry";
      readonly direction: "send" | "receive";
      readonly memberId: MemberId;
      readonly gameId: GameId;
      readonly sourceSha256: Sha256;
      readonly attempt: number;
    }
  | {
      readonly type: "received";
      readonly fromMemberId: MemberId;
      readonly gameId: GameId;
      readonly sourceSha256: Sha256;
      /** The verified, byte-identical HTML document (join the runtime with this). */
      readonly source: string;
    }
  | {
      readonly type: "complete";
      readonly direction: "send" | "receive";
      readonly memberId: MemberId;
      readonly gameId: GameId;
      readonly sourceSha256: Sha256;
    }
  | {
      readonly type: "verificationFailed";
      readonly memberId: MemberId;
      readonly gameId: GameId;
      readonly sourceSha256: Sha256;
      readonly errorMessage: string;
    }
  | {
      readonly type: "cancelled";
      readonly direction: "send" | "receive";
      readonly memberId: MemberId;
      readonly gameId: GameId;
      readonly sourceSha256: Sha256;
      readonly reason?: string;
    }
  | {
      readonly type: "incompatible";
      readonly memberId: MemberId;
      readonly gameId: GameId;
      readonly reason: string;
    }
  | {
      readonly type: "warning";
      readonly gameId: GameId;
      readonly sourceSizeBytes: number;
      readonly message: string;
    }
  | { readonly type: "error"; readonly error: GameSourceError };

/** Structured game-source transfer failures. */
export type GameSourceErrorCode =
  | "too_large" // source exceeds the F6 htmlSourceBytes hard limit
  | "no_source" // the holder has no source for the requested game
  | "not_admitted" // a non-member asked for the source
  | "hash_mismatch" // announced/requested hash disagrees with the local source
  | "incompatible" // the joiner's runtime cannot run the game
  | "retries_exhausted" // a failed/mismatched transfer never verified
  | "transfer_failed" // the transport refused or dropped the send
  | "invalid_message" // a malformed or unsolicited transfer message (T10)
  | "invalid_state" // operation not valid in the current coordinator state
  | "cancelled"; // the transfer was aborted

export class GameSourceError extends Error {
  readonly code: GameSourceErrorCode;
  override readonly cause?: unknown;

  constructor(code: GameSourceErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "GameSourceError";
    this.code = code;
    if (options?.cause !== undefined) {
      this.cause = options.cause;
    }
  }
}

/** Constructor config for {@link GameSourceCoordinator}. */
export interface GameSourceCoordinatorOptions {
  /** The established private-party transport (P2 admission flow). */
  readonly transport: NovaTransport;
  /** Nova API versions this build can serve (default: this build's). */
  readonly supportedApiVersions?: readonly number[];
  /** Runtime compatibility check override (default: Nova API version). */
  readonly compatibilityCheck?: GameSourceCompatibilityCheck;
  /** Source chunk budget in UTF-8 bytes (default: F6 message limit). */
  readonly chunkSizeBytes?: number;
  /** Retries after the initial attempt before giving up (default 2). */
  readonly maxRetries?: number;
  /** Event observer (lobby/UI-facing). */
  readonly onEvent?: (event: GameSourceTransferEvent) => void;
}

/** A registered source this member can serve (set locally or received). */
interface RegisteredSource {
  readonly info: GameSourceInfo;
  readonly metadata: GameSourceMetadataInfo;
  /** The source pre-split into schema-safe chunks (code-point aligned). */
  readonly chunks: readonly string[];
  /** UTF-8 byte length of each chunk (progress accounting). */
  readonly chunkByteLengths: readonly number[];
}

/** One in-flight outgoing transfer (host side, keyed by requesting member). */
interface SendTransfer {
  readonly memberId: MemberId;
  readonly connectionId: ConnectionId;
  readonly gameId: GameId;
  readonly sourceSha256: Sha256;
  readonly chunks: readonly string[];
  readonly chunkByteLengths: readonly number[];
  readonly maxAttempts: number;
  attempt: number;
  sentBytes: number;
  cancelled: boolean;
}

/** One in-flight incoming transfer (joiner side, keyed by game). */
interface ReceiveTransfer {
  readonly gameId: GameId;
  readonly sourceSha256: Sha256;
  readonly sourceSizeBytes: number;
  readonly chunkCount: number;
  readonly fromMemberId: MemberId;
  readonly connectionId: ConnectionId;
  received: Map<number, string>;
  receivedBytes: number;
  status: "receiving" | "failed" | "complete";
}

/** Envelope fields every game-source message carries (party pattern). */
interface GameSourceMessageBase {
  readonly sessionId: string;
  readonly senderMemberId: string;
  readonly senderConnectionId: string;
}

function envelope(base: GameSourceMessageBase) {
  return {
    version: PROTOCOL_VERSION,
    sessionId: base.sessionId,
    senderMemberId: base.senderMemberId,
    senderConnectionId: base.senderConnectionId,
    messageId: newMessageId(),
    sentAt: nowSentAt(),
  };
}

/** Build + validate a `game.source.metadata` announcement. */
function buildMetadataMessage(
  base: GameSourceMessageBase,
  input: GameSourceMetadataInfo,
): GameSourceMetadataMessage {
  return gameSourceMetadataMessageSchema.parse({
    ...envelope(base),
    type: "game.source.metadata",
    gameId: input.gameId,
    ...(input.title !== undefined ? { title: input.title } : {}),
    ...(input.apiVersion !== undefined ? { apiVersion: input.apiVersion } : {}),
    ...(input.mode !== undefined ? { mode: input.mode } : {}),
    sourceSha256: input.sourceSha256,
    sourceSizeBytes: input.sourceSizeBytes,
    chunkCount: input.chunkCount,
  });
}

/** Build + validate a `game.source.request`. */
function buildRequestMessage(
  base: GameSourceMessageBase,
  input: { gameId?: GameId; sourceSha256?: Sha256 },
): GameSourceRequestMessage {
  return gameSourceRequestMessageSchema.parse({
    ...envelope(base),
    type: "game.source.request",
    ...(input.gameId !== undefined ? { gameId: input.gameId } : {}),
    ...(input.sourceSha256 !== undefined ? { sourceSha256: input.sourceSha256 } : {}),
  });
}

/** Build + validate a `game.source.cancel`. */
function buildCancelMessage(
  base: GameSourceMessageBase,
  input: { gameId: GameId; sourceSha256: Sha256; reason?: string },
): GameSourceCancelMessage {
  return gameSourceCancelMessageSchema.parse({
    ...envelope(base),
    type: "game.source.cancel",
    gameId: input.gameId,
    sourceSha256: input.sourceSha256,
    ...(input.reason !== undefined ? { reason: input.reason } : {}),
  });
}

/** Build + validate a `game.source.ack`. */
function buildAckMessage(
  base: GameSourceMessageBase,
  input: {
    gameId: GameId;
    sourceSha256: Sha256;
    status: "received" | "failed";
    errorMessage?: string;
  },
): TransferAcknowledgementMessage {
  return transferAcknowledgementMessageSchema.parse({
    ...envelope(base),
    type: "game.source.ack",
    gameId: input.gameId,
    sourceSha256: input.sourceSha256,
    status: input.status,
    ...(input.errorMessage !== undefined ? { errorMessage: input.errorMessage } : {}),
  });
}

/** Build + validate a `game.source.chunk` (carried as a binary payload). */
function buildChunkMessage(
  base: GameSourceMessageBase,
  input: {
    gameId: GameId;
    sourceSha256: Sha256;
    chunkIndex: number;
    chunkCount: number;
    chunk: string;
  },
): GameSourceTransferMessage {
  return gameSourceTransferMessageSchema.parse({
    ...envelope(base),
    type: "game.source.chunk",
    gameId: input.gameId,
    sourceSha256: input.sourceSha256,
    chunkIndex: input.chunkIndex,
    chunkCount: input.chunkCount,
    chunk: input.chunk,
  });
}

/**
 * The game-source distribution coordinator: one per member, bound to the
 * member's private-party transport. The initiating player registers the
 * saved game with `setSource`; every member serves sources it holds (set or
 * verified-received) and requests sources it lacks. See the module doc for
 * the full flow.
 */
export class GameSourceCoordinator {
  readonly transport: NovaTransport;
  readonly memberId: MemberId;

  private readonly supportedApiVersions: readonly number[];
  private readonly compatibilityCheck: GameSourceCompatibilityCheck;
  private readonly chunkSizeBytes: number;
  private readonly maxRetries: number;
  private readonly listeners = new Set<(event: GameSourceTransferEvent) => void>();

  /** Sources this member can serve (set locally or received + verified). */
  private readonly sources = new Map<GameId, RegisteredSource>();
  private currentGameId: GameId | null = null;
  /** Outgoing transfers keyed by requesting member (one per member). */
  private readonly sendTransfers = new Map<MemberId, SendTransfer>();
  /** Incoming transfers keyed by game (one per game). */
  private readonly receiveTransfers = new Map<GameId, ReceiveTransfer>();
  /** Games whose receive transfer was cancelled; stale chunks are dropped. */
  private readonly cancelledTransfers = new Set<GameId>();
  private readonly unsubscribers: Array<() => void> = [];
  private disposed = false;

  constructor(options: GameSourceCoordinatorOptions) {
    this.transport = options.transport;
    this.memberId = options.transport.selfMemberId;
    this.supportedApiVersions = options.supportedApiVersions ?? [NOVA_API_VERSION];
    this.compatibilityCheck =
      options.compatibilityCheck ??
      ((metadata) => defaultGameSourceCompatibilityCheck(metadata, this.supportedApiVersions));
    // The chunk schema caps a chunk at `messageBytesBeforeChunking` UTF-16
    // code units; byte-budgeting below that keeps every chunk schema-safe
    // even when the source is entirely multi-byte.
    this.chunkSizeBytes = Math.min(
      options.chunkSizeBytes ?? messageBytesBeforeChunking,
      messageBytesBeforeChunking,
    );
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    if (options.onEvent !== undefined) {
      this.listeners.add(options.onEvent);
    }
    this.unsubscribers.push(
      this.transport.on("message:received", (message) => this.handleMessage(message)),
      this.transport.on("peer:joined", (peer) => this.handlePeerJoined(peer)),
      this.transport.on("peer:left", (peer) => this.handlePeerLeft(peer)),
      this.transport.on("connection:state", (state) => this.handleConnectionState(state)),
    );
  }

  // ------------------------------------------------------------------
  // Public surface
  // ------------------------------------------------------------------

  /**
   * Register the game source this member distributes, verify its size limits,
   * and announce it to the party. Rejects with a `too_large` error when the
   * source exceeds the F6 hard limit; emits a `warning` event at the soft
   * limit. Idempotent per game: calling again replaces the source and
   * re-announces (in-flight transfers of the old source are aborted).
   */
  async setSource(info: GameSourceInfo): Promise<GameSourceMetadataInfo> {
    this.assertAlive();
    const sourceSha256 = info.sourceSha256 ?? (await hashSource(info.source));
    const sourceSizeBytes = info.sourceSizeBytes ?? utf8ByteLength(info.source);
    if (sourceSizeBytes > htmlSourceBytes) {
      throw new GameSourceError(
        "too_large",
        `Game "${info.gameId}" is ${sourceSizeBytes} bytes — above the ${htmlSourceBytes}-byte ` +
          `hard limit. Split the game into a smaller single HTML document and try again.`,
      );
    }
    const chunks = chunkStringByUtf8Bytes(info.source, this.chunkSizeBytes);
    const metadata: GameSourceMetadataInfo = {
      gameId: info.gameId,
      ...(info.title !== undefined ? { title: info.title } : {}),
      ...(info.apiVersion !== undefined ? { apiVersion: info.apiVersion } : {}),
      ...(info.mode !== undefined ? { mode: info.mode } : {}),
      sourceSha256,
      sourceSizeBytes,
      chunkCount: chunks.length,
    };
    const registered: RegisteredSource = {
      info: { ...info, sourceSha256, sourceSizeBytes },
      metadata,
      chunks,
      chunkByteLengths: chunks.map((chunk) => utf8ByteLength(chunk)),
    };
    // Replacing a source aborts in-flight transfers of the old version.
    for (const transfer of this.sendTransfers.values()) {
      if (transfer.gameId === info.gameId) {
        this.abortSendTransfer(transfer, "source_replaced");
      }
    }
    this.sources.set(info.gameId, registered);
    this.currentGameId = info.gameId;
    if (sourceSizeBytes >= htmlSourceWarnBytes) {
      this.emit({
        type: "warning",
        gameId: info.gameId,
        sourceSizeBytes,
        message:
          `Game source is ${sourceSizeBytes} bytes — at or above the ` +
          `${htmlSourceWarnBytes}-byte soft limit. Large games transfer slower.`,
      });
    }
    await this.sendStructured(buildMetadataMessage(this.base(), metadata));
    return metadata;
  }

  /** True when this member holds a verified source for `gameId`. */
  hasSource(gameId: GameId): boolean {
    return this.sources.has(gameId);
  }

  /**
   * The verified source for `gameId` from the local in-memory session cache,
   * or undefined. The cache holds sources this member set or received +
   * verified during this session; it is never persisted and never uploaded
   * anywhere (ADR-0005).
   */
  getCachedSource(gameId: GameId): string | undefined {
    return this.sources.get(gameId)?.info.source;
  }

  /**
   * Ask the party to announce the current game (refresh after a missed
   * announcement, e.g. a coordinator created late). Holders reply with
   * targeted `game.source.metadata`; the joiner then requests the transfer.
   */
  async refresh(): Promise<void> {
    this.assertAlive();
    await this.sendStructured(buildRequestMessage(this.base(), {}));
  }

  /**
   * Cancel the in-flight transfer of one game: aborts the local receive
   * transfer (if any), tells the holder to stop sending, and aborts any
   * local send transfer to the requesting peer. Stale chunks that were
   * already in flight are dropped silently.
   */
  cancelTransfer(gameId: GameId, sourceSha256: Sha256, reason = "cancelled"): void {
    const receiveTransfer = this.receiveTransfers.get(gameId);
    if (receiveTransfer !== undefined && receiveTransfer.sourceSha256 === sourceSha256) {
      this.abortReceiveTransfer(receiveTransfer, reason);
      void this.sendStructured(
        buildCancelMessage(this.base(), { gameId, sourceSha256, reason }),
        receiveTransfer.connectionId,
      );
    }
    for (const transfer of this.sendTransfers.values()) {
      if (transfer.gameId === gameId && transfer.sourceSha256 === sourceSha256) {
        this.abortSendTransfer(transfer, reason);
      }
    }
  }

  /** Cancel every in-flight transfer (send and receive) for this member. */
  cancelAll(reason = "cancelled"): void {
    for (const transfer of this.receiveTransfers.values()) {
      this.cancelTransfer(transfer.gameId, transfer.sourceSha256, reason);
    }
    for (const transfer of this.sendTransfers.values()) {
      this.abortSendTransfer(transfer, reason);
    }
  }

  /**
   * Subscribe to game-source transfer events; returns an unsubscribe
   * function. Handlers are detached automatically by {@link dispose}.
   */
  subscribe(handler: (event: GameSourceTransferEvent) => void): () => void {
    this.listeners.add(handler);
    return () => {
      this.listeners.delete(handler);
    };
  }

  /**
   * Detach every transport listener and abort in-flight transfers
   * (engineering rule 22). Call this when the member leaves the party.
   */
  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    for (const unsubscribe of this.unsubscribers) {
      unsubscribe();
    }
    this.unsubscribers.length = 0;
    this.sendTransfers.clear();
    this.receiveTransfers.clear();
    this.cancelledTransfers.clear();
  }

  // ------------------------------------------------------------------
  // Message dispatch (inbound; every payload validated — T10)
  // ------------------------------------------------------------------

  private handleMessage(message: TransportMessage): void {
    if (this.disposed || message.channel !== GAME_SOURCE_CHANNEL) {
      return;
    }
    if (message.binary) {
      // Chunks travel as binary transport payloads (U5/P1 binary support);
      // decode + schema-validate before acting (threat model T10).
      const decoded = decodeChunkPayload(message.payload);
      const parsed = decoded === null ? null : parsePeerMessage(decoded);
      if (parsed === null || !parsed.ok) {
        this.emitError(
          new GameSourceError(
            "invalid_message",
            "Received a malformed game source chunk; dropped at the protocol boundary.",
          ),
        );
        return;
      }
      if (parsed.value.type === "game.source.chunk") {
        void this.handleChunk(message, parsed.value);
      }
      return;
    }
    const parsed = parsePeerMessage(message.payload);
    if (!parsed.ok) {
      this.emitError(
        new GameSourceError(
          "invalid_message",
          "Received a malformed game source message; dropped at the protocol boundary.",
        ),
      );
      return;
    }
    switch (parsed.value.type) {
      case "game.source.metadata":
        void this.handleMetadata(message, parsed.value);
        break;
      case "game.source.request":
        void this.handleRequest(message, parsed.value);
        break;
      case "game.source.cancel":
        this.handleCancel(message, parsed.value);
        break;
      case "game.source.ack":
        void this.handleAck(message, parsed.value);
        break;
      default:
        break; // foreign message types on our channel: drop (T10)
    }
  }

  // ------------------------------------------------------------------
  // Host side: announce, serve requests, retry, ack
  // ------------------------------------------------------------------

  private handlePeerJoined(peer: TransportPeerInfo): void {
    if (this.disposed) {
      return;
    }
    // Admitted members (and rejoiners) learn the current game on join.
    const gameId = this.currentGameId;
    if (gameId === null) {
      return;
    }
    const registered = this.sources.get(gameId);
    if (registered === undefined) {
      return;
    }
    void this.sendStructured(
      buildMetadataMessage(this.base(), registered.metadata),
      peer.connectionId,
    );
  }

  private async handleRequest(
    message: TransportMessage,
    request: GameSourceRequestMessage,
  ): Promise<void> {
    if (!this.isAdmitted(message.senderMemberId, message.senderConnectionId)) {
      this.emitError(
        new GameSourceError(
          "not_admitted",
          `Rejected a game source request from ${message.senderMemberId} — not an admitted ` +
            `private-room member. The source is never sent to rendezvous peers.`,
        ),
      );
      return;
    }
    if (request.gameId === undefined) {
      // Announce query: "what game is this party playing?"
      const gameId = this.currentGameId;
      if (gameId === null) {
        return;
      }
      const registered = this.sources.get(gameId);
      if (registered === undefined) {
        return;
      }
      await this.sendStructured(
        buildMetadataMessage(this.base(), registered.metadata),
        message.senderConnectionId,
      );
      return;
    }
    const registered = this.sources.get(request.gameId);
    if (registered === undefined) {
      if (request.sourceSha256 !== undefined) {
        await this.sendAck(
          message.senderConnectionId,
          request.gameId,
          request.sourceSha256,
          "failed",
          "no_source",
        );
      }
      this.emitError(new GameSourceError("no_source", `No game source for "${request.gameId}".`));
      return;
    }
    if (
      request.sourceSha256 !== undefined &&
      request.sourceSha256 !== registered.metadata.sourceSha256
    ) {
      await this.sendAck(
        message.senderConnectionId,
        request.gameId,
        request.sourceSha256,
        "failed",
        "hash_mismatch",
      );
      this.emitError(
        new GameSourceError(
          "hash_mismatch",
          `Requested hash for "${request.gameId}" does not match the local source.`,
        ),
      );
      return;
    }
    await this.startSendTransfer(message.senderMemberId, message.senderConnectionId, registered);
  }

  private async startSendTransfer(
    memberId: MemberId,
    connectionId: ConnectionId,
    registered: RegisteredSource,
  ): Promise<void> {
    const existing = this.sendTransfers.get(memberId);
    if (existing !== undefined && existing.gameId === registered.metadata.gameId) {
      return; // already sending this game to this member
    }
    if (existing !== undefined) {
      this.abortSendTransfer(existing, "superseded");
    }
    const transfer: SendTransfer = {
      memberId,
      connectionId,
      gameId: registered.metadata.gameId,
      sourceSha256: registered.metadata.sourceSha256,
      chunks: registered.chunks,
      chunkByteLengths: registered.chunkByteLengths,
      maxAttempts: this.maxRetries + 1,
      attempt: 1,
      sentBytes: 0,
      cancelled: false,
    };
    this.sendTransfers.set(memberId, transfer);
    this.emit({
      type: "transferStart",
      direction: "send",
      memberId,
      gameId: transfer.gameId,
      sourceSha256: transfer.sourceSha256,
    });
    await this.sendChunks(transfer);
  }

  private async sendChunks(transfer: SendTransfer): Promise<void> {
    for (let index = 0; index < transfer.chunks.length; index += 1) {
      if (this.disposed || transfer.cancelled) {
        return;
      }
      const chunk = transfer.chunks[index];
      if (chunk === undefined) {
        return;
      }
      const message = buildChunkMessage(this.base(), {
        gameId: transfer.gameId,
        sourceSha256: transfer.sourceSha256,
        chunkIndex: index,
        chunkCount: transfer.chunks.length,
        chunk,
      });
      try {
        await this.transport.send({
          channel: GAME_SOURCE_CHANNEL,
          payload: encodeChunkPayload(message),
          binary: true,
          targetConnectionId: transfer.connectionId,
        });
      } catch (error) {
        if (this.disposed || transfer.cancelled) {
          return;
        }
        this.sendTransfers.delete(transfer.memberId);
        this.emitError(
          new GameSourceError(
            "transfer_failed",
            `Failed to send game source chunk ${index} of "${transfer.gameId}" ` +
              `to ${transfer.memberId}: ${String(error)}`,
            { cause: error },
          ),
        );
        return;
      }
      transfer.sentBytes += transfer.chunkByteLengths[index] ?? 0;
      this.emitProgress(
        "send",
        transfer.memberId,
        transfer.gameId,
        transfer.sourceSha256,
        transfer,
      );
    }
  }

  private async handleAck(
    message: TransportMessage,
    ack: TransferAcknowledgementMessage,
  ): Promise<void> {
    // Sender-side: a receiver reports the result of a transfer we sent.
    const sendTransfer = this.sendTransfers.get(message.senderMemberId);
    if (
      sendTransfer !== undefined &&
      sendTransfer.gameId === ack.gameId &&
      sendTransfer.sourceSha256 === ack.sourceSha256
    ) {
      await this.handleSendAck(message, sendTransfer, ack);
      return;
    }
    // Receiver-side: the holder refuses/aborts a transfer we requested.
    const receiveTransfer = this.receiveTransfers.get(ack.gameId);
    if (
      receiveTransfer !== undefined &&
      receiveTransfer.sourceSha256 === ack.sourceSha256 &&
      ack.status === "failed"
    ) {
      const reason = ack.errorMessage ?? "transfer_failed";
      this.abortReceiveTransfer(receiveTransfer, reason);
      this.emitError(
        new GameSourceError(
          toTerminalErrorCode(reason),
          `Game source transfer of "${ack.gameId}" failed: ${reason}`,
        ),
      );
      return;
    }
    // A peer declined a game we hold before (or without) a transfer (e.g.
    // the runtime compatibility check failed or the game is too large for
    // them): surface it so the host can tell the joiner why.
    if (
      ack.status === "failed" &&
      this.isAdmitted(message.senderMemberId, message.senderConnectionId)
    ) {
      const registered = this.sources.get(ack.gameId);
      if (registered !== undefined) {
        const reason = ack.errorMessage ?? "transfer_failed";
        this.emitError(
          new GameSourceError(
            toTerminalErrorCode(reason),
            `Peer ${message.senderMemberId} could not receive "${ack.gameId}": ${reason}`,
          ),
        );
      }
    }
  }

  private async handleSendAck(
    message: TransportMessage,
    transfer: SendTransfer,
    ack: TransferAcknowledgementMessage,
  ): Promise<void> {
    if (ack.status === "received") {
      this.sendTransfers.delete(transfer.memberId);
      this.emit({
        type: "complete",
        direction: "send",
        memberId: transfer.memberId,
        gameId: transfer.gameId,
        sourceSha256: transfer.sourceSha256,
      });
      return;
    }
    const reason = ack.errorMessage ?? "transfer_failed";
    if (isTerminalAckFailure(reason)) {
      this.sendTransfers.delete(transfer.memberId);
      this.emitError(
        new GameSourceError(
          toTerminalErrorCode(reason),
          `Game source transfer of "${transfer.gameId}" to ${transfer.memberId} failed: ${reason}`,
        ),
      );
      return;
    }
    if (transfer.attempt >= transfer.maxAttempts) {
      this.sendTransfers.delete(transfer.memberId);
      this.emitError(
        new GameSourceError(
          "retries_exhausted",
          `Game source transfer of "${transfer.gameId}" to ${transfer.memberId} failed after ` +
            `${transfer.maxAttempts} attempts (last error: ${reason}).`,
        ),
      );
      // Tell the joiner so its receive state aborts instead of waiting.
      await this.sendAck(
        message.senderConnectionId,
        transfer.gameId,
        transfer.sourceSha256,
        "failed",
        "retries_exhausted",
      );
      return;
    }
    transfer.attempt += 1;
    transfer.sentBytes = 0;
    this.emit({
      type: "retry",
      direction: "send",
      memberId: transfer.memberId,
      gameId: transfer.gameId,
      sourceSha256: transfer.sourceSha256,
      attempt: transfer.attempt,
    });
    await this.sendChunks(transfer);
  }

  // ------------------------------------------------------------------
  // Joiner side: metadata, compatibility, request, chunks, verify, ack
  // ------------------------------------------------------------------

  private async handleMetadata(
    message: TransportMessage,
    metadata: GameSourceMetadataMessage,
  ): Promise<void> {
    const info = toMetadataInfo(metadata);
    this.emit({ type: "metadata", metadata: info, fromMemberId: message.senderMemberId });
    const existing = this.sources.get(metadata.gameId);
    if (existing !== undefined) {
      return; // already hold a verified source for this game (any version)
    }
    this.cancelledTransfers.delete(metadata.gameId); // a fresh announcement supersedes a cancellation
    if (metadata.sourceSizeBytes > htmlSourceBytes) {
      await this.sendAck(
        message.senderConnectionId,
        metadata.gameId,
        metadata.sourceSha256,
        "failed",
        "too_large",
      );
      this.emitError(
        new GameSourceError(
          "too_large",
          `Game "${metadata.gameId}" is ${metadata.sourceSizeBytes} bytes — above the ` +
            `${htmlSourceBytes}-byte hard limit and too large to transfer.`,
        ),
      );
      return;
    }
    const compatibility = await this.compatibilityCheck(info);
    if (!compatibility.compatible) {
      const reason = compatibility.reason ?? "unsupported";
      await this.sendAck(
        message.senderConnectionId,
        metadata.gameId,
        metadata.sourceSha256,
        "failed",
        `incompatible: ${reason}`,
      );
      this.emit({
        type: "incompatible",
        memberId: message.senderMemberId,
        gameId: metadata.gameId,
        reason,
      });
      return;
    }
    if (this.receiveTransfers.has(metadata.gameId)) {
      return; // already receiving this game
    }
    this.receiveTransfers.set(metadata.gameId, {
      gameId: metadata.gameId,
      sourceSha256: metadata.sourceSha256,
      sourceSizeBytes: metadata.sourceSizeBytes,
      chunkCount: metadata.chunkCount,
      fromMemberId: message.senderMemberId,
      connectionId: message.senderConnectionId,
      received: new Map(),
      receivedBytes: 0,
      status: "receiving",
    });
    this.emit({
      type: "transferStart",
      direction: "receive",
      memberId: message.senderMemberId,
      gameId: metadata.gameId,
      sourceSha256: metadata.sourceSha256,
    });
    await this.sendStructured(
      buildRequestMessage(this.base(), {
        gameId: metadata.gameId,
        sourceSha256: metadata.sourceSha256,
      }),
      message.senderConnectionId,
    );
  }

  private handleChunk(message: TransportMessage, chunk: GameSourceTransferMessage): void {
    if (this.cancelledTransfers.has(chunk.gameId)) {
      return; // stale chunk from a cancelled transfer (already in flight)
    }
    let transfer = this.receiveTransfers.get(chunk.gameId);
    if (transfer === undefined) {
      if (this.sources.has(chunk.gameId)) {
        return; // stale duplicate of an already verified transfer
      }
      // A chunk without a prior metadata/request: unsolicited (T10).
      this.emitError(
        new GameSourceError(
          "invalid_message",
          `Received an unsolicited game source chunk for "${chunk.gameId}"; dropped.`,
        ),
      );
      return;
    }
    if (transfer.sourceSha256 !== chunk.sourceSha256) {
      this.emitError(
        new GameSourceError(
          "hash_mismatch",
          `Received a game source chunk for "${chunk.gameId}" with a different hash than requested; dropped.`,
        ),
      );
      return;
    }
    if (transfer.chunkCount !== chunk.chunkCount) {
      this.emitError(
        new GameSourceError(
          "invalid_message",
          `Received a game source chunk for "${chunk.gameId}" with an inconsistent chunk count; dropped.`,
        ),
      );
      return;
    }
    if (chunk.chunkIndex >= chunk.chunkCount) {
      this.emitError(
        new GameSourceError(
          "invalid_message",
          `Received an out-of-range game source chunk index ${chunk.chunkIndex} for "${chunk.gameId}"; dropped.`,
        ),
      );
      return;
    }
    if (transfer.status === "complete") {
      return; // already verified; duplicate chunks are ignored
    }
    if (transfer.status === "failed") {
      // A host retry after a failed verification: reset and start fresh.
      transfer.received.clear();
      transfer.receivedBytes = 0;
      transfer.status = "receiving";
      this.emit({
        type: "retry",
        direction: "receive",
        memberId: transfer.fromMemberId,
        gameId: transfer.gameId,
        sourceSha256: transfer.sourceSha256,
        attempt: 1,
      });
    }
    if (transfer.received.has(chunk.chunkIndex)) {
      return; // duplicate chunk
    }
    const chunkBytes = utf8ByteLength(chunk.chunk);
    if (transfer.receivedBytes + chunkBytes > transfer.sourceSizeBytes) {
      // The receiver enforces the announced byte count too (T11 defense).
      this.abortReceiveTransfer(transfer, "received_more_than_announced");
      this.emitError(
        new GameSourceError(
          "too_large",
          `Game source transfer of "${chunk.gameId}" exceeded the announced size; aborted.`,
        ),
      );
      return;
    }
    transfer.received.set(chunk.chunkIndex, chunk.chunk);
    transfer.receivedBytes += chunkBytes;
    this.emitProgress(
      "receive",
      transfer.fromMemberId,
      transfer.gameId,
      transfer.sourceSha256,
      transfer,
    );
    if (transfer.received.size !== transfer.chunkCount) {
      return;
    }
    void this.verifyReceive(transfer);
  }

  private async verifyReceive(transfer: ReceiveTransfer): Promise<void> {
    // The transfer may have been aborted while the digest was computing; the
    // abort removed it from the map, so the identity check bails cleanly
    // instead of completing a cancelled transfer.
    if (this.receiveTransfers.get(transfer.gameId) !== transfer) {
      return;
    }
    const parts: string[] = [];
    for (let index = 0; index < transfer.chunkCount; index += 1) {
      const part = transfer.received.get(index);
      if (part === undefined) {
        this.abortReceiveTransfer(transfer, "incomplete_transfer");
        return;
      }
      parts.push(part);
    }
    const source = parts.join("");
    const actualHash = await hashSource(source);
    const actualBytes = utf8ByteLength(source);
    if (this.receiveTransfers.get(transfer.gameId) !== transfer) {
      return; // aborted mid-verification
    }
    if (actualHash !== transfer.sourceSha256 || actualBytes !== transfer.sourceSizeBytes) {
      transfer.status = "failed";
      this.emit({
        type: "verificationFailed",
        memberId: transfer.fromMemberId,
        gameId: transfer.gameId,
        sourceSha256: transfer.sourceSha256,
        errorMessage: `SHA-256 ${actualHash} or byte count ${actualBytes} does not match the announcement`,
      });
      await this.sendAck(
        transfer.connectionId,
        transfer.gameId,
        transfer.sourceSha256,
        "failed",
        "hash_mismatch",
      );
      return;
    }
    transfer.status = "complete";
    const metadata = toMetadataInfo({
      gameId: transfer.gameId,
      sourceSha256: transfer.sourceSha256,
      sourceSizeBytes: transfer.sourceSizeBytes,
      chunkCount: transfer.chunkCount,
    });
    const chunks = chunkStringByUtf8Bytes(source, this.chunkSizeBytes);
    this.sources.set(transfer.gameId, {
      info: {
        gameId: transfer.gameId,
        source,
        sourceSha256: transfer.sourceSha256,
        sourceSizeBytes: transfer.sourceSizeBytes,
      },
      metadata,
      chunks,
      chunkByteLengths: chunks.map((chunk) => utf8ByteLength(chunk)),
    });
    this.receiveTransfers.delete(transfer.gameId);
    this.emit({
      type: "received",
      fromMemberId: transfer.fromMemberId,
      gameId: transfer.gameId,
      sourceSha256: transfer.sourceSha256,
      source,
    });
    await this.sendAck(transfer.connectionId, transfer.gameId, transfer.sourceSha256, "received");
  }

  private handleCancel(message: TransportMessage, cancel: GameSourceCancelMessage): void {
    const sendTransfer = this.sendTransfers.get(message.senderMemberId);
    if (
      sendTransfer !== undefined &&
      sendTransfer.gameId === cancel.gameId &&
      sendTransfer.sourceSha256 === cancel.sourceSha256
    ) {
      this.abortSendTransfer(sendTransfer, cancel.reason ?? "cancelled_by_peer");
    }
    const receiveTransfer = this.receiveTransfers.get(cancel.gameId);
    if (receiveTransfer !== undefined && receiveTransfer.sourceSha256 === cancel.sourceSha256) {
      this.abortReceiveTransfer(receiveTransfer, cancel.reason ?? "cancelled_by_peer");
    }
  }

  // ------------------------------------------------------------------
  // Lifecycle: peer leave, connection loss, aborts
  // ------------------------------------------------------------------

  private handlePeerLeft(peer: TransportPeerInfo): void {
    if (this.disposed) {
      return;
    }
    const sendTransfer = this.sendTransfers.get(peer.memberId);
    if (sendTransfer !== undefined) {
      this.abortSendTransfer(sendTransfer, "peer_left");
    }
    for (const transfer of this.receiveTransfers.values()) {
      if (transfer.fromMemberId === peer.memberId) {
        this.abortReceiveTransfer(transfer, "peer_left");
      }
    }
  }

  private handleConnectionState(state: TransportConnectionState): void {
    if (this.disposed) {
      return;
    }
    if (state === "suspended" || state === "disconnected") {
      // Our own connection dropped: every in-flight transfer is stale
      // (fresh connection IDs on reconnect). The host re-announces on our
      // rejoin and we re-request only if we still lack the source.
      for (const transfer of this.sendTransfers.values()) {
        this.abortSendTransfer(transfer, "connection_lost");
      }
      for (const transfer of this.receiveTransfers.values()) {
        this.abortReceiveTransfer(transfer, "connection_lost");
      }
    }
  }

  private abortSendTransfer(transfer: SendTransfer, reason: string): void {
    transfer.cancelled = true;
    this.sendTransfers.delete(transfer.memberId);
    this.emit({
      type: "cancelled",
      direction: "send",
      memberId: transfer.memberId,
      gameId: transfer.gameId,
      sourceSha256: transfer.sourceSha256,
      reason,
    });
  }

  private abortReceiveTransfer(transfer: ReceiveTransfer, reason: string): void {
    this.receiveTransfers.delete(transfer.gameId);
    this.cancelledTransfers.add(transfer.gameId);
    this.emit({
      type: "cancelled",
      direction: "receive",
      memberId: transfer.fromMemberId,
      gameId: transfer.gameId,
      sourceSha256: transfer.sourceSha256,
      reason,
    });
  }

  // ------------------------------------------------------------------
  // Internals
  // ------------------------------------------------------------------

  private base(): GameSourceMessageBase {
    return {
      sessionId: this.transport.sessionId ?? "",
      senderMemberId: this.transport.selfMemberId,
      senderConnectionId: this.transport.selfConnectionId,
    };
  }

  /** True when the sender is a currently connected private-room member. */
  private isAdmitted(memberId: MemberId, connectionId: ConnectionId): boolean {
    return this.transport.peers.some(
      (peer) => peer.memberId === memberId && peer.connectionId === connectionId,
    );
  }

  private async sendStructured(
    message: PeerMessage,
    targetConnectionId?: ConnectionId,
  ): Promise<void> {
    try {
      await this.transport.send({
        channel: GAME_SOURCE_CHANNEL,
        payload: message,
        targetConnectionId,
      });
    } catch (error) {
      this.emitError(
        new GameSourceError(
          "transfer_failed",
          `Failed to send game source message (${(message as { type: string }).type}): ${String(error)}`,
          { cause: error },
        ),
      );
    }
  }

  private async sendAck(
    targetConnectionId: ConnectionId,
    gameId: GameId,
    sourceSha256: Sha256,
    status: "received" | "failed",
    errorMessage?: string,
  ): Promise<void> {
    await this.sendStructured(
      buildAckMessage(this.base(), {
        gameId,
        sourceSha256,
        status,
        ...(errorMessage !== undefined ? { errorMessage } : {}),
      }),
      targetConnectionId,
    );
  }

  private emitProgress(
    direction: "send" | "receive",
    memberId: MemberId,
    gameId: GameId,
    sourceSha256: Sha256,
    transfer: SendTransfer | ReceiveTransfer,
  ): void {
    const bytesTransferred =
      direction === "send"
        ? (transfer as SendTransfer).sentBytes
        : (transfer as ReceiveTransfer).receivedBytes;
    const totalBytes =
      direction === "send"
        ? sendTransferTotal(transfer as SendTransfer)
        : (transfer as ReceiveTransfer).sourceSizeBytes;
    this.emit({
      type: "progress",
      progress: {
        direction,
        memberId,
        gameId,
        sourceSha256,
        bytesTransferred,
        totalBytes,
        fraction: totalBytes === 0 ? 1 : Math.min(1, bytesTransferred / totalBytes),
      },
    });
  }

  private emit(event: GameSourceTransferEvent): void {
    for (const handler of this.listeners) {
      handler(event);
    }
  }

  private emitError(error: GameSourceError): void {
    this.emit({ type: "error", error });
  }

  private assertAlive(): void {
    if (this.disposed) {
      throw new GameSourceError(
        "invalid_state",
        "GameSourceCoordinator: coordinator was disposed; create a new one after re-joining.",
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Defaults and helpers
// ---------------------------------------------------------------------------

/**
 * Default runtime compatibility check: a game is runnable when it declares no
 * Nova API version, or declares one this build serves. Modes are not
 * restricted here (S1 supports all three); the shell may inject a stricter
 * policy via `compatibilityCheck`.
 */
export function defaultGameSourceCompatibilityCheck(
  metadata: GameSourceMetadataInfo,
  supportedApiVersions: readonly number[],
): GameSourceCompatibility {
  if (metadata.apiVersion === undefined) {
    return { compatible: true };
  }
  if (supportedApiVersions.includes(metadata.apiVersion)) {
    return { compatible: true };
  }
  return {
    compatible: false,
    reason:
      `game targets Nova API version ${metadata.apiVersion}, but this build supports ` +
      `[${supportedApiVersions.join(", ")}]`,
  };
}

/** Map a `game.source.metadata` message to the coordinator's metadata shape. */
function toMetadataInfo(
  metadata: GameSourceMetadataMessage | GameSourceMetadataInfo,
): GameSourceMetadataInfo {
  return {
    gameId: metadata.gameId,
    ...("title" in metadata && metadata.title !== undefined ? { title: metadata.title } : {}),
    ...("apiVersion" in metadata && metadata.apiVersion !== undefined
      ? { apiVersion: metadata.apiVersion }
      : {}),
    ...("mode" in metadata && metadata.mode !== undefined ? { mode: metadata.mode } : {}),
    sourceSha256: metadata.sourceSha256,
    sourceSizeBytes: metadata.sourceSizeBytes,
    chunkCount: metadata.chunkCount,
  };
}

/**
 * Terminal (non-retryable) receiver failures: the peer refused the transfer
 * for a reason no amount of re-sending fixes.
 */
function isTerminalAckFailure(reason: string): boolean {
  return (
    reason.startsWith("incompatible") ||
    reason.startsWith("too_large") ||
    reason.startsWith("no_source") ||
    reason.startsWith("retries_exhausted")
  );
}

function toTerminalErrorCode(reason: string): GameSourceErrorCode {
  if (reason.startsWith("incompatible")) return "incompatible";
  if (reason.startsWith("too_large")) return "too_large";
  if (reason.startsWith("no_source")) return "no_source";
  if (reason.startsWith("retries_exhausted")) return "retries_exhausted";
  return "transfer_failed";
}

/** Total source bytes of a send transfer (progress denominator). */
function sendTransferTotal(transfer: SendTransfer): number {
  let total = 0;
  for (const length of transfer.chunkByteLengths) {
    total += length;
  }
  return total;
}

/** SHA-256 digest of a string as 64 lowercase hex chars (Web Crypto). */
export async function hashSource(source: string): Promise<Sha256> {
  const bytes = new TextEncoder().encode(source);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return bytesToHex(new Uint8Array(digest));
}

/** UTF-8 byte length of a string (protocol byte-limit semantics). */
export function utf8ByteLength(source: string): number {
  return new TextEncoder().encode(source).byteLength;
}

/**
 * Split a source into chunks of at most `maxBytes` UTF-8 bytes on code-point
 * boundaries (never between surrogate halves), so every chunk is valid
 * standalone text, stays under the F6 chunk-schema limit, and re-joins to
 * the byte-identical original.
 */
export function chunkStringByUtf8Bytes(source: string, maxBytes: number): string[] {
  if (source.length === 0) {
    return [];
  }
  const chunks: string[] = [];
  let start = 0;
  let byteCount = 0;
  let index = 0;
  while (index < source.length) {
    const codePoint = source.codePointAt(index) ?? 0;
    const codeUnits = codePoint > 0xffff ? 2 : 1;
    const bytes = utf8BytesOfCodePoint(codePoint);
    if (byteCount + bytes > maxBytes && index > start) {
      chunks.push(source.slice(start, index));
      start = index;
      byteCount = 0;
    }
    byteCount += bytes;
    index += codeUnits;
  }
  if (start < source.length) {
    chunks.push(source.slice(start));
  }
  return chunks;
}

/** UTF-8 encoded byte count of one code point. */
function utf8BytesOfCodePoint(codePoint: number): number {
  if (codePoint <= 0x7f) return 1;
  if (codePoint <= 0x7ff) return 2;
  if (codePoint <= 0xffff) return 3;
  return 4;
}

/** Encode a validated chunk message as a binary transport payload. */
function encodeChunkPayload(message: GameSourceTransferMessage): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(message));
}

/** Decode a binary transport payload back to a structured chunk message. */
function decodeChunkPayload(payload: unknown): unknown {
  let bytes: Uint8Array | null = null;
  if (payload instanceof Uint8Array) {
    bytes = payload;
  } else if (payload instanceof ArrayBuffer) {
    bytes = new Uint8Array(payload);
  }
  if (bytes === null) {
    return null;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    return null;
  }
}

const HEX_DIGITS = "0123456789abcdef";

function bytesToHex(bytes: Uint8Array): string {
  let hex = "";
  for (const byte of bytes) {
    hex += HEX_DIGITS.charAt(byte >> 4) + HEX_DIGITS.charAt(byte & 0x0f);
  }
  return hex;
}
