import type { ConnectionId, GameId, GameMode, MemberId, Sha256 } from "@rocketcrab/protocol";
import {
  PROTOCOL_VERSION,
  gameSourceMetadataMessageSchema,
  gameSourceAcceptedMessageSchema,
  gameSourceDiscoverMessageSchema,
  htmlSourceBytes,
  htmlSourceWarnBytes,
  parsePeerMessage,
  type PeerMessage,
} from "@rocketcrab/protocol";
import { NOVA_API_VERSION } from "@rocketcrab/nova-api/version";
import type { NovaTransport, TransportMessage } from "@rocketcrab/core";
import { newMessageId, nowSentAt } from "./messages";

/** Source control stays on the trusted shell; HTML is a binary request response. */
export const GAME_SOURCE_CHANNEL = "nova.source";
const MAX_CACHED_SOURCES = 8;

export interface GameSourceInfo {
  readonly gameId: GameId;
  readonly title?: string;
  readonly apiVersion?: number;
  readonly mode?: GameMode;
  readonly source: string;
  readonly sourceSha256?: Sha256;
  readonly sourceSizeBytes?: number;
}
export interface GameSourceMetadataInfo {
  readonly gameId: GameId;
  readonly title?: string;
  readonly apiVersion?: number;
  readonly mode?: GameMode;
  readonly sourceSha256: Sha256;
  readonly sourceSizeBytes: number;
}
export interface GameSourceTransferProgress {
  readonly direction: "send" | "receive";
  readonly memberId: MemberId;
  readonly gameId: GameId;
  readonly sourceSha256: Sha256;
  readonly bytesTransferred: number;
  readonly totalBytes: number;
  readonly fraction: number;
}
export interface GameSourceCompatibility {
  readonly compatible: boolean;
  readonly reason?: string;
}
export type GameSourceCompatibilityCheck = (
  metadata: GameSourceMetadataInfo,
) => GameSourceCompatibility | Promise<GameSourceCompatibility>;
type TransferIdentity = {
  readonly memberId: MemberId;
  readonly gameId: GameId;
  readonly sourceSha256: Sha256;
};
export type GameSourceTransferEvent =
  | {
      readonly type: "metadata";
      readonly metadata: GameSourceMetadataInfo;
      readonly fromMemberId: MemberId;
    }
  | ({
      readonly type: "transferStart" | "complete";
      readonly direction: "send" | "receive";
    } & TransferIdentity)
  | { readonly type: "progress"; readonly progress: GameSourceTransferProgress }
  | {
      readonly type: "received";
      readonly fromMemberId: MemberId;
      readonly gameId: GameId;
      readonly sourceSha256: Sha256;
      readonly source: string;
    }
  | ({ readonly type: "verificationFailed"; readonly errorMessage: string } & TransferIdentity)
  | ({
      readonly type: "cancelled";
      readonly direction: "send" | "receive";
      readonly reason?: string;
    } & TransferIdentity)
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
export type GameSourceErrorCode =
  | "too_large"
  | "no_source"
  | "hash_mismatch"
  | "incompatible"
  | "transfer_failed"
  | "invalid_message"
  | "invalid_state"
  | "cancelled";
export class GameSourceError extends Error {
  constructor(
    readonly code: GameSourceErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "GameSourceError";
  }
}
export interface GameSourceCoordinatorOptions {
  readonly transport: NovaTransport;
  readonly supportedApiVersions?: readonly number[];
  readonly compatibilityCheck?: GameSourceCompatibilityCheck;
  readonly onEvent?: (event: GameSourceTransferEvent) => void;
}
interface RegisteredSource {
  readonly metadata: GameSourceMetadataInfo;
  readonly source: string;
  readonly bytes: Uint8Array;
}
interface ReceiveTransfer {
  readonly metadata: GameSourceMetadataInfo;
  readonly memberId: MemberId;
  readonly connectionId: ConnectionId;
  readonly controller: AbortController;
}

/** Trystero owns chunking, backpressure, correlation, cancellation and timeouts.
 * The shell retains only metadata, bounded verified cache, and application-level
 * acceptance (a delivered response does NOT mean the receiver accepted HTML).
 * No chunk ACKs, automatic retransmits, source framing or retry state machine.
 */
