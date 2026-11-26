import type { NovaTransport, TransportRequestHandler } from "@rocketcrab/core";
import {
  actionTimeoutMs,
  gameFileBytes,
  gameFileRefSchema,
  gameFilesMax,
  gameFilesTotalBytes,
  gameFileTimeoutMs,
  gameFileTypeSchema,
} from "@rocketcrab/protocol";
import { z } from "zod";
import type { NovaClientBackend } from "./client";
import { NovaError, toErrorCode } from "./errors";
import { GameByteBudget } from "./game-byte-budget";

const downloadChannel = "nova.file.get";
const offerChannel = "nova.file.offer";
const uploadChannel = "nova.file.upload";
const peerTimeoutMs = 10_000;
const maxMimeBytes = 127;
const refRequest = z.object({ gameId: z.string(), ref: gameFileRefSchema });
const offerRequest = refRequest.extend({ size: z.number().int().min(0).max(gameFileBytes) });
const offerReply = z.union([
  z.object({ mimeType: gameFileTypeSchema }),
  z.object({ code: z.string().max(64), message: z.string().max(256) }),
]);

type FileData = { bytes: ArrayBuffer; mimeType: string };
type StoredFile = FileData & { expiry?: ReturnType<typeof setTimeout> };
type RequestContext = Parameters<TransportRequestHandler>[1];

function unavailable() {
  return new NovaError(
    "file_unavailable",
    "The shared file is unavailable. Check your connection and ask the other players to update Nova.",
  );
}

function storageFull() {
  return new NovaError("file_storage_full", "This game has reached its shared file limit.");
}

export function recordGameFileRef(value: unknown, refs: Set<string>): void {
  if (refs.size > gameFilesMax || typeof value !== "string") return;
  if (value.startsWith("nova-file:") && gameFileRefSchema.safeParse(value).success) refs.add(value);
}

export function referencedGameFiles(state: unknown): Set<string> {
  const refs = new Set<string>();
  const pending = [state];
  while (pending.length > 0 && refs.size <= gameFilesMax) {
    const value = pending.pop();
    if (value !== null && typeof value === "object") {
      for (const child of Object.values(value)) pending.push(child);
    } else {
      recordGameFileRef(value, refs);
    }
  }
  return refs;
}

async function hashRef(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0"));
  return "nova-file:" + hex.join("");
}

// Trystero owns binary chunking and admission. The first byte is the MIME
// length, followed by the MIME string and the content-addressed file bytes.
function encodeFile(file: FileData): Uint8Array {
  const mime = new TextEncoder().encode(file.mimeType);
  const wire = new Uint8Array(1 + mime.length + file.bytes.byteLength);
  wire[0] = mime.length;
  wire.set(mime, 1);
  wire.set(new Uint8Array(file.bytes), 1 + mime.length);
  return wire;
}

async function verifyFile(payload: unknown, ref: string, expectedSize?: number): Promise<FileData> {
  if (!(payload instanceof Uint8Array) || payload.length === 0) throw unavailable();
  const mimeLength = payload[0]!;
  const offset = mimeLength + 1;
  const size = payload.length - offset;
  const mimeType = new TextDecoder().decode(payload.subarray(1, offset));
  if (
    mimeLength > maxMimeBytes ||
    size < 0 ||
    size > gameFileBytes ||
    (expectedSize !== undefined && size !== expectedSize) ||
    !gameFileTypeSchema.safeParse(mimeType).success
  )
    throw unavailable();
  const bytes = payload.slice(offset).buffer as ArrayBuffer;
  if ((await hashRef(bytes)) !== ref)
    throw new NovaError("file_unavailable", "The shared file failed its SHA-256 check.");
  return { bytes, mimeType };
}

