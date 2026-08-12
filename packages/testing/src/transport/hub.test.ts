import { describe, expect, it } from "vitest";
import { asyncProperty, assert as fcAssert, integer as fcInteger } from "fast-check";
import { assertPeerMessage, parsePeerMessage } from "@rocketcrab/protocol";
import type { TransferProgress, TransportMessage, TransportPeerInfo } from "@rocketcrab/core";
import { InMemoryTransportHub } from "./hub";
import { mulberry32 } from "./prng";
import type { InMemoryTransport } from "./in-memory-transport";

const SESSION = "session-1";

async function joinRoom(transport: InMemoryTransport, room = "arena"): Promise<void> {
  await transport.join({ room, sessionId: SESSION });
}

function collectMessages(
  transport: InMemoryTransport,
  store: TransportMessage[] = [],
): TransportMessage[] {
  transport.on("message:received", (message) => {
    store.push(message);
  });
  return store;
}

describe("InMemoryTransportHub — messaging", () => {
  it("lets two independent transports communicate in the same room", async () => {
    const hub = new InMemoryTransportHub();
    const a = hub.createTransport({ memberId: "member-a" });
    const b = hub.createTransport({ memberId: "member-b" });
    const received = collectMessages(b);
    await joinRoom(a);
    await joinRoom(b);
    expect(a.peers.map((p) => p.memberId)).toEqual(["member-b"]);
    expect(b.peers.map((p) => p.memberId)).toEqual(["member-a"]);

    await a.send({ channel: "state", payload: { hello: "world" } });
    hub.drain();
    expect(received).toHaveLength(1);
    const message = received[0]!;
    expect(message.payload).toEqual({ hello: "world" });
    expect(message.senderMemberId).toBe("member-a");
    expect(message.sessionId).toBe(SESSION);
    expect(message.channel).toBe("state");
    expect(message.reliability).toBe("reliable");
    expect(message.ordering).toBe("ordered");
    expect(typeof message.messageId).toBe("string");
    expect(typeof message.sentAt).toBe("number");
  });

  it("does not deliver a broadcast back to the sender", async () => {
    const hub = new InMemoryTransportHub();
    const a = hub.createTransport({ memberId: "member-a" });
    const b = hub.createTransport({ memberId: "member-b" });
    const c = hub.createTransport({ memberId: "member-c" });
    const aReceived = collectMessages(a);
    await joinRoom(a);
    await joinRoom(b);
    await joinRoom(c);
    await a.send({ channel: "raw", payload: "broadcast" });
    hub.drain();
    expect(aReceived).toHaveLength(0);
  });

  it("delivers a targeted send only to the target", async () => {
    const hub = new InMemoryTransportHub();
    const a = hub.createTransport({ memberId: "member-a" });
    const b = hub.createTransport({ memberId: "member-b" });
    const c = hub.createTransport({ memberId: "member-c" });
    const bReceived = collectMessages(b);
    const cReceived = collectMessages(c);
    await joinRoom(a);
    await joinRoom(b);
    await joinRoom(c);
    await a.send({
      channel: "raw",
      payload: "secret",
      targetConnectionId: b.selfConnectionId,
    });
    hub.drain();
    expect(bReceived).toHaveLength(1);
    expect(bReceived[0]?.payload).toBe("secret");
    expect(cReceived).toHaveLength(0);
  });

  it("rejects a targeted send to an unknown connection", async () => {
    const hub = new InMemoryTransportHub();
    const a = hub.createTransport({ memberId: "member-a" });
    const b = hub.createTransport({ memberId: "member-b" });
    await joinRoom(a);
    await joinRoom(b);
    await expect(
      a.send({ channel: "raw", payload: "x", targetConnectionId: "conn-nope" }),
    ).rejects.toThrow(/no connected peer/);
  });

  it("delivers the exact same payloads to every receiver (two frames)", async () => {
    const hub = new InMemoryTransportHub();
    const a = hub.createTransport({ memberId: "member-a" });
    const b = hub.createTransport({ memberId: "member-b" });
    const c = hub.createTransport({ memberId: "member-c" });
    const bReceived = collectMessages(b);
    const cReceived = collectMessages(c);
    await joinRoom(a);
    await joinRoom(b);
    await joinRoom(c);
    const payload = { action: "play", card: { suit: "spades", rank: "ace" } };
    await a.send({ channel: "actions", payload });
    hub.drain();
    expect(bReceived[0]?.payload).toEqual(payload);
    expect(cReceived[0]?.payload).toEqual(payload);
    expect(bReceived[0]?.messageId).toBe(cReceived[0]?.messageId);
  });

  it("round-trips binary payloads as independent byte copies", async () => {
    const hub = new InMemoryTransportHub();
    const a = hub.createTransport({ memberId: "member-a" });
    const b = hub.createTransport({ memberId: "member-b" });
    const received = collectMessages(b);
    await joinRoom(a);
    await joinRoom(b);
    const bytes = new Uint8Array([1, 2, 3, 255, 0]);
    await a.send({ channel: "raw", payload: bytes, binary: true });
    hub.drain();
    const message = received[0]!;
    expect(message.binary).toBe(true);
    expect(message.payload).toBeInstanceOf(Uint8Array);
    const delivered = message.payload as Uint8Array;
    expect([...delivered]).toEqual([...bytes]);
    // Mutating the received copy must not affect the sender's buffer.
    delivered[0] = 99;
    expect(bytes[0]).toBe(1);
    // A second receiver gets its own copy.
    const c = hub.createTransport({ memberId: "member-c" });
    await joinRoom(c);
    const cReceived = collectMessages(c);
    await a.send({ channel: "raw", payload: bytes, binary: true });
    hub.drain();
    const second = cReceived[0]!.payload as Uint8Array;
    expect([...second]).toEqual([...bytes]);
  });
});

