import { describe, expect, it } from "vitest";
import type { TransportMessage } from "@rocketcrab/core";
import {
  PROTOCOL_VERSION,
  gameSourceCancelMessageSchema,
  gameSourceMetadataMessageSchema,
  gameSourceRequestMessageSchema,
  gameSourceTransferMessageSchema,
  htmlSourceBytes,
  htmlSourceWarnBytes,
  parsePeerMessage,
  transferAcknowledgementMessageSchema,
  type GameSourceMetadataMessage,
  type GameSourceTransferMessage,
  type Sha256,
} from "@rocketcrab/protocol";
import { InMemoryTransportHub, type InMemoryTransport } from "@rocketcrab/testing";
import {
  GAME_SOURCE_CHANNEL,
  GameSourceCoordinator,
  chunkStringByUtf8Bytes,
  defaultGameSourceCompatibilityCheck,
  hashSource,
  utf8ByteLength,
  type GameSourceTransferEvent,
} from "./game-source";
import { newMessageId, nowSentAt } from "./messages";
import {
  createParty,
  joinPartyByCode,
  rendezvousRoomName,
  rendezvousSessionId,
  type CreatePartyOptions,
  type JoinByCodeOptions,
  type PartyTransportFactory,
} from "./rendezvous";
import { PARTY_CODE_ALPHABET } from "./code";

/**
 * Deterministic P3 tests for {@link GameSourceCoordinator}: the full transfer
 * lifecycle (metadata announcement → request → binary chunk transfer with
 * progress → SHA-256 verification → acknowledgement), retry on failed or
 * mismatched transfers, cancellation, runtime compatibility, source-size
 * limits, re-transfer after reconnect, in-memory session caching, and
 * listener cleanup. All flows run over the InMemoryTransport hub (U5) with
 * either a real microtask clock (drain + flush) or an injected fake clock
 * (deterministic cancellation/reconnect interleavings) — no network, no
 * real timers in the fake-clock tests, so CI runs are exact.
 */

const PRIVATE_ROOM = "party:test-room";
const PRIVATE_SESSION = "session-test";

// ---------------------------------------------------------------------------
// Fake clock (same pattern as rendezvous.test.ts)
// ---------------------------------------------------------------------------

interface FakeClock {
  now: () => number;
  schedule: (callback: () => void, delayMs: number) => () => void;
  advance: (ms: number) => void;
}

function makeFakeClock(): FakeClock {
  let t = 0;
  let order = 0;
  const timers: Array<{ at: number; order: number; cb: () => void; active: boolean }> = [];
  return {
    now: () => t,
    schedule: (cb, delayMs) => {
      const timer = { at: t + delayMs, order: order++, cb, active: true };
      timers.push(timer);
      return () => {
        timer.active = false;
      };
    },
    advance: (ms: number) => {
      const deadline = t + ms;
      for (;;) {
        const due = timers
          .filter((timer) => timer.active && timer.at <= deadline)
          .sort((a, b) => a.at - b.at || a.order - b.order)[0];
        if (due === undefined) {
          break;
        }
        due.active = false;
        t = Math.max(t, due.at);
        due.cb();
      }
      t = deadline;
    },
  };
}

/** Let real async (crypto derivation, transport joins) make progress. */
async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/** Drain the hub and flush promise chains a few times (deterministic). */
async function settle(world: World): Promise<void> {
  for (let i = 0; i < 8; i += 1) {
    world.hub.drain();
    await flush();
  }
}

// ---------------------------------------------------------------------------
// Worlds: real clock (PERFECT_LINK) and fake clock (latency interleavings)
// ---------------------------------------------------------------------------

interface World {
  clock?: FakeClock;
  hub: InMemoryTransportHub;
}

function makeRealWorld(): World {
  return { hub: new InMemoryTransportHub() };
}

function makeClockWorld(): World {
  const clock = makeFakeClock();
  const hub = new InMemoryTransportHub({ schedule: clock.schedule, now: clock.now });
  return { clock, hub };
}

/** A host + joiner transport joined to the private room. */
async function makeParty(
  world: World,
  options: {
    hostMemberId?: string;
    joinerMemberId?: string;
    hostLatencyMs?: number;
    joinerFaults?: { latencyMs?: number; dropWhileSuspended?: boolean };
  } = {},
): Promise<{ host: InMemoryTransport; joiner: InMemoryTransport }> {
  const host = world.hub.createTransport({
    memberId: options.hostMemberId ?? "host",
    displayName: "Host",
    faults: options.hostLatencyMs === undefined ? undefined : { latencyMs: options.hostLatencyMs },
  });
  const joiner = world.hub.createTransport({
    memberId: options.joinerMemberId ?? "joiner",
    displayName: "Joiner",
    faults: options.joinerFaults,
  });
  await host.join({ room: PRIVATE_ROOM, sessionId: PRIVATE_SESSION });
  await joiner.join({ room: PRIVATE_ROOM, sessionId: PRIVATE_SESSION });
  return { host, joiner };
}

function collect(coordinator: GameSourceCoordinator): GameSourceTransferEvent[] {
  const events: GameSourceTransferEvent[] = [];
  coordinator.subscribe((event) => events.push(event));
  return events;
}

function receivedOf(events: GameSourceTransferEvent[]) {
  return events.filter((event) => event.type === "received");
}

function errorsOf(events: GameSourceTransferEvent[]) {
  return events.filter((event) => event.type === "error");
}

function cancelledOf(events: GameSourceTransferEvent[]) {
  return events.filter((event) => event.type === "cancelled");
}

function progressOf(events: GameSourceTransferEvent[]) {
  return events.filter((event) => event.type === "progress");
}

// ---------------------------------------------------------------------------
// Raw message builders (the tests act as a well-behaved-but-unmanaged peer)
// ---------------------------------------------------------------------------

interface RawBase {
  sessionId: string;
  senderMemberId: string;
  senderConnectionId: string;
}

function rawEnvelope(base: RawBase) {
  return {
    version: PROTOCOL_VERSION,
    sessionId: base.sessionId,
    senderMemberId: base.senderMemberId,
    senderConnectionId: base.senderConnectionId,
    messageId: newMessageId(),
    sentAt: nowSentAt(),
  };
}

function rawMetadata(
  base: RawBase,
  input: {
    gameId: string;
    sourceSha256: Sha256;
    sourceSizeBytes: number;
    chunkCount: number;
    apiVersion?: number;
  },
): GameSourceMetadataMessage {
  return gameSourceMetadataMessageSchema.parse({
    ...rawEnvelope(base),
    type: "game.source.metadata",
    gameId: input.gameId,
    ...(input.apiVersion !== undefined ? { apiVersion: input.apiVersion } : {}),
    sourceSha256: input.sourceSha256,
    sourceSizeBytes: input.sourceSizeBytes,
    chunkCount: input.chunkCount,
  });
}