/** One bounded file cache for the lifetime of a game session. */
export class GameFiles implements NonNullable<NovaClientBackend["files"]> {
  private readonly entries = new Map<string, StoredFile>();
  private readonly uploadBudgets = new Map<string, GameByteBudget>();
  private readonly reservations = new Map<string, number>();
  private readonly listeners = new Set<() => void>();
  private readonly stop = new AbortController();
  private readonly unsubscribers: (() => void)[] = [];
  private refs = new Set<string>();
  private readonly failed = new Set<string>();
  private peerGeneration = 0;
  private downloading: { ref: string; controller: AbortController } | undefined;
  private outgoing: { ref: string; target: string; file: FileData } | undefined;
  private putting = false;

  constructor(
    private readonly transport: NovaTransport,
    private readonly gameId: string,
    private readonly authority: () => string | null,
    private readonly chargeUpload: (bytes: number) => void,
  ) {}

  attach(): void {
    if (this.stop.signal.aborted || this.unsubscribers.length > 0) return;
    this.unsubscribers.push(
      this.transport.handleRequest(downloadChannel, (payload, context) => {
        const ref = this.readRef(payload, context);
        const file = this.entries.get(ref);
        if (!file || !this.refs.has(ref)) throw unavailable();
        return encodeFile(file);
      }),
      this.transport.handleRequest(uploadChannel, (payload, context) => {
        const ref = this.readRef(payload, context);
        const outgoing = this.outgoing;
        if (outgoing?.ref !== ref || outgoing.target !== context.senderConnectionId)
          throw unavailable();
        return encodeFile(outgoing.file);
      }),
      this.transport.handleRequest(offerChannel, (payload, context) =>
        this.acceptUpload(payload, context),
      ),
      this.transport.on("peer:joined", () => this.retryDownloads()),
      this.transport.on("peer:left", ({ connectionId }) => this.uploadBudgets.delete(connectionId)),
      this.transport.on("connection:state", (state) => {
        if (state === "connected") this.retryDownloads();
      }),
    );
  }

  async put(input: FileData): Promise<string> {
    this.assertOpen();
    if (this.putting)
      throw new NovaError("rate_limited", "Wait for the current shared file upload to finish.");
    this.putting = true;
    try {
      let file = input;
      const authority = this.authority();
      if (authority === null)
        throw new NovaError("no_authority", "Shared files need a connected game authority.");
      this.chargeUpload(file.bytes.byteLength);
      const ref = await hashRef(file.bytes);
      this.assertOpen();
      if (authority !== this.authority()) throw unavailable();
      if (authority !== this.transport.selfMemberId) {
        const peer = this.transport.peers.find((peer) => peer.memberId === authority);
        if (!peer) throw unavailable();
        this.outgoing = { ref, target: peer.connectionId, file };
        const raw = await this.transport
          .request({
            channel: offerChannel,
            payload: { gameId: this.gameId, ref, size: file.bytes.byteLength },
            targetConnectionId: peer.connectionId,
            timeoutMs: gameFileTimeoutMs,
            maxResponseBytes: 512,
            signal: this.stop.signal,
          })
          .catch(() => {
            throw unavailable();
          });
        const result = offerReply.safeParse(raw);
        if (!result.success) throw unavailable();
        if ("code" in result.data)
          throw new NovaError(toErrorCode(result.data.code), result.data.message);
        file = { ...file, mimeType: result.data.mimeType };
        if (authority !== this.authority()) throw unavailable();
      }
      this.assertOpen();
      if (this.fits(ref, file.bytes.byteLength)) this.remember(ref, file);
      else if (authority === this.transport.selfMemberId) throw storageFull();
      return ref;
    } finally {
      this.outgoing = undefined;
      this.putting = false;
    }
  }