export class GameSourceCoordinator {
  private readonly transport: NovaTransport;
  private readonly compatibilityCheck: GameSourceCompatibilityCheck;
  private readonly listeners = new Set<(event: GameSourceTransferEvent) => void>();
  private readonly sources = new Map<GameId, RegisteredSource>();
  private readonly offered = new Map<ConnectionId, GameSourceMetadataInfo>();
  private readonly unsubscribers: Array<() => void>;
  private incoming: ReceiveTransfer | null = null;
  private currentGameId: GameId | null = null;
  private disposed = false;
  // Invalidates async compatibility/hash checks when a newer selection arrives.
  private generation = 0;

  constructor(options: GameSourceCoordinatorOptions) {
    this.transport = options.transport;
    this.compatibilityCheck =
      options.compatibilityCheck ??
      ((metadata) =>
        defaultGameSourceCompatibilityCheck(
          metadata,
          options.supportedApiVersions ?? [NOVA_API_VERSION],
        ));
    if (options.onEvent) this.listeners.add(options.onEvent);
    this.unsubscribers = [
      this.transport.handleRequest(GAME_SOURCE_CHANNEL, (payload, context) => {
        if (
          this.disposed ||
          context.signal.aborted ||
          !this.isMember(context.senderMemberId, context.senderConnectionId)
        )
          throw new GameSourceError(
            "invalid_message",
            "Source request from a disconnected member.",
          );
        if (!payload || typeof payload !== "object")
          throw new GameSourceError("invalid_message", "Invalid source request.");
        const request = payload as { gameId?: unknown; sourceSha256?: unknown };
        const cached =
          typeof request.gameId === "string" ? this.sources.get(request.gameId) : undefined;
        if (!cached || cached.metadata.sourceSha256 !== request.sourceSha256)
          throw new GameSourceError("no_source", "Requested source is not available.");
        this.offered.set(context.senderConnectionId, cached.metadata);
        this.emit({
          type: "transferStart",
          direction: "send",
          memberId: context.senderMemberId,
          ...identity(cached.metadata),
        });
        return cached.bytes;
      }),
      this.transport.on("message:received", (message) => {
        void this.handleMessage(message).catch((error) => this.emitError(error));
      }),
      this.transport.on("peer:joined", (peer) => {
        void this.announce(peer.connectionId).catch((error) => this.emitError(error));
      }),
      this.transport.on("peer:left", (peer) => {
        this.offered.delete(peer.connectionId);
        if (this.incoming?.connectionId === peer.connectionId) this.cancelAll("peer_disconnected");
      }),
      this.transport.on("connection:state", (state) => {
        if (state !== "connected") this.cancelAll("connection_lost");
      }),
    ];
  }

