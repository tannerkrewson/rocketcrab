import type {
  NovaTransport,
  TransportRequestHandler,
  TransportRequestOptions,
} from "@rocketcrab/core";
import {
  actionTimeoutMs,
  authorityGracePeriodMs,
  gameFileRefSchema,
  gameFilesTotalBytes,
  gameFileTypeSchema,
  requestPayloadBytes,
  transferTimeoutMs,
} from "@rocketcrab/protocol";
import { z } from "zod";
import type { NovaClientBackend } from "./client";
import { NovaError, toErrorCode } from "./errors";
import { GameByteBudget } from "./game-byte-budget";

/** One file, for a read the game is waiting on (also what older builds use). */
const downloadChannel = "nova.file.get";
/** Batches of files, for background replication. Older builds don't answer it. */
const syncChannel = "nova.file.sync";
const offerChannel = "nova.file.offer";
const uploadChannel = "nova.file.upload";
const maxMimeBytes = 127;
/** A transfer with no progress for this long has stalled; try another peer. */
const stallMs = authorityGracePeriodMs;
/** Room left in a sync request for the transport's envelope. */
const syncRequestBytes = requestPayloadBytes - 1024;
const requestBase = z.object({ gameId: z.string() });
const refRequest = requestBase.extend({ ref: gameFileRefSchema });
const syncRequest = requestBase.extend({ refs: z.array(gameFileRefSchema) });
const offerRequest = refRequest.extend({
  size: z.number().int().min(0).max(gameFilesTotalBytes),
});
const offerReply = z.union([
  z.object({ mimeType: gameFileTypeSchema }),
  z.object({ code: z.string().max(64), message: z.string().max(256) }),
]);

type FileData = { bytes: ArrayBuffer; mimeType: string };
type StoredFile = FileData & { expiry?: ReturnType<typeof setTimeout> };
type FileRead = { ref: string; signal: AbortSignal; changed?: () => void };
type RequestContext = Parameters<TransportRequestHandler>[1];
type Transfer = { refs: ReadonlySet<string>; controller: AbortController };

function unavailable() {
  return new NovaError(
    "file_unavailable",
    "The shared file is unavailable. Check your connection and ask the other players to update Nova.",
  );
}

function storageFull() {
  return new NovaError(
    "file_storage_full",
    `This game has reached its ${gameFilesTotalBytes / 1024 / 1024} MiB shared file limit.`,
  );
}

/** Bytes a file counts against the session total: its batch header and contents. */
function fileCost(size: number, mimeType: string): number {
  return 32 + 1 + mimeType.length + 4 + size;
}

export function recordGameFileRef(value: unknown, refs: Set<string>): void {
  if (typeof value !== "string") return;
  if (value.startsWith("nova-file:") && gameFileRefSchema.safeParse(value).success) refs.add(value);
}

export function referencedGameFiles(state: unknown): Set<string> {
  const refs = new Set<string>();
  const pending = [state];
  while (pending.length > 0) {
    const value = pending.pop();
    if (value !== null && typeof value === "object") {
      for (const child of Object.values(value)) pending.push(child);
    } else {
      recordGameFileRef(value, refs);
    }
  }
  return refs;
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function hashRef(bytes: ArrayBuffer): Promise<string> {
  return "nova-file:" + toHex(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)));
}

function shuffled<T>(items: readonly T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
}

// Trystero owns binary chunking and admission. A single file is the MIME
// length, the MIME string and the content-addressed bytes.
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
    size > gameFilesTotalBytes ||
    (expectedSize !== undefined && size !== expectedSize) ||
    !gameFileTypeSchema.safeParse(mimeType).success
  )
    throw unavailable();
  const bytes = payload.slice(offset).buffer as ArrayBuffer;
  if ((await hashRef(bytes)) !== ref)
    throw new NovaError("file_unavailable", "The shared file failed its SHA-256 check.");
  return { bytes, mimeType };
}