describe("InMemoryTransportHub — runtime protocol compatibility", () => {
  it("carries a validated peer message with matching envelope fields", async () => {
    const hub = new InMemoryTransportHub({ now: () => 1_700_000_000_000 });
    const a = hub.createTransport({ memberId: "member-a" });
    const b = hub.createTransport({ memberId: "member-b" });
    const received = collectMessages(b);
    await joinRoom(a);
    await joinRoom(b);

    const dispatch = assertPeerMessage({
      version: 1,
      sessionId: SESSION,
      senderMemberId: "member-a",
      senderConnectionId: a.selfConnectionId,
      messageId: "action-msg-1",
      sentAt: 1_700_000_000_000,
      seq: 1,
      type: "action.dispatch",
      actionId: "action-1",
      baseRevision: 0,
      actionType: "playCard",
      payload: { card: "ace" },
    });
    await a.send({ channel: "actions", payload: dispatch, seq: 1 });
    hub.drain();

    const message = received[0]!;
    // The transport envelope exposes the same fields the peer envelope
    // carries, and the payload is the exact protocol message (no rewriting,
    // no fabrication — the transport never bypasses the runtime protocol).
    expect(message.sessionId).toBe(dispatch.sessionId);
    expect(message.senderMemberId).toBe(dispatch.senderMemberId);
    expect(message.senderConnectionId).toBe(dispatch.senderConnectionId);
    expect(message.seq).toBe(dispatch.seq);
    expect(message.payload).toEqual(dispatch);
    const reparsed = assertPeerMessage(message.payload);
    expect(reparsed.type).toBe("action.dispatch");
  });

  it("validates structured payloads at the boundary when configured", async () => {
    const hub = new InMemoryTransportHub({
      validate: (payload) => {
        const result = parsePeerMessage(payload);
        return result.ok ? { ok: true } : { ok: false, error: result.error.message };
      },
    });
    const a = hub.createTransport({ memberId: "member-a" });
    const b = hub.createTransport({ memberId: "member-b" });
    const received = collectMessages(b);
    const invalid: Array<{ reason: string }> = [];
    a.on("message:invalid", (_message, reason) => {
      invalid.push({ reason });
    });
    await joinRoom(a);
    await joinRoom(b);

    await expect(
      a.send({ channel: "actions", payload: { type: "not.a.protocol.message" } }),
    ).rejects.toThrow(/failed validation/);
    expect(invalid).toHaveLength(1);
    expect(received).toHaveLength(0);

    const valid = assertPeerMessage({
      version: 1,
      sessionId: SESSION,
      senderMemberId: "member-a",
      senderConnectionId: a.selfConnectionId,
      messageId: "identity-1",
      sentAt: 1_700_000_000_000,
      type: "player.identity",
      displayName: "Ada",
      authorityEligible: true,
    });
    await a.send({ channel: "identity", payload: valid });
    hub.drain();
    expect(received).toHaveLength(1);
  });

  it("lets binary payloads bypass protocol validation", async () => {
    const hub = new InMemoryTransportHub({
      validate: () => ({ ok: false, error: "no structured payloads allowed" }),
    });
    const a = hub.createTransport({ memberId: "member-a" });
    const b = hub.createTransport({ memberId: "member-b" });
    const received = collectMessages(b);
    await joinRoom(a);
    await joinRoom(b);
    await a.send({ channel: "raw", payload: new Uint8Array([7, 8, 9]) });
    hub.drain();
    expect(received).toHaveLength(1);
    expect(received[0]?.binary).toBe(true);
  });
});