  async get(ref: string): Promise<FileData> {
    this.assertOpen();
    if (this.listeners.size >= gameFilesMax)
      throw new NovaError("rate_limited", "Too many shared file requests are pending.");
    const signal = AbortSignal.any([this.stop.signal, AbortSignal.timeout(gameFileTimeoutMs)]);
    let wasReferenced = this.refs.has(ref);
    if (this.failed.delete(ref)) this.fetchNext();
    while (!signal.aborted) {
      const file = this.entries.get(ref);
      // Keep the verified cache buffer owned by the shell when the caller transfers its copy.
      if (file) return { bytes: file.bytes.slice(0), mimeType: file.mimeType };
      if (this.failed.has(ref) || (wasReferenced && !this.refs.has(ref))) break;
      wasReferenced ||= this.refs.has(ref);
      await this.waitForChange(signal);
    }
    this.assertOpen();
    throw unavailable();
  }

  /** Recheck after the state hash completes, immediately before committing. */
  canCommit(refs: ReadonlySet<string>): boolean {
    return refs.size <= gameFilesMax && [...refs].every((ref) => this.entries.has(ref));
  }

  updateRefs(refs: Set<string>): void {
    if (this.stop.signal.aborted) return;
    // A mixed-build authority can publish state without knowing the file protocol.
    if (refs.size > gameFilesMax) refs.clear();
    if (refs.size === this.refs.size && [...refs].every((ref) => this.refs.has(ref))) return;
    const previous = this.refs;
    this.refs = refs;
    for (const ref of previous) if (!refs.has(ref)) this.drop(ref);
    for (const ref of refs) this.keepReferenced(ref);
    if (this.downloading && !refs.has(this.downloading.ref)) this.downloading.controller.abort();
    for (const ref of this.failed) if (!refs.has(ref)) this.failed.delete(ref);
    this.notifyChange();
    this.fetchNext();
  }

  retryDownloads(): void {
    this.peerGeneration++;
    this.failed.clear();
    this.fetchNext();
  }

  dispose(): void {
    this.stop.abort();
    this.downloading?.controller.abort();
    for (const unsubscribe of this.unsubscribers.splice(0)) unsubscribe();
    for (const ref of this.entries.keys()) this.drop(ref);
    this.refs.clear();
    this.failed.clear();
    this.uploadBudgets.clear();
    this.reservations.clear();
    this.outgoing = undefined;
  }

  private assertOpen(): void {
    if (this.stop.signal.aborted) throw new NovaError("ended", "This game session has ended.");
  }

  private readRef(payload: unknown, context: RequestContext): string {
    const request = refRequest.safeParse(payload);
    if (
      this.stop.signal.aborted ||
      context.signal.aborted ||
      !request.success ||
      request.data.gameId !== this.gameId ||
      !this.transport.peers.some((peer) => peer.connectionId === context.senderConnectionId)
    )
      throw unavailable();
    return request.data.ref;
  }

  private async acceptUpload(payload: unknown, context: RequestContext) {
    const sender = context.senderConnectionId;
    try {
      const ref = this.readRef(payload, context);
      const { size } = offerRequest.parse(payload);
      if (this.authority() !== this.transport.selfMemberId) throw unavailable();
      const cached = this.entries.get(ref);
      if (cached !== undefined) {
        this.keepPending(ref);
        return { mimeType: cached.mimeType };
      }
      if (this.reservations.has(sender))
        throw new NovaError("rate_limited", "A shared file upload is already pending.");
      if (!this.fits(ref, size)) throw storageFull();
      const budget = this.uploadBudgets.get(sender) ?? new GameByteBudget();
      this.uploadBudgets.set(sender, budget);
      // Charge at the receiver as well, before accepting any binary data.
      budget.consume(size, () => {});
      this.reservations.set(sender, size);
      try {
        const data = await this.transport.request({
          channel: uploadChannel,
          payload: { gameId: this.gameId, ref },
          targetConnectionId: sender,
          timeoutMs: gameFileTimeoutMs,
          maxResponseBytes: size + 1 + maxMimeBytes,
          signal: AbortSignal.any([context.signal, this.stop.signal]),
        });
        const file = await verifyFile(data, ref, size);
        this.readRef(payload, context);
        if (this.authority() !== this.transport.selfMemberId) throw unavailable();
        this.reservations.delete(sender);
        if (!this.fits(ref, size)) throw storageFull();
        this.remember(ref, file);
        return { mimeType: this.entries.get(ref)!.mimeType };
      } finally {
        this.reservations.delete(sender);
      }
    } catch (cause) {
      const error = cause instanceof NovaError ? cause : unavailable();
      return { code: error.code, message: error.message };
    }
  }