function rawChunk(
  base: RawBase,
  input: {
    gameId: string;
    sourceSha256: Sha256;
    chunkIndex: number;
    chunkCount: number;
    chunk: string;
  },
): GameSourceTransferMessage {
  return gameSourceTransferMessageSchema.parse({
    ...rawEnvelope(base),
    type: "game.source.chunk",
    gameId: input.gameId,
    sourceSha256: input.sourceSha256,
    chunkIndex: input.chunkIndex,
    chunkCount: input.chunkCount,
    chunk: input.chunk,
  });
}

function encodeChunk(message: GameSourceTransferMessage): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(message));
}

function decodeChunk(payload: unknown): GameSourceTransferMessage | null {
  if (!(payload instanceof Uint8Array)) {
    return null;
  }
  try {
    const parsed = parsePeerMessage(JSON.parse(new TextDecoder().decode(payload)) as unknown);
    return parsed.ok && parsed.value.type === "game.source.chunk" ? parsed.value : null;
  } catch {
    return null;
  }
}

function rawRequest(base: RawBase, input: { gameId: string; sourceSha256: Sha256 }) {
  return gameSourceRequestMessageSchema.parse({
    ...rawEnvelope(base),
    type: "game.source.request",
    gameId: input.gameId,
    sourceSha256: input.sourceSha256,
  });
}

function rawCancel(
  base: RawBase,
  input: { gameId: string; sourceSha256: Sha256; reason?: string },
) {
  return gameSourceCancelMessageSchema.parse({
    ...rawEnvelope(base),
    type: "game.source.cancel",
    gameId: input.gameId,
    sourceSha256: input.sourceSha256,
    ...(input.reason !== undefined ? { reason: input.reason } : {}),
  });
}

function rawAck(
  base: RawBase,
  input: {
    gameId: string;
    sourceSha256: Sha256;
    status: "received" | "failed";
    errorMessage?: string;
  },
) {
  return transferAcknowledgementMessageSchema.parse({
    ...rawEnvelope(base),
    type: "game.source.ack",
    gameId: input.gameId,
    sourceSha256: input.sourceSha256,
    status: input.status,
    ...(input.errorMessage !== undefined ? { errorMessage: input.errorMessage } : {}),
  });
}

/** Capture every message a transport receives on the game-source channel. */
function captureSourceTraffic(transport: InMemoryTransport): TransportMessage[] {
  const messages: TransportMessage[] = [];
  transport.on("message:received", (message) => {
    if (message.channel === GAME_SOURCE_CHANNEL) {
      messages.push(message);
    }
  });
  return messages;
}

const SAMPLE_SOURCE = "<!doctype html><html><body><h1>rocketcrab</h1></body></html>";

// ---------------------------------------------------------------------------
// Chunking and hashing helpers
// ---------------------------------------------------------------------------

describe("source chunking and hashing (P3 primitives)", () => {
  it("chunks within a UTF-8 byte budget without splitting code points", () => {
    expect(chunkStringByUtf8Bytes("", 64)).toEqual([]);
    expect(chunkStringByUtf8Bytes("abc", 64)).toEqual(["abc"]);
    // Multi-byte content straddling the budget boundary: "a" (1) + 🦀 (4) + "b" (1).
    const chunks = chunkStringByUtf8Bytes("a🦀b", 4);
    expect(chunks).toEqual(["a", "🦀", "b"]);
    for (const chunk of chunks) {
      expect(utf8ByteLength(chunk)).toBeLessThanOrEqual(4);
    }
    expect(chunks.join("")).toBe("a🦀b");
  });

  it("re-joins any source byte-identically regardless of chunk boundaries", () => {
    const source = "héllo 🦀 world — 日本語 🎮<script>const s = 'x\\'y';</script>".repeat(50);
    const chunks = chunkStringByUtf8Bytes(source, 7);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join("")).toBe(source);
    expect(utf8ByteLength(chunks.join(""))).toBe(utf8ByteLength(source));
    for (const chunk of chunks) {
      expect(utf8ByteLength(chunk)).toBeLessThanOrEqual(7);
    }
  });

  it("hashes with Web Crypto SHA-256 and counts UTF-8 bytes", async () => {
    expect(await hashSource("hello")).toBe(
      "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    );
    expect(utf8ByteLength("é🦀")).toBe(6);
  });
});

describe("default runtime compatibility check", () => {
  it("accepts games with no declared API version or a supported one", () => {
    expect(
      defaultGameSourceCompatibilityCheck(
        { gameId: "g", sourceSha256: "a".repeat(64), sourceSizeBytes: 1, chunkCount: 1 },
        [1],
      ),
    ).toEqual({ compatible: true });
    expect(
      defaultGameSourceCompatibilityCheck(
        {
          gameId: "g",
          apiVersion: 1,
          sourceSha256: "a".repeat(64),
          sourceSizeBytes: 1,
          chunkCount: 1,
        },
        [1],
      ).compatible,
    ).toBe(true);
  });

  it("rejects an unsupported Nova API version with a clear reason", () => {
    const result = defaultGameSourceCompatibilityCheck(
      {
        gameId: "g",
        apiVersion: 2,
        sourceSha256: "a".repeat(64),
        sourceSizeBytes: 1,
        chunkCount: 1,
      },
      [1],
    );
    expect(result.compatible).toBe(false);
    expect(result.reason).toContain("API version 2");
  });
});

// ---------------------------------------------------------------------------
// Full transfer lifecycle
// ---------------------------------------------------------------------------