describe("InMemoryTransportHub — link faults", () => {
  it("drops unreliable messages when loss fires and reports message:lost", async () => {
    const hub = new InMemoryTransportHub();
    const a = hub.createTransport({
      memberId: "member-a",
      faults: { lossRate: 1 },
    });
    const b = hub.createTransport({ memberId: "member-b" });
    const received = collectMessages(b);
    const lost: TransportMessage[] = [];
    a.on("message:lost", (message) => {
      lost.push(message);
    });
    await joinRoom(a);
    await joinRoom(b);
    await a.send({ channel: "raw", payload: "gone", reliability: "unreliable" });
    hub.drain();
    expect(lost).toHaveLength(1);
    expect(received).toHaveLength(0);
  });

  it("never loses reliable messages even under total loss", async () => {
    const hub = new InMemoryTransportHub();
    const a = hub.createTransport({
      memberId: "member-a",
      faults: { lossRate: 1 },
    });
    const b = hub.createTransport({ memberId: "member-b" });
    const received = collectMessages(b);
    await joinRoom(a);
    await joinRoom(b);
    await a.send({ channel: "actions", payload: { ok: true } });
    hub.drain();
    expect(received).toHaveLength(1);
  });

  it("duplicates messages on unordered channels", async () => {
    const seed = 4242;
    const hub = new InMemoryTransportHub({ seed });
    const a = hub.createTransport({
      memberId: "member-a",
      connectionId: "conn-a",
      faults: { duplicateChance: 1, duplicateMax: 2 },
    });
    const b = hub.createTransport({ memberId: "member-b", connectionId: "conn-b" });
    const received = collectMessages(b);
    await joinRoom(a);
    await joinRoom(b);
    // Replicate the RNG stream: message id draw, duplication check draw,
    // then the extra-copy draw (1 + floor(rng * duplicateMax)).
    const rng = mulberry32(seed);
    rng(); // message id
    rng(); // duplication check (rate 1 → fires)
    const extra = 1 + Math.floor(rng() * 2);
    await a.send({ channel: "raw", payload: "copy", ordering: "unordered" });
    hub.drain();
    expect(received).toHaveLength(1 + extra); // original + `extra` copies
    for (const message of received) {
      expect(message.payload).toBe("copy");
    }
  });

  it("deduplicates duplicates on ordered channels by seq", async () => {
    const hub = new InMemoryTransportHub();
    const a = hub.createTransport({
      memberId: "member-a",
      faults: { duplicateChance: 1, duplicateMax: 2 },
    });
    const b = hub.createTransport({ memberId: "member-b" });
    const received = collectMessages(b);
    await joinRoom(a);
    await joinRoom(b);
    await a.send({ channel: "actions", payload: { n: 1 }, seq: 1 });
    hub.drain();
    expect(received).toHaveLength(1);
  });

  it("delivers out of order on unordered channels when reordering fires", async () => {
    const seed = 12_345;
    const hub = new InMemoryTransportHub({ seed, now: () => 1000 });
    const a = hub.createTransport({
      memberId: "member-a",
      connectionId: "conn-a",
      faults: { reorderRate: 1, reorderMaxDelayMs: 100 },
    });
    const b = hub.createTransport({ memberId: "member-b", connectionId: "conn-b" });
    const received: string[] = [];
    b.on("message:received", (message) => {
      received.push(message.payload as string);
    });
    await joinRoom(a);
    await joinRoom(b);

    // Replicate the hub's RNG stream: per send exactly one id draw, then the
    // reorder check + delay draws (jitter/loss/duplication are disabled).
    const rng = mulberry32(seed);
    const delays: number[] = [];
    for (let i = 0; i < 3; i += 1) {
      rng(); // message id
      rng(); // reorder check (always fires at rate 1)
      delays.push(rng() * 100); // reorder delay
    }
    await a.send({
      channel: "raw",
      payload: "m1",
      ordering: "unordered",
      reliability: "unreliable",
    });
    await a.send({
      channel: "raw",
      payload: "m2",
      ordering: "unordered",
      reliability: "unreliable",
    });
    await a.send({
      channel: "raw",
      payload: "m3",
      ordering: "unordered",
      reliability: "unreliable",
    });
    hub.drain();

    const expected = [1, 2, 3]
      .map((n, index) => ({ n, delay: delays[index]! }))
      .sort((x, y) => x.delay - y.delay || x.n - y.n)
      .map((entry) => `m${entry.n}`);
    expect(received).toEqual(expected);
  });

  it("keeps ordered channels in seq order despite reordering faults", async () => {
    const seed = 54_321;
    const hub = new InMemoryTransportHub({ seed, now: () => 1000 });
    const a = hub.createTransport({
      memberId: "member-a",
      connectionId: "conn-a",
      faults: { reorderRate: 1, reorderMaxDelayMs: 100 },
    });
    const b = hub.createTransport({ memberId: "member-b", connectionId: "conn-b" });
    const received: string[] = [];
    b.on("message:received", (message) => {
      received.push(message.payload as string);
    });
    await joinRoom(a);
    await joinRoom(b);
    await a.send({ channel: "actions", payload: "m1", seq: 1 });
    await a.send({ channel: "actions", payload: "m2", seq: 2 });
    await a.send({ channel: "actions", payload: "m3", seq: 3 });
    hub.drain();
    expect(received).toEqual(["m1", "m2", "m3"]);
  });

  it("applies configured latency via the scheduler", async () => {
    const scheduled: number[] = [];
    const hub = new InMemoryTransportHub({
      schedule: (callback, delayMs) => {
        scheduled.push(delayMs);
        return () => undefined;
      },
    });
    const a = hub.createTransport({
      memberId: "member-a",
      faults: { latencyMs: 100 },
    });
    const b = hub.createTransport({ memberId: "member-b" });
    const received = collectMessages(b);
    await joinRoom(a);
    await joinRoom(b);
    await a.send({ channel: "raw", payload: "slow" });
    hub.drain();
    expect(scheduled).toEqual([100]);
    expect(received).toHaveLength(1);
  });

  it("jitters delivery times within the configured window", async () => {
    const hub = new InMemoryTransportHub({ seed: 777, now: () => 1000 });
    const a = hub.createTransport({
      memberId: "member-a",
      connectionId: "conn-a",
      faults: { latencyMs: 100, jitterMs: 20 },
    });
    const b = hub.createTransport({ memberId: "member-b", connectionId: "conn-b" });
    const received = collectMessages(b);
    await joinRoom(a);
    await joinRoom(b);
    for (let i = 0; i < 50; i += 1) {
      await a.send({ channel: "raw", payload: `m${i}` });
    }
    const deliveryTimes = hub.pendingDeliveries();
    expect(deliveryTimes).toHaveLength(50);
    for (const at of deliveryTimes) {
      const delay = at - 1000;
      expect(delay).toBeGreaterThanOrEqual(80);
      expect(delay).toBeLessThanOrEqual(120);
    }
    hub.drain();
    expect(received).toHaveLength(50);
  });

  it("schedules a join after the configured discovery latency", async () => {
    const scheduled: number[] = [];
    const hub = new InMemoryTransportHub({
      schedule: (callback, delayMs) => {
        scheduled.push(delayMs);
        return () => undefined;
      },
    });
    const a = hub.createTransport({
      memberId: "member-a",
      faults: { joinDelayMs: 30 },
    });
    const b = hub.createTransport({ memberId: "member-b" });
    const joined: TransportPeerInfo[] = [];
    b.on("peer:joined", (peer) => {
      joined.push(peer);
    });
    const join = a.join({ room: "arena", sessionId: SESSION });
    expect(scheduled).toEqual([30]);
    hub.drain();
    await join;
    await joinRoom(b);
    expect(joined).toHaveLength(1);
  });
});