// A batch repeats: SHA-256 (32 bytes), MIME length, MIME, byte length (u32), bytes.
function encodeBatch(files: ReadonlyMap<string, FileData>): Uint8Array {
  let size = 0;
  for (const file of files.values()) size += fileCost(file.bytes.byteLength, file.mimeType);
  const wire = new Uint8Array(size);
  const view = new DataView(wire.buffer);
  let offset = 0;
  for (const [ref, file] of files) {
    const hex = ref.slice("nova-file:".length);
    for (let i = 0; i < 32; i++) wire[offset + i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    const mime = new TextEncoder().encode(file.mimeType);
    wire[offset + 32] = mime.length;
    wire.set(mime, offset + 33);
    offset += 33 + mime.length;
    view.setUint32(offset, file.bytes.byteLength);
    wire.set(new Uint8Array(file.bytes), offset + 4);
    offset += 4 + file.bytes.byteLength;
  }
  return wire;
}

/** The verified files of a batch that were asked for. Throws on a malformed batch. */
async function readBatch(
  payload: unknown,
  wanted: ReadonlySet<string>,
): Promise<Map<string, FileData>> {
  if (!(payload instanceof Uint8Array)) throw unavailable();
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  const files = new Map<string, FileData>();
  let offset = 0;
  while (offset < payload.length) {
    if (offset + 33 > payload.length) throw unavailable();
    const ref = "nova-file:" + toHex(payload.subarray(offset, offset + 32));
    const mimeLength = payload[offset + 32]!;
    const mimeEnd = offset + 33 + mimeLength;
    if (mimeLength > maxMimeBytes || mimeEnd + 4 > payload.length) throw unavailable();
    const mimeType = new TextDecoder().decode(payload.subarray(offset + 33, mimeEnd));
    const size = view.getUint32(mimeEnd);
    offset = mimeEnd + 4 + size;
    if (offset > payload.length || !gameFileTypeSchema.safeParse(mimeType).success)
      throw unavailable();
    if (!wanted.has(ref)) continue;
    const bytes = payload.slice(mimeEnd + 4, offset).buffer as ArrayBuffer;
    if ((await hashRef(bytes)) !== ref) throw unavailable();
    files.set(ref, { bytes, mimeType });
  }
  return files;
}

/**
 * The session's shared files. The canonical state decides which files exist:
 * every device keeps the files it references, replicating them in batches in
 * the background, and fetches one directly when the game waits on it.
 */
export class GameFiles implements NonNullable<NovaClientBackend["files"]> {
  private readonly entries = new Map<string, StoredFile>();
  private readonly uploadBudget = new GameByteBudget();
  private readonly senderBudgets = new Map<string, GameByteBudget>();
  private readonly reservations = new Map<string, number>();
  private readonly reads = new Set<FileRead>();
  private readonly stop = new AbortController();
  private readonly unsubscribers: (() => void)[] = [];
  private refs = new Set<string>();
  /** Refs a direct fetch couldn't get from any peer, until peers change. */
  private readonly failed = new Set<string>();
  /** Refs no peer returned in a batch, until peers change. */
  private readonly unsynced = new Set<string>();
  private peerGeneration = 0;
  private reading: Transfer | undefined;
  private syncing: Transfer | undefined;
  private outgoing: { ref: string; target: string; file: FileData } | undefined;
  /** Uploads run one at a time: the transport allows one request per peer and channel. */
  private uploads: Promise<unknown> = Promise.resolve();
  private queuedBytes = 0;

  constructor(
    private readonly transport: NovaTransport,
    private readonly gameId: string,
    private readonly authority: () => string | null,
  ) {}

  attach(): void {
    if (this.stop.signal.aborted || this.unsubscribers.length > 0) return;
    this.unsubscribers.push(
      this.transport.handleRequest(downloadChannel, (payload, context) => {
        const { ref } = this.readRequest(refRequest, payload, context);
        const file = this.entries.get(ref);
        if (!file || !this.refs.has(ref)) throw unavailable();
        return encodeFile(file);
      }),
      this.transport.handleRequest(syncChannel, (payload, context) => {
        const { refs } = this.readRequest(syncRequest, payload, context);
        const held = new Map<string, FileData>();
        for (const ref of refs) {
          const file = this.entries.get(ref);
          if (file && this.refs.has(ref)) held.set(ref, file);
        }
        return encodeBatch(held);
      }),
      this.transport.handleRequest(uploadChannel, (payload, context) => {
        const { ref } = this.readRequest(refRequest, payload, context);
        const outgoing = this.outgoing;
        if (outgoing?.ref !== ref || outgoing.target !== context.senderConnectionId)
          throw unavailable();
        return encodeFile(outgoing.file);
      }),
      this.transport.handleRequest(offerChannel, (payload, context) =>
        this.acceptUpload(payload, context),
      ),
      this.transport.on("peer:joined", () => this.retryDownloads()),
      this.transport.on("peer:left", ({ connectionId }) => this.senderBudgets.delete(connectionId)),
      this.transport.on("connection:state", (state) => {
        if (state === "connected") this.retryDownloads();
      }),
    );
  }

  put(input: FileData): Promise<string> {
    this.assertOpen();
    const size = input.bytes.byteLength;
    if (this.queuedBytes + size > gameFilesTotalBytes) return Promise.reject(storageFull());
    this.queuedBytes += size;
    // Every file call settles within one transfer timeout, queue included.
    const expires = performance.now() + transferTimeoutMs;
    const upload = this.uploads
      .then(() => this.upload(input, expires))
      .finally(() => {
        this.queuedBytes -= size;
      });
    this.uploads = upload.catch(() => {});
    return upload;
  }

  private async upload(input: FileData, expires: number): Promise<string> {
    const remaining = () => {
      this.assertOpen();
      const ms = expires - performance.now();
      if (ms <= 0) throw unavailable();
      return ms;
    };
    for (let wait = this.uploadBudget.debtMs(); wait > 0; wait = this.uploadBudget.debtMs())
      await this.sleep(Math.min(wait, remaining()));
    let file = input;
    const authority = this.authority();
    if (authority === null)
      throw new NovaError("no_authority", "Shared files need a connected game authority.");
    const ref = await hashRef(file.bytes);
    this.assertOpen();
    if (authority !== this.authority()) throw unavailable();
    if (authority !== this.transport.selfMemberId) {
      const peer = this.transport.peers.find((peer) => peer.memberId === authority);
      if (!peer) throw unavailable();
      this.uploadBudget.borrow(file.bytes.byteLength);
      this.outgoing = { ref, target: peer.connectionId, file };
      try {
        // The authority pulls the bytes before it replies, so no stall check here.
        const raw = await this.transport
          .request({
            channel: offerChannel,
            payload: { gameId: this.gameId, ref, size: file.bytes.byteLength },
            targetConnectionId: peer.connectionId,
            timeoutMs: remaining(),
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
      } finally {
        this.outgoing = undefined;
      }
      if (authority !== this.authority()) throw unavailable();
    }
    this.assertOpen();
    if (this.fits(ref, fileCost(file.bytes.byteLength, file.mimeType))) this.remember(ref, file);
    else if (authority === this.transport.selfMemberId) throw storageFull();
    return ref;
  }

  async get(ref: string): Promise<FileData> {
    this.assertOpen();
    const signal = AbortSignal.any([this.stop.signal, AbortSignal.timeout(transferTimeoutMs)]);
    const read: FileRead = { ref, signal };
    this.reads.add(read);
    try {
      let wasReferenced = this.refs.has(ref);
      this.failed.delete(ref);
      this.pump();
      while (!signal.aborted) {
        const file = this.entries.get(ref);
        // Keep the verified cache buffer owned by the shell when the caller transfers its copy.
        if (file) return { bytes: file.bytes.slice(0), mimeType: file.mimeType };
        if (this.failed.has(ref) || (wasReferenced && !this.refs.has(ref))) break;
        wasReferenced ||= this.refs.has(ref);
        await this.waitForChange(read);
      }
      this.assertOpen();
      throw unavailable();
    } finally {
      this.reads.delete(read);
    }
  }

  /** Recheck after the state hash completes, immediately before committing. */
  canCommit(refs: ReadonlySet<string>): boolean {
    return [...refs].every((ref) => this.entries.has(ref));
  }

  updateRefs(refs: Set<string>): void {
    if (this.stop.signal.aborted) return;
    if (refs.size === this.refs.size && [...refs].every((ref) => this.refs.has(ref))) return;
    const previous = this.refs;
    this.refs = refs;
    for (const ref of previous) if (!refs.has(ref)) this.drop(ref);
    for (const ref of refs) this.keepReferenced(ref);
    if (this.reading && ![...this.reading.refs].some((ref) => refs.has(ref)))
      this.reading.controller.abort();
    for (const set of [this.failed, this.unsynced])
      for (const ref of set) if (!refs.has(ref)) set.delete(ref);
    this.notifyChange();
    this.pump();
  }

  retryDownloads(): void {
    this.peerGeneration++;
    this.failed.clear();
    this.unsynced.clear();
    this.pump();
  }

  dispose(): void {
    this.stop.abort();
    this.reading?.controller.abort();
    this.syncing?.controller.abort();
    for (const unsubscribe of this.unsubscribers.splice(0)) unsubscribe();
    for (const ref of this.entries.keys()) this.drop(ref);
    this.refs.clear();
    this.failed.clear();
    this.unsynced.clear();
    this.senderBudgets.clear();
    this.reservations.clear();
    this.outgoing = undefined;
  }

  private assertOpen(): void {
    if (this.stop.signal.aborted) throw new NovaError("ended", "This game session has ended.");
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, ms);
      this.stop.signal.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          reject(new NovaError("ended", "This game session has ended."));
        },
        { once: true },
      );
    });
  }

  private readRequest<T extends z.ZodType<{ gameId: string }>>(
    schema: T,
    payload: unknown,
    context: RequestContext,
  ): z.infer<T> {
    const request = schema.safeParse(payload);
    if (
      this.stop.signal.aborted ||
      context.signal.aborted ||
      !request.success ||
      request.data.gameId !== this.gameId ||
      !this.transport.peers.some((peer) => peer.connectionId === context.senderConnectionId)
    )
      throw unavailable();
    return request.data;
  }

  private async acceptUpload(payload: unknown, context: RequestContext) {
    const sender = context.senderConnectionId;
    try {
      const { ref, size } = this.readRequest(offerRequest, payload, context);
      if (this.authority() !== this.transport.selfMemberId) throw unavailable();
      const cached = this.entries.get(ref);
      if (cached !== undefined) {
        this.keepPending(ref);
        return { mimeType: cached.mimeType };
      }
      if (this.reservations.has(sender))
        throw new NovaError("rate_limited", "A shared file upload is already pending.");
      const cost = fileCost(size, "x".repeat(maxMimeBytes));
      if (!this.fits(ref, cost)) throw storageFull();
      const budget = this.senderBudgets.get(sender) ?? new GameByteBudget();
      this.senderBudgets.set(sender, budget);
      // Charge at the receiver as well, before accepting any binary data.
      if (budget.debtMs() > 0)
        throw new NovaError("rate_limited", "Shared file uploads are arriving too quickly.");
      budget.borrow(size);
      this.reservations.set(sender, cost);
      try {
        const data = await this.transfer({
          channel: uploadChannel,
          payload: { gameId: this.gameId, ref },
          targetConnectionId: sender,
          maxResponseBytes: size + 1 + maxMimeBytes,
          signal: AbortSignal.any([context.signal, this.stop.signal]),
        });
        const file = await verifyFile(data, ref, size);
        this.readRequest(refRequest, payload, context);
        if (this.authority() !== this.transport.selfMemberId) throw unavailable();
        this.reservations.delete(sender);
        if (!this.fits(ref, fileCost(size, file.mimeType))) throw storageFull();
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

  /** A request that is abandoned once its reply stops making progress. */
  private async transfer(
    options: Omit<TransportRequestOptions, "timeoutMs" | "onProgress" | "signal"> & {
      signal: AbortSignal;
    },
  ): Promise<unknown> {
    const stalled = new AbortController();
    let timer = setTimeout(() => stalled.abort(), stallMs);
    try {
      return await this.transport.request({
        ...options,
        timeoutMs: transferTimeoutMs,
        signal: AbortSignal.any([options.signal, stalled.signal]),
        onProgress: () => {
          clearTimeout(timer);
          timer = setTimeout(() => stalled.abort(), stallMs);
        },
      });
    } finally {
      clearTimeout(timer);
    }
  }

  private heldBytes(): number {
    let bytes = 0;
    for (const file of this.entries.values())
      bytes += fileCost(file.bytes.byteLength, file.mimeType);
    for (const reserved of this.reservations.values()) bytes += reserved;
    return bytes;
  }

  private fits(ref: string, cost: number): boolean {
    return this.entries.has(ref) || this.heldBytes() + cost <= gameFilesTotalBytes;
  }

  /** Store a fetched file, dropping this device's own unreferenced uploads to make room. */
  private keep(ref: string, file: FileData): void {
    if (!this.refs.has(ref)) return;
    const cost = fileCost(file.bytes.byteLength, file.mimeType);
    for (const [pending, entry] of this.entries) {
      if (this.fits(ref, cost)) break;
      if (entry.expiry !== undefined) this.drop(pending);
    }
    if (this.fits(ref, cost)) this.remember(ref, file);
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

  private missing(ref: string): boolean {
    return this.refs.has(ref) && !this.entries.has(ref);
  }

  private pump(): void {
    if (this.stop.signal.aborted) return;
    this.fetchRead();
    this.sync();
  }

  /** Fetch one file a read waits on, unless a batch already carries it. */
  private fetchRead(): void {
    if (this.reading) return;
    const read = [...this.reads].find(
      ({ ref, signal }) =>
        !signal.aborted &&
        this.missing(ref) &&
        !this.failed.has(ref) &&
        this.syncing?.refs.has(ref) !== true,
    );
    if (read === undefined) return;
    const { ref } = read;
    this.reading = this.run(new Set([ref]), (signal) => this.fetchOne(ref, signal), this.failed);
  }

  /** Replicate missing referenced files in batches, from peers in random order. */
  private sync(): void {
    if (this.syncing) return;
    const refs = new Set<string>();
    let bytes = JSON.stringify({ gameId: this.gameId, refs: [] }).length;
    for (const ref of this.refs) {
      if (!this.missing(ref) || this.unsynced.has(ref) || this.reading?.refs.has(ref)) continue;
      bytes += ref.length + 3;
      if (bytes > syncRequestBytes) break;
      refs.add(ref);
    }
    if (refs.size === 0) return;
    this.syncing = this.run(refs, (signal) => this.fetchBatch(refs, signal), this.unsynced);
  }

  private run(
    refs: ReadonlySet<string>,
    fetch: (signal: AbortSignal) => Promise<void>,
    failures: Set<string>,
  ): Transfer {
    const controller = new AbortController();
    const generation = this.peerGeneration;
    const transfer = { refs, controller };
    void fetch(AbortSignal.any([controller.signal, this.stop.signal])).finally(() => {
      if (this.reading === transfer) this.reading = undefined;
      if (this.syncing === transfer) this.syncing = undefined;
      if (!controller.signal.aborted && generation === this.peerGeneration)
        for (const ref of refs) if (this.missing(ref)) failures.add(ref);
      this.notifyChange();
      this.pump();
    });
    return transfer;
  }

  private async fetchOne(ref: string, signal: AbortSignal): Promise<void> {
    const authority = this.authority();
    const peers = [...this.transport.peers].sort(
      (a, b) => Number(b.memberId === authority) - Number(a.memberId === authority),
    );
    for (const peer of peers) {
      if (signal.aborted || !this.missing(ref)) return;
      try {
        const data = await this.transfer({
          channel: downloadChannel,
          payload: { gameId: this.gameId, ref },
          targetConnectionId: peer.connectionId,
          maxResponseBytes: 1 + maxMimeBytes + gameFilesTotalBytes,
          signal,
        });
        const file = await verifyFile(data, ref);
        if (!signal.aborted) this.keep(ref, file);
      } catch {
        // A disconnected, older or corrupt peer can be skipped.
      }
    }
  }

  private async fetchBatch(refs: ReadonlySet<string>, signal: AbortSignal): Promise<void> {
    for (const peer of shuffled(this.transport.peers)) {
      const wanted = new Set([...refs].filter((ref) => this.missing(ref)));
      if (signal.aborted || wanted.size === 0) return;
      try {
        const data = await this.transfer({
          channel: syncChannel,
          payload: { gameId: this.gameId, refs: [...wanted] },
          targetConnectionId: peer.connectionId,
          maxResponseBytes: gameFilesTotalBytes,
          signal,
        });
        for (const [ref, file] of await readBatch(data, wanted))
          if (!signal.aborted) this.keep(ref, file);
      } catch {
        // A disconnected, older or corrupt peer can be skipped.
      }
    }
  }

  private notifyChange(): void {
    for (const read of this.reads) read.changed?.();
  }

  private waitForChange(read: FileRead): Promise<void> {
    return new Promise((resolve) => {
      const done = () => {
        delete read.changed;
        read.signal.removeEventListener("abort", done);
        resolve();
      };
      read.changed = done;
      read.signal.addEventListener("abort", done, { once: true });
    });
  }
}