describe("full transfer lifecycle (host → joiner)", () => {
  it("announces metadata, transfers binary chunks with progress, verifies, and acknowledges", async () => {
    const world = makeRealWorld();
    const { host: hostTransport, joiner: joinerTransport } = await makeParty(world);
    const hostEvents: GameSourceTransferEvent[] = [];
    const host = new GameSourceCoordinator({
      transport: hostTransport,
      onEvent: (event) => hostEvents.push(event),
    });
    const joiner = new GameSourceCoordinator({ transport: joinerTransport });
    const joinerEvents = collect(joiner);

    const metadata = await host.setSource({
      gameId: "game_1",
      title: "Rocket Rumble",
      apiVersion: 1,
      mode: "state",
      source: SAMPLE_SOURCE,
    });
    expect(metadata.sourceSha256).toBe(await hashSource(SAMPLE_SOURCE));
    expect(metadata.sourceSizeBytes).toBe(utf8ByteLength(SAMPLE_SOURCE));
    expect(metadata.chunkCount).toBeGreaterThan(0);
    await settle(world);

    // The joiner received the byte-identical source and cached it.
    const received = receivedOf(joinerEvents);
    expect(received).toHaveLength(1);
    const receivedEvent = received[0];
    expect(receivedEvent?.type).toBe("received");
    if (receivedEvent?.type !== "received") throw new Error("unreachable");
    expect(receivedEvent.source).toBe(SAMPLE_SOURCE);
    expect(receivedEvent.gameId).toBe("game_1");
    expect(receivedEvent.sourceSha256).toBe(metadata.sourceSha256);
    expect(joiner.getCachedSource("game_1")).toBe(SAMPLE_SOURCE);
    expect(joiner.hasSource("game_1")).toBe(true);

    // The host saw the acknowledgement and marked the transfer complete.
    expect(
      hostEvents.some(
        (event) =>
          event.type === "complete" && event.direction === "send" && event.memberId === "joiner",
      ),
    ).toBe(true);
    // Both sides reported monotonic progress.
    for (const progress of progressOf(joinerEvents)) {
      expect(progress.progress.fraction).toBeGreaterThan(0);
      expect(progress.progress.fraction).toBeLessThanOrEqual(1);
    }
    expect(
      hostEvents.some((event) => event.type === "progress" && event.progress.direction === "send"),
    ).toBe(true);
    expect(
      joinerEvents.some(
        (event) => event.type === "progress" && event.progress.direction === "receive",
      ),
    ).toBe(true);
    expect(
      joinerEvents.some(
        (event) => event.type === "metadata" && event.metadata.title === "Rocket Rumble",
      ),
    ).toBe(true);
  });

  it("transfers chunks as binary transport payloads", async () => {
    const world = makeRealWorld();
    const { host: hostTransport, joiner: joinerTransport } = await makeParty(world);
    const traffic = captureSourceTraffic(joinerTransport);
    const host = new GameSourceCoordinator({ transport: hostTransport });
    const joiner = new GameSourceCoordinator({ transport: joinerTransport });
    const joinerEvents = collect(joiner);

    await host.setSource({ gameId: "game_1", source: SAMPLE_SOURCE.repeat(4) });
    await settle(world);

    const chunkMessages = traffic.filter((message) => message.binary);
    expect(chunkMessages.length).toBeGreaterThan(0);
    for (const message of chunkMessages) {
      expect(message.binary).toBe(true);
      expect(decodeChunk(message.payload)).not.toBeNull();
    }
    expect(receivedOf(joinerEvents)).toHaveLength(1);
  });

  it("transfers a multi-megabyte test document byte-identically", async () => {
    const world = makeRealWorld();
    const { host: hostTransport, joiner: joinerTransport } = await makeParty(world);
    const host = new GameSourceCoordinator({ transport: hostTransport });
    const joiner = new GameSourceCoordinator({ transport: joinerTransport });
    const joinerEvents = collect(joiner);

    // 1.25 MiB — a multi-megabyte document under the 2 MiB hard limit.
    const big = `<!doctype html><html><body>${"🦀".repeat(200)}${"x".repeat(1_250_000)}</body></html>`;
    expect(utf8ByteLength(big)).toBeGreaterThan(1024 * 1024);
    await host.setSource({ gameId: "game_big", source: big });
    await settle(world);

    const received = receivedOf(joinerEvents);
    expect(received).toHaveLength(1);
    if (received[0]?.type !== "received") throw new Error("unreachable");
    expect(received[0].source).toBe(big);
    expect(await hashSource(received[0].source)).toBe(await hashSource(big));
  });

  it("serves the current game to a late joiner via the peer:joined announcement", async () => {
    const world = makeRealWorld();
    const { host: hostTransport, joiner: joiner1Transport } = await makeParty(world, {
      joinerMemberId: "joiner-1",
    });
    const host = new GameSourceCoordinator({ transport: hostTransport });
    const joiner1 = new GameSourceCoordinator({ transport: joiner1Transport });
    const joiner1Events = collect(joiner1);
    await host.setSource({ gameId: "game_1", source: SAMPLE_SOURCE });
    await settle(world);
    expect(receivedOf(joiner1Events)).toHaveLength(1);

    // A second admitted member joins the already-running party.
    const joiner2Transport = world.hub.createTransport({ memberId: "joiner-2" });
    await joiner2Transport.join({ room: PRIVATE_ROOM, sessionId: PRIVATE_SESSION });
    const joiner2 = new GameSourceCoordinator({ transport: joiner2Transport });
    const joiner2Events = collect(joiner2);
    await settle(world);

    expect(receivedOf(joiner2Events)).toHaveLength(1);
    expect(joiner2.getCachedSource("game_1")).toBe(SAMPLE_SOURCE);
  });

  it("recovers a missed announcement with refresh()", async () => {
    const world = makeRealWorld();
    const { host: hostTransport, joiner: joinerTransport } = await makeParty(world);
    const host = new GameSourceCoordinator({ transport: hostTransport });
    await host.setSource({ gameId: "game_1", source: SAMPLE_SOURCE });
    await settle(world);

    // A coordinator attached late (e.g. a shell created after the party)
    // missed the announcement entirely.
    const lateJoiner = new GameSourceCoordinator({ transport: joinerTransport });
    const lateEvents = collect(lateJoiner);
    await lateJoiner.refresh();
    await settle(world);

    expect(receivedOf(lateEvents)).toHaveLength(1);
    expect(lateJoiner.getCachedSource("game_1")).toBe(SAMPLE_SOURCE);
  });

  it("supports several games per session and re-announces on setSource", async () => {
    const world = makeRealWorld();
    const { host: hostTransport, joiner: joinerTransport } = await makeParty(world);
    const host = new GameSourceCoordinator({ transport: hostTransport });
    const joiner = new GameSourceCoordinator({ transport: joinerTransport });
    const joinerEvents = collect(joiner);

    await host.setSource({ gameId: "game_1", source: "<html>one</html>" });
    await settle(world);
    await host.setSource({ gameId: "game_2", source: "<html>two</html>" });
    await settle(world);

    expect(receivedOf(joinerEvents)).toHaveLength(2);
    expect(joiner.getCachedSource("game_1")).toBe("<html>one</html>");
    expect(joiner.getCachedSource("game_2")).toBe("<html>two</html>");
  });

  it("serves a received source to other members from the session cache", async () => {
    const world = makeRealWorld();
    const { host: hostTransport, joiner: joiner1Transport } = await makeParty(world, {
      joinerMemberId: "joiner-1",
    });
    const host = new GameSourceCoordinator({ transport: hostTransport });
    const joiner1 = new GameSourceCoordinator({ transport: joiner1Transport });
    await host.setSource({ gameId: "game_1", source: SAMPLE_SOURCE });
    await settle(world);
    expect(joiner1.hasSource("game_1")).toBe(true);

    // A third member joins and the ORIGINAL host leaves: joiner1 serves the
    // cached copy from its in-memory session cache.
    const joiner2Transport = world.hub.createTransport({ memberId: "joiner-2" });
    await joiner2Transport.join({ room: PRIVATE_ROOM, sessionId: PRIVATE_SESSION });
    const joiner2 = new GameSourceCoordinator({ transport: joiner2Transport });
    const joiner2Events = collect(joiner2);
    await settle(world);
    await joiner1Transport.leave();
    await host.dispose();
    await settle(world);

    // joiner2 already received it (joiner1 + host both announced on join).
    expect(receivedOf(joiner2Events)).toHaveLength(1);
    expect(joiner2.getCachedSource("game_1")).toBe(SAMPLE_SOURCE);
  });
});