describe("InMemoryTransportHub — chunked transfers and progress", () => {
  it("transfers binary payloads in chunks with progress on both sides", async () => {
    const hub = new InMemoryTransportHub({ chunkSizeBytes: 1024 });
    const a = hub.createTransport({ memberId: "member-a" });
    const b = hub.createTransport({ memberId: "member-b" });
    const received = collectMessages(b);
    const sendProgress: TransferProgress[] = [];
    const recvProgress: TransferProgress[] = [];
    b.on("transfer:progress", (progress) => {
      recvProgress.push(progress);
    });
    await joinRoom(a);
    await joinRoom(b);

    const bytes = new Uint8Array(5000);
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = i % 251;
    }
    await a.send({
      channel: "source",
      payload: bytes,
      binary: true,
      onProgress: (progress) => {
        sendProgress.push(progress);
      },
    });
    hub.drain();

    expect(received).toHaveLength(1);
    expect([...(received[0]!.payload as Uint8Array)]).toEqual([...bytes]);
    expect(received[0]!.binary).toBe(true);
    expect(sendProgress).toHaveLength(5);
    expect(recvProgress).toHaveLength(5);
    expect(sendProgress[4]!.fraction).toBe(1);
    expect(recvProgress[4]!.fraction).toBe(1);
    expect(sendProgress[0]!.direction).toBe("send");
    expect(recvProgress[0]!.direction).toBe("receive");
    expect(recvProgress[0]!.totalBytes).toBe(5000);
  });

  it("round-trips chunked strings and structured payloads", async () => {
    const hub = new InMemoryTransportHub({ chunkSizeBytes: 16 });
    const a = hub.createTransport({ memberId: "member-a" });
    const b = hub.createTransport({ memberId: "member-b" });
    const received = collectMessages(b);
    await joinRoom(a);
    await joinRoom(b);

    const text = "the quick brown fox jumps over the lazy dog — 0123456789";
    await a.send({ channel: "raw", payload: text });
    const structured = { gameId: "g-1", chunks: Array.from({ length: 20 }, (_, i) => i) };
    await a.send({ channel: "raw", payload: structured });
    hub.drain();

    expect(received).toHaveLength(2);
    expect(received[0]!.payload).toBe(text);
    expect(received[1]!.payload).toEqual(structured);
  });

  it("discards a chunked transfer when a chunk is lost (unreliable)", async () => {
    const hub = new InMemoryTransportHub({ chunkSizeBytes: 1024 });
    const a = hub.createTransport({
      memberId: "member-a",
      faults: { lossRate: 1 },
    });
    const b = hub.createTransport({ memberId: "member-b" });
    const received = collectMessages(b);
    const lost: TransportMessage[] = [];
    a.on("message:lost", (message) => {
      lost.push(message);
    });
    await joinRoom(a);
    await joinRoom(b);
    await a.send({
      channel: "source",
      payload: new Uint8Array(3000),
      reliability: "unreliable",
    });
    hub.drain();
    expect(received).toHaveLength(0);
    expect(lost).toHaveLength(3);
  });
});