  private fits(ref: string, size: number): boolean {
    if (this.entries.has(ref)) return true;
    const count = this.entries.size + this.reservations.size;
    let bytes = size;
    for (const file of this.entries.values()) bytes += file.bytes.byteLength;
    for (const reserved of this.reservations.values()) bytes += reserved;
    return count < gameFilesMax && bytes <= gameFilesTotalBytes;
  }

  private remember(ref: string, file: FileData): void {
    if (!this.entries.has(ref)) this.entries.set(ref, { ...file });
    this.keepPending(ref);
    this.notifyChange();
  }

  private keepPending(ref: string): void {
    if (this.refs.has(ref)) return;
    const file = this.entries.get(ref)!;
    if (file.expiry !== undefined) clearTimeout(file.expiry);
    file.expiry = setTimeout(() => this.drop(ref), actionTimeoutMs);
  }

  private keepReferenced(ref: string): void {
    const file = this.entries.get(ref);
    if (file?.expiry === undefined) return;
    clearTimeout(file.expiry);
    delete file.expiry;
  }

  private drop(ref: string): void {
    this.keepReferenced(ref);
    this.entries.delete(ref);
  }

  private fetchNext(): void {
    if (this.stop.signal.aborted || this.downloading) return;
    const ref = [...this.refs].find((ref) => !this.entries.has(ref) && !this.failed.has(ref));
    if (ref === undefined) return;
    const controller = new AbortController();
    const generation = this.peerGeneration;
    this.downloading = { ref, controller };
    void this.fetch(
      ref,
      AbortSignal.any([controller.signal, AbortSignal.timeout(gameFileTimeoutMs)]),
    ).finally(() => {
      this.downloading = undefined;
      if (
        !controller.signal.aborted &&
        generation === this.peerGeneration &&
        !this.entries.has(ref)
      )
        this.failed.add(ref);
      this.notifyChange();
      this.fetchNext();
    });
  }

  private async fetch(ref: string, signal: AbortSignal): Promise<void> {
    const authority = this.authority();
    const peers = [...this.transport.peers].sort(
      (a, b) => Number(b.memberId === authority) - Number(a.memberId === authority),
    );
    for (const peer of peers) {
      if (signal.aborted) return;
      try {
        const data = await this.transport.request({
          channel: downloadChannel,
          payload: { gameId: this.gameId, ref },
          targetConnectionId: peer.connectionId,
          timeoutMs: peerTimeoutMs,
          maxResponseBytes: 1 + maxMimeBytes + gameFileBytes,
          signal,
        });
        const file = await verifyFile(data, ref);
        if (signal.aborted) return;
        // Committed files take priority over temporary copies kept by the uploader.
        for (const [pending, entry] of this.entries) {
          if (this.fits(ref, file.bytes.byteLength)) break;
          if (entry.expiry !== undefined) this.drop(pending);
        }
        if (this.fits(ref, file.bytes.byteLength)) this.remember(ref, file);
        return;
      } catch {
        // A disconnected, older or corrupt peer can be skipped.
      }
    }
  }

  private notifyChange(): void {
    for (const changed of this.listeners) changed();
  }

  private waitForChange(signal: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
      const done = () => {
        this.listeners.delete(done);
        signal.removeEventListener("abort", done);
        resolve();
      };
      this.listeners.add(done);
      signal.addEventListener("abort", done, { once: true });
    });
  }
}