// ---------------------------------------------------------------------------
// Verification and retry
// ---------------------------------------------------------------------------

describe("hash verification and retry", () => {
  it("refuses a corrupted transfer, then accepts the corrected retry", async () => {
    const world = makeRealWorld();
    const { joiner: joinerTransport } = await makeParty(world);
    const joiner = new GameSourceCoordinator({ transport: joinerTransport });
    const joinerEvents = collect(joiner);

    // An unmanaged holder (raw transport) drives the transfer by hand.
    const rawHost = world.hub.createTransport({ memberId: "raw-host" });
    await rawHost.join({ room: PRIVATE_ROOM, sessionId: PRIVATE_SESSION });
    const rawHostTraffic = captureSourceTraffic(rawHost);
    const base: RawBase = {
      sessionId: PRIVATE_SESSION,
      senderMemberId: rawHost.selfMemberId,
      senderConnectionId: rawHost.selfConnectionId,
    };
    const sourceHash = await hashSource(SAMPLE_SOURCE);
    const chunks = chunkStringByUtf8Bytes(SAMPLE_SOURCE, 64);

    await rawHost.send({
      channel: GAME_SOURCE_CHANNEL,
      payload: rawMetadata(base, {
        gameId: "game_1",
        sourceSha256: sourceHash,
        sourceSizeBytes: utf8ByteLength(SAMPLE_SOURCE),
        chunkCount: chunks.length,
      }),
    });
    await settle(world);
    // The joiner requested the transfer.
    const request = rawHostTraffic.find((message) => {
      const parsed = parsePeerMessage(message.payload);
      return parsed.ok && parsed.value.type === "game.source.request";
    });
    expect(request).toBeDefined();

    // First attempt: chunk 0 is corrupted (same byte count, wrong content) so
    // verification must fail without tripping the receive-side size guard.
    const corruptedFirst = `${(chunks[0] ?? "").replace("r", "X")}`;
    for (let i = 0; i < chunks.length; i += 1) {
      const chunk = i === 0 ? corruptedFirst : (chunks[i] ?? "");
      await rawHost.send({
        channel: GAME_SOURCE_CHANNEL,
        payload: encodeChunk(
          rawChunk(base, {
            gameId: "game_1",
            sourceSha256: sourceHash,
            chunkIndex: i,
            chunkCount: chunks.length,
            chunk,
          }),
        ),
        binary: true,
      });
    }
    await settle(world);
    expect(joinerEvents.some((event) => event.type === "verificationFailed")).toBe(true);
    expect(receivedOf(joinerEvents)).toHaveLength(0);
    const failedAck = rawHostTraffic.find((message) => {
      const parsed = parsePeerMessage(message.payload);
      return (
        parsed.ok &&
        parsed.value.type === "game.source.ack" &&
        parsed.value.status === "failed" &&
        parsed.value.errorMessage === "hash_mismatch"
      );
    });
    expect(failedAck).toBeDefined();

    // Retry with the correct chunks: the joiner resets and verifies.
    for (let i = 0; i < chunks.length; i += 1) {
      await rawHost.send({
        channel: GAME_SOURCE_CHANNEL,
        payload: encodeChunk(
          rawChunk(base, {
            gameId: "game_1",
            sourceSha256: sourceHash,
            chunkIndex: i,
            chunkCount: chunks.length,
            chunk: chunks[i] ?? "",
          }),
        ),
        binary: true,
      });
    }
    await settle(world);
    const received = receivedOf(joinerEvents);
    expect(received).toHaveLength(1);
    if (received[0]?.type !== "received") throw new Error("unreachable");
    expect(received[0].source).toBe(SAMPLE_SOURCE);
    expect(joiner.getCachedSource("game_1")).toBe(SAMPLE_SOURCE);
  });

  it("retries a failed transfer on the host side and completes on a received ack", async () => {
    const world = makeRealWorld();
    const { host: hostTransport } = await makeParty(world);
    const hostEvents: GameSourceTransferEvent[] = [];
    const host = new GameSourceCoordinator({
      transport: hostTransport,
      onEvent: (event) => hostEvents.push(event),
    });
    const sourceHash = await hashSource(SAMPLE_SOURCE);
    await host.setSource({ gameId: "game_1", source: SAMPLE_SOURCE });
    await settle(world);

    // An unmanaged receiver requests the transfer, collects the chunks, then
    // reports a failed verification → the host retries; a received ack
    // completes the transfer.
    const rawJoiner = world.hub.createTransport({ memberId: "raw-joiner" });
    await rawJoiner.join({ room: PRIVATE_ROOM, sessionId: PRIVATE_SESSION });
    const rawTraffic = captureSourceTraffic(rawJoiner);
    const base: RawBase = {
      sessionId: PRIVATE_SESSION,
      senderMemberId: rawJoiner.selfMemberId,
      senderConnectionId: rawJoiner.selfConnectionId,
    };
    await rawJoiner.send({
      channel: GAME_SOURCE_CHANNEL,
      payload: rawRequest(base, { gameId: "game_1", sourceSha256: sourceHash }),
    });
    await settle(world);
    const firstDelivery = rawTraffic.filter((message) => message.binary).length;
    expect(firstDelivery).toBeGreaterThan(0);

    await rawJoiner.send({
      channel: GAME_SOURCE_CHANNEL,
      payload: rawAck(base, {
        gameId: "game_1",
        sourceSha256: sourceHash,
        status: "failed",
        errorMessage: "hash_mismatch",
      }),
    });
    await settle(world);
    expect(hostEvents.some((event) => event.type === "retry" && event.attempt === 2)).toBe(true);
    const retriedDelivery = rawTraffic.filter((message) => message.binary).length;
    expect(retriedDelivery).toBeGreaterThan(firstDelivery);

    await rawJoiner.send({
      channel: GAME_SOURCE_CHANNEL,
      payload: rawAck(base, { gameId: "game_1", sourceSha256: sourceHash, status: "received" }),
    });
    await settle(world);
    expect(
      hostEvents.some(
        (event) =>
          event.type === "complete" &&
          event.direction === "send" &&
          event.memberId === "raw-joiner",
      ),
    ).toBe(true);
  });

  it("gives up after retries are exhausted and tells the joiner", async () => {
    const world = makeRealWorld();
    const { host: hostTransport, joiner: joinerTransport } = await makeParty(world);
    const hostEvents: GameSourceTransferEvent[] = [];
    const host = new GameSourceCoordinator({
      transport: hostTransport,
      maxRetries: 1, // initial attempt + 1 retry
      onEvent: (event) => hostEvents.push(event),
    });
    const joiner = new GameSourceCoordinator({ transport: joinerTransport });
    const joinerEvents = collect(joiner);

    // A hash that can never verify: the announced digest disagrees with the
    // actual source, so every attempt fails verification.
    const wrongHash = "0".repeat(64);
    await host.setSource({ gameId: "game_1", source: SAMPLE_SOURCE, sourceSha256: wrongHash });
    await settle(world);

    const retries = hostEvents.filter((event) => event.type === "retry");
    expect(retries).toHaveLength(1); // exactly one retry after the first attempt
    expect(
      hostEvents.some(
        (event) => event.type === "error" && event.error.code === "retries_exhausted",
      ),
    ).toBe(true);
    // The joiner was told and aborted instead of waiting forever.
    expect(
      joinerEvents.some(
        (event) => event.type === "error" && event.error.code === "retries_exhausted",
      ),
    ).toBe(true);
    expect(cancelledOf(joinerEvents).length).toBeGreaterThan(0);
    expect(receivedOf(joinerEvents)).toHaveLength(0);
    expect(joiner.getCachedSource("game_1")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Cancellation
// ---------------------------------------------------------------------------

describe("transfer cancellation", () => {
  it("aborts locally, sends game.source.cancel, and drops stale chunks", async () => {
    const world = makeRealWorld();
    const { joiner: joinerTransport } = await makeParty(world);
    const joiner = new GameSourceCoordinator({ transport: joinerTransport });
    const joinerEvents = collect(joiner);

    const rawHost = world.hub.createTransport({ memberId: "raw-host" });
    await rawHost.join({ room: PRIVATE_ROOM, sessionId: PRIVATE_SESSION });
    const rawTraffic = captureSourceTraffic(rawHost);
    const base: RawBase = {
      sessionId: PRIVATE_SESSION,
      senderMemberId: rawHost.selfMemberId,
      senderConnectionId: rawHost.selfConnectionId,
    };
    // A multi-chunk source so the transfer is still in flight at cancel time.
    const source = SAMPLE_SOURCE.repeat(10);
    const sourceHash = await hashSource(source);
    const chunks = chunkStringByUtf8Bytes(source, 64);
    expect(chunks.length).toBeGreaterThan(1);

    await rawHost.send({
      channel: GAME_SOURCE_CHANNEL,
      payload: rawMetadata(base, {
        gameId: "game_1",
        sourceSha256: sourceHash,
        sourceSizeBytes: utf8ByteLength(source),
        chunkCount: chunks.length,
      }),
    });
    await settle(world);
    await rawHost.send({
      channel: GAME_SOURCE_CHANNEL,
      payload: encodeChunk(
        rawChunk(base, {
          gameId: "game_1",
          sourceSha256: sourceHash,
          chunkIndex: 0,
          chunkCount: chunks.length,
          chunk: chunks[0] ?? "",
        }),
      ),
      binary: true,
    });
    await settle(world);
    expect(progressOf(joinerEvents).length).toBeGreaterThan(0);

    joiner.cancelTransfer("game_1", sourceHash, "user_cancelled");
    await settle(world);

    const cancelled = cancelledOf(joinerEvents);
    expect(
      cancelled.some((event) => event.direction === "receive" && event.reason === "user_cancelled"),
    ).toBe(true);
    const wireCancel = rawTraffic.find((message) => {
      const parsed = parsePeerMessage(message.payload);
      return (
        parsed.ok &&
        parsed.value.type === "game.source.cancel" &&
        parsed.value.reason === "user_cancelled"
      );
    });
    expect(wireCancel).toBeDefined();
    expect(joiner.getCachedSource("game_1")).toBeUndefined();

    // Stale chunks already in flight are dropped silently — no completion,
    // no spurious errors.
    for (let i = 1; i < chunks.length; i += 1) {
      await rawHost.send({
        channel: GAME_SOURCE_CHANNEL,
        payload: encodeChunk(
          rawChunk(base, {
            gameId: "game_1",
            sourceSha256: sourceHash,
            chunkIndex: i,
            chunkCount: chunks.length,
            chunk: chunks[i] ?? "",
          }),
        ),
        binary: true,
      });
    }
    await settle(world);
    expect(receivedOf(joinerEvents)).toHaveLength(0);
    expect(errorsOf(joinerEvents)).toHaveLength(0);
  });

  it("aborts a host send transfer when a cancel arrives", async () => {
    const world = makeClockWorld();
    const clock = world.clock;
    if (clock === undefined) throw new Error("fake clock expected");
    const { host: hostTransport } = await makeParty(world, { hostLatencyMs: 10 });
    const hostEvents: GameSourceTransferEvent[] = [];
    const host = new GameSourceCoordinator({
      transport: hostTransport,
      onEvent: (event) => hostEvents.push(event),
    });
    const sourceHash = await hashSource(SAMPLE_SOURCE);

    await host.setSource({ gameId: "game_1", source: SAMPLE_SOURCE });
    const rawJoiner = world.hub.createTransport({ memberId: "raw-joiner" });
    await rawJoiner.join({ room: PRIVATE_ROOM, sessionId: PRIVATE_SESSION });
    const base: RawBase = {
      sessionId: PRIVATE_SESSION,
      senderMemberId: rawJoiner.selfMemberId,
      senderConnectionId: rawJoiner.selfConnectionId,
    };
    clock.advance(10); // deliver the peer:joined metadata announcement
    await flush();
    await rawJoiner.send({
      channel: GAME_SOURCE_CHANNEL,
      payload: rawRequest(base, { gameId: "game_1", sourceSha256: sourceHash }),
    });
    clock.advance(10); // deliver the request; the host schedules + sends chunks
    await rawJoiner.send({
      channel: GAME_SOURCE_CHANNEL,
      payload: rawCancel(base, {
        gameId: "game_1",
        sourceSha256: sourceHash,
        reason: "test_cancel",
      }),
    });
    clock.advance(10); // deliver the cancel: the host aborts the send transfer
    await flush();

    expect(
      hostEvents.some(
        (event) =>
          event.type === "cancelled" &&
          event.direction === "send" &&
          event.reason === "test_cancel",
      ),
    ).toBe(true);
    // The aborted transfer is gone: a late acknowledgement changes nothing.
    await rawJoiner.send({
      channel: GAME_SOURCE_CHANNEL,
      payload: rawAck(base, { gameId: "game_1", sourceSha256: sourceHash, status: "received" }),
    });
    clock.advance(10);
    await flush();
    expect(hostEvents.some((event) => event.type === "complete")).toBe(false);
    expect(hostEvents.some((event) => event.type === "retry")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Source-size limits
// ---------------------------------------------------------------------------

describe("source-size limits (F6)", () => {
  it("refuses a game too large to transfer with a clear error", async () => {
    const world = makeRealWorld();
    const { host: hostTransport } = await makeParty(world);
    const host = new GameSourceCoordinator({ transport: hostTransport });
    const tooBig = "x".repeat(htmlSourceBytes + 1);
    await expect(host.setSource({ gameId: "game_huge", source: tooBig })).rejects.toMatchObject({
      code: "too_large",
    });
    expect(host.hasSource("game_huge")).toBe(false);
  });

  it("emits a soft-limit warning before the hard limit", async () => {
    const world = makeRealWorld();
    const { host: hostTransport } = await makeParty(world);
    const events: GameSourceTransferEvent[] = [];
    const host = new GameSourceCoordinator({
      transport: hostTransport,
      onEvent: (e) => events.push(e),
    });
    const big = "x".repeat(htmlSourceWarnBytes);
    await host.setSource({ gameId: "game_big", source: big });
    const warnings = events.filter((event) => event.type === "warning");
    expect(warnings).toHaveLength(1);
    if (warnings[0]?.type !== "warning") throw new Error("unreachable");
    expect(warnings[0].gameId).toBe("game_big");
    expect(warnings[0].sourceSizeBytes).toBe(htmlSourceWarnBytes);
  });

  it("refuses an oversized announcement on the receiver side too", async () => {
    const world = makeRealWorld();
    const { joiner: joinerTransport } = await makeParty(world);
    const joiner = new GameSourceCoordinator({ transport: joinerTransport });
    const joinerEvents = collect(joiner);
    const rawHost = world.hub.createTransport({ memberId: "raw-host" });
    await rawHost.join({ room: PRIVATE_ROOM, sessionId: PRIVATE_SESSION });
    const rawTraffic = captureSourceTraffic(rawHost);
    const base: RawBase = {
      sessionId: PRIVATE_SESSION,
      senderMemberId: rawHost.selfMemberId,
      senderConnectionId: rawHost.selfConnectionId,
    };
    await rawHost.send({
      channel: GAME_SOURCE_CHANNEL,
      payload: rawMetadata(base, {
        gameId: "game_huge",
        sourceSha256: "a".repeat(64),
        sourceSizeBytes: htmlSourceBytes + 1,
        chunkCount: 1,
      }),
    });
    await settle(world);
    expect(
      joinerEvents.some((event) => event.type === "error" && event.error.code === "too_large"),
    ).toBe(true);
    const failedAck = rawTraffic.find((message) => {
      const parsed = parsePeerMessage(message.payload);
      return (
        parsed.ok &&
        parsed.value.type === "game.source.ack" &&
        parsed.value.status === "failed" &&
        parsed.value.errorMessage === "too_large"
      );
    });
    expect(failedAck).toBeDefined();
    expect(joiner.getCachedSource("game_huge")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Runtime compatibility
// ---------------------------------------------------------------------------

describe("runtime compatibility check", () => {
  it("refuses a game targeting an unsupported Nova API version", async () => {
    const world = makeRealWorld();
    const { host: hostTransport, joiner: joinerTransport } = await makeParty(world);
    const hostEvents: GameSourceTransferEvent[] = [];
    const host = new GameSourceCoordinator({
      transport: hostTransport,
      onEvent: (e) => hostEvents.push(e),
    });
    const joiner = new GameSourceCoordinator({ transport: joinerTransport });
    const joinerEvents = collect(joiner);

    await host.setSource({ gameId: "game_1", apiVersion: 2, source: SAMPLE_SOURCE });
    await settle(world);

    expect(
      joinerEvents.some((event) => event.type === "incompatible" && event.gameId === "game_1"),
    ).toBe(true);
    expect(receivedOf(joinerEvents)).toHaveLength(0);
    // The host learned why the joiner declined.
    expect(
      hostEvents.some((event) => event.type === "error" && event.error.code === "incompatible"),
    ).toBe(true);
  });

  it("accepts a game when the joiner supports the declared API version", async () => {
    const world = makeRealWorld();
    const { host: hostTransport, joiner: joinerTransport } = await makeParty(world);
    const host = new GameSourceCoordinator({ transport: hostTransport });
    const joiner = new GameSourceCoordinator({
      transport: joinerTransport,
      supportedApiVersions: [1, 2],
    });
    const joinerEvents = collect(joiner);

    await host.setSource({ gameId: "game_1", apiVersion: 2, source: SAMPLE_SOURCE });
    await settle(world);
    expect(receivedOf(joinerEvents)).toHaveLength(1);
  });

  it("honors an injected compatibility check", async () => {
    const world = makeRealWorld();
    const { host: hostTransport, joiner: joinerTransport } = await makeParty(world);
    const host = new GameSourceCoordinator({ transport: hostTransport });
    const joiner = new GameSourceCoordinator({
      transport: joinerTransport,
      compatibilityCheck: () => ({ compatible: false, reason: "custom policy" }),
    });
    const joinerEvents = collect(joiner);

    await host.setSource({ gameId: "game_1", source: SAMPLE_SOURCE });
    await settle(world);
    expect(
      joinerEvents.some(
        (event) => event.type === "incompatible" && event.reason === "custom policy",
      ),
    ).toBe(true);
    expect(receivedOf(joinerEvents)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Reconnect (re-transfer after reconnect if required)
// ---------------------------------------------------------------------------

describe("reconnect and re-transfer", () => {
  it("re-transfers after a mid-transfer disconnect only if required", async () => {
    const world = makeClockWorld();
    const clock = world.clock;
    if (clock === undefined) throw new Error("fake clock expected");
    const { host: hostTransport, joiner: joinerTransport } = await makeParty(world, {
      hostLatencyMs: 10,
      joinerFaults: { dropWhileSuspended: true },
    });
    const hostEvents: GameSourceTransferEvent[] = [];
    const host = new GameSourceCoordinator({
      transport: hostTransport,
      onEvent: (e) => hostEvents.push(e),
    });
    const joiner = new GameSourceCoordinator({ transport: joinerTransport });
    const joinerEvents = collect(joiner);

    await host.setSource({ gameId: "game_1", source: SAMPLE_SOURCE });
    clock.advance(10); // deliver metadata (the joiner's handler suspends on its await)
    await flush(); // the joiner sends its request
    clock.advance(10); // deliver the request; the host schedules chunks at t+10
    // The transfer is now in flight: requested, chunks scheduled, none delivered.
    expect(
      joinerEvents.some((event) => event.type === "transferStart" && event.direction === "receive"),
    ).toBe(true);

    // The joiner's connection drops mid-transfer (Mobile Safari backgrounding).
    await joinerTransport.suspend();
    expect(cancelledOf(joinerEvents).some((event) => event.reason === "connection_lost")).toBe(
      true,
    );
    expect(
      hostEvents.some((event) => event.type === "cancelled" && event.reason === "peer_left"),
    ).toBe(true);

    // Reconnect: the host re-announces to the fresh connection and the
    // joiner re-requests because it still lacks the verified source.
    await joinerTransport.resume();
    clock.advance(10); // the stale in-flight chunk (dropped) + the fresh announcement
    await flush(); // the joiner re-requests
    clock.advance(10); // deliver the fresh request; chunks scheduled
    clock.advance(10); // deliver the chunks; verification runs
    await flush(); // verification completes; ack scheduled
    clock.advance(10); // deliver the ack; the host completes
    await flush();

    const received = receivedOf(joinerEvents);
    expect(received).toHaveLength(1);
    if (received[0]?.type !== "received") throw new Error("unreachable");
    expect(received[0].source).toBe(SAMPLE_SOURCE);
    expect(
      hostEvents.some(
        (event) =>
          event.type === "complete" && event.direction === "send" && event.memberId === "joiner",
      ),
    ).toBe(true);
    expect(joiner.getCachedSource("game_1")).toBe(SAMPLE_SOURCE);
  });

  it("keeps the cached copy after a reconnect without re-requesting", async () => {
    const world = makeClockWorld();
    const clock = world.clock;
    if (clock === undefined) throw new Error("fake clock expected");
    const { host: hostTransport, joiner: joinerTransport } = await makeParty(world, {
      hostLatencyMs: 10,
    });
    const hostEvents: GameSourceTransferEvent[] = [];
    const host = new GameSourceCoordinator({
      transport: hostTransport,
      onEvent: (e) => hostEvents.push(e),
    });
    const joiner = new GameSourceCoordinator({ transport: joinerTransport });
    const joinerEvents = collect(joiner);

    await host.setSource({ gameId: "game_1", source: SAMPLE_SOURCE });
    clock.advance(10); // deliver metadata
    await flush(); // the joiner sends its request
    clock.advance(10); // deliver the request; chunks scheduled
    clock.advance(10); // deliver the chunks; verification runs
    await flush(); // verification completes; ack scheduled
    clock.advance(10); // deliver the ack; the host completes
    expect(receivedOf(joinerEvents)).toHaveLength(1);
    expect(
      hostEvents.some(
        (event) =>
          event.type === "complete" && event.direction === "send" && event.memberId === "joiner",
      ),
    ).toBe(true);

    // Reconnect AFTER a completed transfer: no re-request, cache intact.
    const transferStartsBefore = joinerEvents.filter((e) => e.type === "transferStart").length;
    await joinerTransport.suspend();
    await joinerTransport.resume();
    clock.advance(30);
    await flush();

    expect(receivedOf(joinerEvents)).toHaveLength(1);
    expect(joinerEvents.filter((e) => e.type === "transferStart").length).toBe(
      transferStartsBefore,
    );
    expect(joiner.getCachedSource("game_1")).toBe(SAMPLE_SOURCE);
  });
});

// ---------------------------------------------------------------------------
// Admission and isolation
// ---------------------------------------------------------------------------

describe("admission and isolation", () => {
  it("never sends the source to rendezvous peers who were not admitted", async () => {
    const world = makeRealWorld();
    const { host: hostTransport } = await makeParty(world);
    const host = new GameSourceCoordinator({ transport: hostTransport });
    await host.setSource({ gameId: "game_1", source: SAMPLE_SOURCE });
    await settle(world);

    // A raw peer in the PUBLIC rendezvous room (never admitted) must not
    // see any game-source traffic: the coordinator only rides the private
    // party transport (ADR-0004), so the source never reaches that room.
    const probe = world.hub.createTransport({ memberId: "probe" });
    await probe.join({ room: rendezvousRoomName("AAAA"), sessionId: rendezvousSessionId("AAAA") });
    const probeTraffic = captureSourceTraffic(probe);
    await settle(world);
    expect(probeTraffic).toHaveLength(0);
  });

  it("drops malformed structured messages at the protocol boundary", async () => {
    const world = makeRealWorld();
    const { host: hostTransport } = await makeParty(world);
    const hostEvents: GameSourceTransferEvent[] = [];
    const _host = new GameSourceCoordinator({
      transport: hostTransport,
      onEvent: (e) => hostEvents.push(e),
    });
    const raw = world.hub.createTransport({ memberId: "raw" });
    await raw.join({ room: PRIVATE_ROOM, sessionId: PRIVATE_SESSION });

    await raw.send({
      channel: GAME_SOURCE_CHANNEL,
      payload: {
        version: 1,
        sessionId: PRIVATE_SESSION,
        senderMemberId: raw.selfMemberId,
        senderConnectionId: raw.selfConnectionId,
        messageId: "malformed-1",
        sentAt: 1,
        type: "game.source.chunk", // missing every required field
      },
    });
    await settle(world);
    expect(
      hostEvents.some((event) => event.type === "error" && event.error.code === "invalid_message"),
    ).toBe(true);
  });

  it("drops undecodable binary payloads at the protocol boundary", async () => {
    const world = makeRealWorld();
    const { host: hostTransport } = await makeParty(world);
    const hostEvents: GameSourceTransferEvent[] = [];
    const _host = new GameSourceCoordinator({
      transport: hostTransport,
      onEvent: (e) => hostEvents.push(e),
    });
    const raw = world.hub.createTransport({ memberId: "raw" });
    await raw.join({ room: PRIVATE_ROOM, sessionId: PRIVATE_SESSION });

    await raw.send({
      channel: GAME_SOURCE_CHANNEL,
      payload: new TextEncoder().encode("this is not json {{{"),
      binary: true,
    });
    await settle(world);
    expect(
      hostEvents.some((event) => event.type === "error" && event.error.code === "invalid_message"),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Cleanup (engineering rule 22)
// ---------------------------------------------------------------------------

describe("listener cleanup (rule 22)", () => {
  it("detaches all listeners on dispose and stays inert afterwards", async () => {
    const world = makeRealWorld();
    const { host: hostTransport, joiner: joinerTransport } = await makeParty(world);
    const host = new GameSourceCoordinator({ transport: hostTransport });
    const joiner = new GameSourceCoordinator({ transport: joinerTransport });
    const joinerEvents = collect(joiner);

    await host.setSource({ gameId: "game_1", source: SAMPLE_SOURCE });
    await settle(world);
    expect(receivedOf(joinerEvents)).toHaveLength(1);

    joiner.dispose();
    joiner.dispose(); // idempotent
    const before = joinerEvents.length;
    await host.setSource({ gameId: "game_2", source: "<html>two</html>" });
    await settle(world);
    await host.refresh();
    await settle(world);
    expect(joinerEvents.length).toBe(before); // no events after dispose
    await expect(joiner.refresh()).rejects.toMatchObject({ code: "invalid_state" });
  });
});

// ---------------------------------------------------------------------------
// Full P2 integration: admitted joiners receive the game over the party flow
// ---------------------------------------------------------------------------

/** Deterministic (microtask-only) derivation so flows never wait on crypto. */
function mockDerive(secret: string) {
  return Promise.resolve({
    secret,
    roomId: `party:test:${secret.slice(0, 12)}`,
    password: `pwd-${secret.slice(0, 16)}`,
    sessionId: `session-${secret.slice(0, 12)}`,
  });
}

/** Index of a code in the 23^4 code space (for injectable codeRngs). */
function codeIndex(code: string): number {
  let value = 0;
  for (let i = 0; i < code.length; i += 1) {
    const char = code.charAt(i);
    value += PARTY_CODE_ALPHABET.indexOf(char) * PARTY_CODE_ALPHABET.length ** (3 - i);
  }
  return value;
}

async function makeCreator(
  world: PartyWorld,
  overrides: Partial<CreatePartyOptions> = {},
): Promise<Awaited<ReturnType<typeof createParty>>> {
  const clock = world.clock;
  if (clock === undefined) throw new Error("fake clock expected");
  const promise = createParty({
    memberId: "creator",
    transportFactory: world.factory,
    schedule: clock.schedule,
    collisionListenMs: 1000,
    collisionRetries: 2,
    advertIntervalMs: 5000,
    onJoinRequest: () => true,
    codeRng: () => codeIndex("AAAA"),
    partyName: "Party One",
    gameTitle: "Rocket Rumble",
    derive: mockDerive,
    ...overrides,
  });
  for (let i = 0; i < 6; i += 1) {
    await flush();
    clock.advance(2000);
  }
  const party = await promise;
  await settle(world);
  return party;
}

async function makeJoiner(
  world: PartyWorld,
  overrides: Partial<JoinByCodeOptions> = {},
): Promise<Awaited<ReturnType<typeof joinPartyByCode>>> {
  const clock = world.clock;
  if (clock === undefined) throw new Error("fake clock expected");
  const promise = joinPartyByCode({
    code: "AAAA",
    memberId: "joiner",
    displayName: "Joiner",
    transportFactory: world.factory,
    schedule: clock.schedule,
    discoveryTimeoutMs: 20_000,
    admissionTimeoutMs: 30_000,
    advertIntervalMs: 5000,
    onJoinRequest: () => true,
    derive: mockDerive,
    ...overrides,
  });
  await flush();
  clock.advance(5000);
  await settle(world);
  clock.advance(2000);
  await settle(world);
  await settle(world);
  const party = await promise;
  await settle(world);
  return party;
}

interface PartyWorld extends World {
  clock: FakeClock;
  factory: PartyTransportFactory;
}

function makePartyWorld(): PartyWorld {
  const clock = makeFakeClock();
  const hub = new InMemoryTransportHub({ schedule: clock.schedule, now: clock.now });
  const factory: PartyTransportFactory = {
    createRendezvousTransport: (identity) => hub.createTransport(identity),
    createPrivateTransport: (identity) => hub.createTransport(identity),
  };
  return { clock, hub, factory };
}

describe("P2 party flow integration (admitted joiner receives the game)", () => {
  it("delivers the byte-identical source to an admitted joiner over the private room", async () => {
    const world = makePartyWorld();
    const creator = await makeCreator(world);
    const host = new GameSourceCoordinator({ transport: creator.privateTransport });
    await host.setSource({
      gameId: "game_1",
      title: "Rocket Rumble",
      apiVersion: 1,
      mode: "state",
      source: SAMPLE_SOURCE,
    });

    const joiner = await makeJoiner(world);
    const joinerCoordinator = new GameSourceCoordinator({ transport: joiner.privateTransport });
    const joinerEvents = collect(joinerCoordinator);
    // The joiner's coordinator attached after the host's peer:joined
    // announcement; refresh recovers it (shells wire this before launch).
    await joinerCoordinator.refresh();
    await settle(world);

    const received = receivedOf(joinerEvents);
    expect(received).toHaveLength(1);
    if (received[0]?.type !== "received") throw new Error("unreachable");
    expect(received[0].source).toBe(SAMPLE_SOURCE);
    expect(joinerCoordinator.getCachedSource("game_1")).toBe(SAMPLE_SOURCE);

    // The source never entered the public rendezvous room.
    const probeTraffic: TransportMessage[] = [];
    const probe = world.hub.createTransport({ memberId: "probe" });
    probe.on("message:received", (message) => {
      if (message.channel === GAME_SOURCE_CHANNEL) probeTraffic.push(message);
    });
    await probe.join({ room: rendezvousRoomName("AAAA"), sessionId: rendezvousSessionId("AAAA") });
    await settle(world);
    expect(probeTraffic).toHaveLength(0);

    joinerCoordinator.dispose();
    host.dispose();
  });
});