describe("InMemoryTransportHub — deterministic seeded mode", () => {
  async function runScript(seed: number): Promise<string[]> {
    const hub = new InMemoryTransportHub({ seed, now: () => 1000 });
    const a = hub.createTransport({
      memberId: "member-a",
      connectionId: "conn-a",
      faults: {
        latencyMs: 5,
        jitterMs: 20,
        lossRate: 0.3,
        duplicateChance: 0.4,
        duplicateMax: 2,
        reorderRate: 0.5,
        reorderMaxDelayMs: 30,
      },
    });
    const b = hub.createTransport({ memberId: "member-b", connectionId: "conn-b" });
    const trace: string[] = [];
    b.on("message:received", (message) => {
      trace.push(`recv:${message.messageId}`);
    });
    b.on("transfer:progress", (progress) => {
      trace.push(`recv-prog:${progress.messageId}:${progress.fraction.toFixed(3)}`);
    });
    a.on("transfer:progress", (progress) => {
      trace.push(`send-prog:${progress.messageId}:${progress.fraction.toFixed(3)}`);
    });
    a.on("message:lost", (message) => {
      trace.push(`lost:${message.messageId}`);
    });
    await joinRoom(a);
    await joinRoom(b);
    await a.send({ channel: "actions", payload: { n: 1 }, seq: 1 });
    await a.send({ channel: "actions", payload: { n: 2 }, seq: 2 });
    await b.send({
      channel: "raw",
      payload: "hello",
      reliability: "unreliable",
      ordering: "unordered",
    });
    await a.send({ channel: "raw", payload: new Uint8Array([1, 2, 3]), binary: true });
    hub.drain();
    return trace;
  }

  it("reproduces an identical trace for the same seed", async () => {
    const first = await runScript(42);
    const second = await runScript(42);
    expect(first).toEqual(second);
    expect(first.length).toBeGreaterThan(0);
  });

  it("produces different traces for different seeds", async () => {
    const first = await runScript(42);
    const second = await runScript(43);
    expect(first).not.toEqual(second);
  });

  it("is reproducible across many seeds (fast-check)", async () => {
    await fcAssert(
      asyncProperty(fcInteger({ min: 0, max: 500 }), async (seed) => {
        const first = await runScript(seed);
        const second = await runScript(seed);
        expect(first).toEqual(second);
      }),
    );
  });
});