  async setSource(info: GameSourceInfo): Promise<GameSourceMetadataInfo> {
    this.assertAlive();
    const bytes = new TextEncoder().encode(info.source);
    if (bytes.byteLength > htmlSourceBytes)
      throw new GameSourceError(
        "too_large",
        `Game source exceeds the ${htmlSourceBytes}-byte hard limit.`,
      );
    if (new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes) !== info.source)
      throw new GameSourceError("invalid_message", "Source contains invalid Unicode.");
    const sourceSha256 = await hashSource(info.source);
    this.assertAlive();
    if (
      (info.sourceSha256 !== undefined && info.sourceSha256 !== sourceSha256) ||
      (info.sourceSizeBytes !== undefined && info.sourceSizeBytes !== bytes.byteLength)
    )
      throw new GameSourceError(
        "hash_mismatch",
        "Precomputed source hash/size does not match the HTML.",
      );
    const metadata = this.metadata({ ...info, sourceSha256, sourceSizeBytes: bytes.byteLength });
    this.cancelAll("source_replaced");
    this.offered.clear();
    this.cache({ metadata, source: info.source, bytes });
    this.currentGameId = metadata.gameId;
    if (bytes.byteLength >= htmlSourceWarnBytes)
      this.emit({
        type: "warning",
        gameId: info.gameId,
        sourceSizeBytes: bytes.byteLength,
        message: `Game source is ${bytes.byteLength} bytes. Large games transfer slower.`,
      });
    await this.announce();
    return metadata;
  }
  hasSource(gameId: GameId): boolean {
    return this.sources.has(gameId);
  }
  getCachedSource(gameId: GameId, sourceSha256?: Sha256): string | undefined {
    const cached = this.sources.get(gameId);
    return cached && (sourceSha256 === undefined || cached.metadata.sourceSha256 === sourceSha256)
      ? cached.source
      : undefined;
  }
  async refresh(): Promise<void> {
    this.assertAlive();
    await this.send(
      gameSourceDiscoverMessageSchema.parse({ ...this.base(), type: "game.source.discover" }),
    );
  }
  cancelTransfer(gameId: GameId, sourceSha256: Sha256, reason = "cancelled"): void {
    if (
      this.incoming?.metadata.gameId === gameId &&
      this.incoming.metadata.sourceSha256 === sourceSha256
    ) {
      const transfer = this.incoming;
      this.incoming = null;
      transfer.controller.abort();
      this.generation++;
      this.emit({
        type: "cancelled",
        direction: "receive",
        memberId: transfer.memberId,
        ...identity(transfer.metadata),
        reason,
      });
    }
    for (const [connectionId, metadata] of this.offered)
      if (metadata.gameId === gameId && metadata.sourceSha256 === sourceSha256)
        this.offered.delete(connectionId);
  }
  cancelAll(reason = "cancelled"): void {
    this.generation++;
    if (this.incoming)
      this.cancelTransfer(
        this.incoming.metadata.gameId,
        this.incoming.metadata.sourceSha256,
        reason,
      );
    this.offered.clear();
  }
  subscribe(handler: (event: GameSourceTransferEvent) => void): () => void {
    this.listeners.add(handler);
    return () => {
      this.listeners.delete(handler);
    };
  }
  dispose(): void {
    if (this.disposed) return;
    this.cancelAll("disposed");
    this.disposed = true;
    for (const unsubscribe of this.unsubscribers) unsubscribe();
    this.sources.clear();
    this.offered.clear();
    this.listeners.clear();
  }

  private async handleMessage(message: TransportMessage): Promise<void> {
    if (this.disposed || message.channel !== GAME_SOURCE_CHANNEL) return;
    if (
      message.sessionId !== this.transport.sessionId ||
      !this.isMember(message.senderMemberId, message.senderConnectionId)
    )
      return;
    const parsed = parsePeerMessage(message.payload);
    if (
      !parsed.ok ||
      parsed.value.senderMemberId !== message.senderMemberId ||
      parsed.value.senderConnectionId !== message.senderConnectionId ||
      parsed.value.sessionId !== message.sessionId
    ) {
      this.emitError(new GameSourceError("invalid_message", "Invalid source control message."));
      return;
    }
    const control = parsed.value;
    if (control.type === "game.source.discover") {
      await this.announce(message.senderConnectionId);
      return;
    }
    if (control.type === "game.source.accepted") {
      const offer = this.offered.get(message.senderConnectionId);
      if (!offer || offer.gameId !== control.gameId || offer.sourceSha256 !== control.sourceSha256)
        return;
      this.offered.delete(message.senderConnectionId);
      this.emit({
        type: "complete",
        direction: "send",
        memberId: message.senderMemberId,
        ...identity(offer),
      });
      return;
    }
    if (control.type !== "game.source.metadata") return;
    const metadata = this.metadata(control);
    if (metadata.sourceSizeBytes > htmlSourceBytes)
      throw new GameSourceError("too_large", "Announced source exceeds the hard limit.");
    // Duplicate announcements must not restart the same request. Another holder
    // is tried only on an explicit refresh/reconnect after a failed request.
    if (
      this.incoming?.metadata.gameId === metadata.gameId &&
      this.incoming.metadata.sourceSha256 === metadata.sourceSha256
    )
      return;
    this.generation++;
    if (this.incoming)
      this.cancelTransfer(
        this.incoming.metadata.gameId,
        this.incoming.metadata.sourceSha256,
        "selection_changed",
      );
    if (
      this.currentGameId !== metadata.gameId ||
      this.sources.get(metadata.gameId)?.metadata.sourceSha256 !== metadata.sourceSha256
    )
      this.offered.clear();
    const generation = this.generation;
    const compatible = await this.compatibilityCheck(metadata);
    if (
      this.disposed ||
      generation !== this.generation ||
      !this.isMember(message.senderMemberId, message.senderConnectionId)
    )
      return;
    this.emit({ type: "metadata", metadata, fromMemberId: message.senderMemberId });
    if (!compatible.compatible) {
      this.emit({
        type: "incompatible",
        memberId: message.senderMemberId,
        gameId: metadata.gameId,
        reason: compatible.reason ?? "Incompatible game.",
      });
      return;
    }
    const cached = this.sources.get(metadata.gameId);
    if (
      cached?.metadata.sourceSha256 === metadata.sourceSha256 &&
      cached.bytes.byteLength === metadata.sourceSizeBytes
    ) {
      this.cache({ ...cached, metadata });
      this.currentGameId = metadata.gameId;
      await this.accept(metadata, message.senderConnectionId);
      return;
    }
    const transfer: ReceiveTransfer = {
      metadata,
      memberId: message.senderMemberId,
      connectionId: message.senderConnectionId,
      controller: new AbortController(),
    };
    this.incoming = transfer;
    this.emit({
      type: "transferStart",
      direction: "receive",
      memberId: transfer.memberId,
      ...identity(metadata),
    });
    try {
      const payload = await this.transport.request({
        channel: GAME_SOURCE_CHANNEL,
        payload: identity(metadata),
        targetConnectionId: transfer.connectionId,
        timeoutMs: 120_000,
        maxResponseBytes: metadata.sourceSizeBytes,
        signal: transfer.controller.signal,
        onProgress: (fraction) => {
          if (this.incoming !== transfer) return;
          const bounded = Math.min(1, Math.max(0, fraction));
          this.emit({
            type: "progress",
            progress: {
              direction: "receive",
              memberId: transfer.memberId,
              ...identity(metadata),
              bytesTransferred: Math.floor(bounded * metadata.sourceSizeBytes),
              totalBytes: metadata.sourceSizeBytes,
              fraction: bounded,
            },
          });
        },
      });
      if (this.incoming !== transfer || transfer.controller.signal.aborted || this.disposed) return;
      if (
        !(payload instanceof Uint8Array) ||
        payload.byteLength !== metadata.sourceSizeBytes ||
        payload.byteLength > htmlSourceBytes
      )
        throw new GameSourceError(
          "hash_mismatch",
          "Source byte count does not match the announcement.",
        );
      let source: string;
      try {
        source = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(payload);
      } catch {
        throw new GameSourceError("hash_mismatch", "Source is not valid UTF-8.");
      }
      if ((await hashSource(source)) !== metadata.sourceSha256)
        throw new GameSourceError(
          "hash_mismatch",
          "Source SHA-256 does not match the announcement.",
        );
      if (this.incoming !== transfer || transfer.controller.signal.aborted || this.disposed) return;
      this.cache({ metadata, source, bytes: payload });
      this.currentGameId = metadata.gameId;
      this.emit({
        type: "received",
        fromMemberId: transfer.memberId,
        ...identity(metadata),
        source,
      });
      this.emit({
        type: "complete",
        direction: "receive",
        memberId: transfer.memberId,
        ...identity(metadata),
      });
      await this.accept(metadata, transfer.connectionId);
      if (this.incoming === transfer) this.incoming = null;
    } catch (error) {
      if (this.incoming !== transfer || transfer.controller.signal.aborted || this.disposed) return;
      this.incoming = null;
      if (error instanceof GameSourceError && error.code === "hash_mismatch")
        this.emit({
          type: "verificationFailed",
          memberId: transfer.memberId,
          ...identity(metadata),
          errorMessage: error.message,
        });
      this.emitError(error);
    }
  }
  private metadata(value: GameSourceMetadataInfo): GameSourceMetadataInfo {
    const parsed = gameSourceMetadataMessageSchema.parse({
      ...this.base(),
      ...value,
      type: "game.source.metadata",
    });
    return {
      gameId: parsed.gameId,
      sourceSha256: parsed.sourceSha256,
      sourceSizeBytes: parsed.sourceSizeBytes,
      ...(parsed.title !== undefined ? { title: parsed.title } : {}),
      ...(parsed.apiVersion !== undefined ? { apiVersion: parsed.apiVersion } : {}),
      ...(parsed.mode !== undefined ? { mode: parsed.mode } : {}),
    };
  }
  private cache(source: RegisteredSource): void {
    this.sources.delete(source.metadata.gameId);
    this.sources.set(source.metadata.gameId, source);
    while (this.sources.size > MAX_CACHED_SOURCES)
      this.sources.delete(this.sources.keys().next().value!);
  }
  private async announce(connectionId?: ConnectionId): Promise<void> {
    if (
      this.disposed ||
      this.currentGameId === null ||
      this.transport.connectionState !== "connected"
    )
      return;
    const source = this.sources.get(this.currentGameId);
    if (!source) return;
    for (const peer of this.transport.peers)
      if (connectionId === undefined || peer.connectionId === connectionId)
        this.offered.set(peer.connectionId, source.metadata);
    await this.send(
      gameSourceMetadataMessageSchema.parse({
        ...this.base(),
        ...source.metadata,
        type: "game.source.metadata",
      }),
      connectionId,
    );
  }
  private async accept(
    metadata: GameSourceMetadataInfo,
    connectionId: ConnectionId,
  ): Promise<void> {
    await this.send(
      gameSourceAcceptedMessageSchema.parse({
        ...this.base(),
        type: "game.source.accepted",
        ...identity(metadata),
      }),
      connectionId,
    );
  }
  private base() {
    return {
      version: PROTOCOL_VERSION,
      sessionId: this.transport.sessionId,
      senderMemberId: this.transport.selfMemberId,
      senderConnectionId: this.transport.selfConnectionId,
      messageId: newMessageId(),
      sentAt: nowSentAt(),
    };
  }
  private async send(payload: PeerMessage, targetConnectionId?: ConnectionId): Promise<void> {
    await this.transport.send({
      channel: GAME_SOURCE_CHANNEL,
      payload,
      ...(targetConnectionId !== undefined ? { targetConnectionId } : {}),
    });
  }
  private isMember(memberId: MemberId, connectionId: ConnectionId): boolean {
    return this.transport.peers.some(
      (peer) => peer.memberId === memberId && peer.connectionId === connectionId,
    );
  }
  private emit(event: GameSourceTransferEvent): void {
    if (!this.disposed) for (const listener of this.listeners) listener(event);
  }
  private emitError(error: unknown): void {
    this.emit({
      type: "error",
      error:
        error instanceof GameSourceError
          ? error
          : new GameSourceError(
              "transfer_failed",
              error instanceof Error ? error.message : "Source transfer failed.",
              { cause: error },
            ),
    });
  }
  private assertAlive(): void {
    if (this.disposed)
      throw new GameSourceError("invalid_state", "Source coordinator is disposed.");
  }
}
function identity(metadata: GameSourceMetadataInfo) {
  return { gameId: metadata.gameId, sourceSha256: metadata.sourceSha256 };
}
export function defaultGameSourceCompatibilityCheck(
  metadata: GameSourceMetadataInfo,
  supportedApiVersions: readonly number[],
): GameSourceCompatibility {
  return metadata.apiVersion === undefined || supportedApiVersions.includes(metadata.apiVersion)
    ? { compatible: true }
    : {
        compatible: false,
        reason: `Game targets Nova API version ${metadata.apiVersion}; this build supports [${supportedApiVersions.join(", ")}].`,
      };
}
export async function hashSource(source: string): Promise<Sha256> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(source));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
export function utf8ByteLength(source: string): number {
  return new TextEncoder().encode(source).byteLength;
}
