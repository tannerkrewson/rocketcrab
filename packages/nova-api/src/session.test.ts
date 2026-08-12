/**
 * S1 session attach tests (P4 party lobby).
 *
 * `NovaSession.attach()` wires a session to a transport the party layer has
 * ALREADY joined (the P2/P3 `createParty`/`joinPartyByCode` flows join the
 * private room internally). These tests verify the session observes the
 * party it missed during transport establishment: current peers are
 * replayed, the connection status is seeded, and a peer that introduces
 * itself after our readiness announcement still learns we are ready
 * (the late-attach ready race).
 */
import { describe, expect, it } from "vitest";
import type { NovaTransport } from "@rocketcrab/core";
import { rawMessageBytes, rawRatePerSecond, rawWarnRatePerSecond } from "@rocketcrab/protocol";
import { InMemoryTransportHub } from "@rocketcrab/testing";
import { createNovaSession, type NovaSession } from "./session";

const ROOM = "party:attach-room";
const SESSION = "session-attach";

async function settle(hub: InMemoryTransportHub): Promise<void> {
  hub.drain();
  await Promise.resolve();
  hub.drain();
  await Promise.resolve();
}

/** A hub with two transports already joined (as the party layer would). */
async function makeJoinedPair(): Promise<{
  hub: InMemoryTransportHub;
  transportA: NovaTransport;
  transportB: NovaTransport;
}> {
  const hub = new InMemoryTransportHub({ seed: "nova-api-attach" });
  const transportA = hub.createTransport({ memberId: "member-a", displayName: "Ada" });
  const transportB = hub.createTransport({ memberId: "member-b", displayName: "Ben" });
  await transportA.join({ room: ROOM, sessionId: SESSION });
  await transportB.join({ room: ROOM, sessionId: SESSION });
  hub.drain();
  return { hub, transportA, transportB };
}

function makeSession(transport: NovaTransport, memberId: string, displayName: string): NovaSession {
  return createNovaSession({
    transport,
    room: ROOM,
    sessionId: SESSION,
    player: { memberId, displayName },
    game: { gameId: "game-1", mode: "state", title: "Attach Game" },
  });
}

describe("NovaSession.attach (already-joined transport)", () => {
  it("seeds the connection status and never calls transport.join", async () => {
    const { hub, transportA, transportB } = await makeJoinedPair();
    const a = makeSession(transportA, "member-a", "Ada");
    const b = makeSession(transportB, "member-b", "Ben");
    // Attaching to an already-joined transport must not throw the
    // "already joined" error transport.join() would raise.
    await a.attach();
    await b.attach();
    await settle(hub);
    expect(a.connectionStatus).toBe("connected");
    expect(b.connectionStatus).toBe("connected");
  });

  it("replays current peers so the session sees the party it missed", async () => {
    const { hub, transportA, transportB } = await makeJoinedPair();
    // A's session is created after B already joined the room: attach must
    // replay B into A's player list.
    const a = makeSession(transportA, "member-a", "Ada");
    await a.attach();
    expect(a.players).toContainEqual({ id: "member-b", name: "Ben" });

    // B attaches next: it missed A.
    const b = makeSession(transportB, "member-b", "Ben");
    await b.attach();
    expect(b.players).toContainEqual({ id: "member-a", name: "Ada" });
    await settle(hub);
    expect(a.players).toContainEqual({ id: "member-b", name: "Ben" });
    expect(b.players).toContainEqual({ id: "member-a", name: "Ada" });
  });

  it("a late-attaching peer still learns our readiness (identity re-announce)", async () => {
    const { hub, transportA, transportB } = await makeJoinedPair();
    // A is already ready before B's session exists (host registered early
    // and announced ready at party creation time).
    const a = makeSession(transportA, "member-a", "Ada");
    await a.attach();
    a.ready();
    await settle(hub);

    // B's session attaches afterwards; A's targeted readiness announcement
    // was already delivered, so B must learn A's readiness when its attach
    // introduces it to A (player.identity → targeted game.ready re-send).
    const b = makeSession(transportB, "member-b", "Ben");
    await b.attach();
    await settle(hub);

    expect(b.readyOf("member-a")).toBe(true);
    expect(a.readyOf("member-b")).toBe(false); // B has not announced yet
    b.ready();
    await settle(hub);
    expect(a.readyOf("member-b")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// A2 raw data-channel mode: channel lifecycle, mid-game joins, limits,
// transfer progress, and diagnostics (rocketcrab-9fv.5.2).
// ---------------------------------------------------------------------------

describe("NovaSession raw channels (A2)", () => {
  /** Two joined sessions (in-memory arena transport), seeded deterministically. */
  async function makeRawPair(): Promise<{
    hub: InMemoryTransportHub;
    a: NovaSession;
    b: NovaSession;
  }> {
    const hub = new InMemoryTransportHub({ seed: "nova-api-a2-raw" });
    const transportA = hub.createTransport({ memberId: "member-a", displayName: "Ada" });
    const transportB = hub.createTransport({ memberId: "member-b", displayName: "Ben" });
    const a = createNovaSession({
      transport: transportA,
      room: ROOM,
      sessionId: SESSION,
      player: { memberId: "member-a", displayName: "Ada" },
      game: { gameId: "game-1", mode: "raw", title: "Raw Game" },
    });
    const b = createNovaSession({
      transport: transportB,
      room: ROOM,
      sessionId: SESSION,
      player: { memberId: "member-b", displayName: "Ben" },
      game: { gameId: "game-1", mode: "raw", title: "Raw Game" },
    });
    await a.join();
    await b.join();
    await settle(hub);
    // Raw channels are only available after the game starts (S1 lifecycle).
    a.start();
    b.start();
    // The authority's start path resolves through async executor turns;
    // flush real macrotasks like the contract suite does.
    for (let i = 0; i < 2; i += 1) {
      for (let j = 0; j < 8; j += 1) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      hub.drain();
    }
    await Promise.resolve();
    return { hub, a, b };
  }

  it("records peer channel declarations and re-announces open channels to mid-game joiners", async () => {
    const { hub, a, b } = await makeRawPair();
    // Ada declares a channel; Ben learns it from the declaration broadcast.
    a.client.raw.createChannel({ name: "chat", reliable: true, ordered: true });
    a.client.raw.createChannel({ name: "positions", binary: true });
    await settle(hub);
    expect(b.getRawDiagnostics().channelCount).toBe(2);
    expect(b.getRawDiagnostics().selfDeclaredChannelCount).toBe(0);

    // Carol joins mid-game: she must learn Ada's open channels (A2
    // join/leave of peers mid-channel) so she can subscribe and send.
    const transportC = hub.createTransport({ memberId: "member-c", displayName: "Carol" });
    const c = createNovaSession({
      transport: transportC,
      room: ROOM,
      sessionId: SESSION,
      player: { memberId: "member-c", displayName: "Carol" },
      game: { gameId: "game-1", mode: "raw", title: "Raw Game" },
    });
    const cMessages: Array<{ channel: string; payload: unknown }> = [];
    c.client.raw.onMessage("chat", (message) =>
      cMessages.push({ channel: "chat", payload: message.payload }),
    );
    await c.join();
    await settle(hub);
    expect(c.getRawDiagnostics().channelCount).toBe(2);
    expect(c.getRawDiagnostics().selfDeclaredChannelCount).toBe(0);

    // Ada's sends reach Carol on a channel Carol never declared locally.
    a.client.raw.send("chat", { text: "hi carol" });
    await settle(hub);
    expect(cMessages).toHaveLength(1);
    expect(cMessages[0]?.payload).toEqual({ text: "hi carol" });
    expect(cMessages[0]?.channel).toBe("chat");
  });

  it("closes a channel: local sends fail and peers drop the declaration", async () => {
    const { hub, a, b } = await makeRawPair();
    a.client.raw.createChannel({ name: "chat" });
    b.client.raw.createChannel({ name: "chat" });
    await settle(hub);

    // Ada closes her declaration: her sends fail with unknown_channel
    // (delivered to onError, the documented raw-send failure channel), but
    // Ben's own declaration survives (closing is per-declaring-player).
    const aErrors: Array<{ code: string }> = [];
    a.client.onError((error) => aErrors.push({ code: error.code }));
    a.client.raw.close("chat");
    await settle(hub);
    a.client.raw.send("chat", "hi");
    await settle(hub);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(aErrors).toEqual([{ code: "unknown_channel" }]);
    expect(b.getRawDiagnostics().channelCount).toBe(1);
    expect(b.getRawDiagnostics().selfDeclaredChannelCount).toBe(1);

    // Ben still sends on his own declaration and Ada (subscribed) receives.
    const aMessages: unknown[] = [];
    a.client.raw.onMessage("chat", (message) => aMessages.push(message.payload));
    b.client.raw.send("chat", { text: "from ben" });
    await settle(hub);
    expect(aMessages).toEqual([{ text: "from ben" }]);

    // Closing an unknown channel is an idempotent no-op (A2 lifecycle rule).
    expect(() => a.client.raw.close("chat")).not.toThrow();
    expect(() => a.client.raw.close("nope")).not.toThrow();
  });

  it("never re-authorizes sends on a closed channel via peer re-announcements", async () => {
    const { hub, a, b } = await makeRawPair();
    a.client.raw.createChannel({ name: "chat" });
    b.client.raw.createChannel({ name: "chat" });
    await settle(hub);
    a.client.raw.close("chat");
    await settle(hub);

    // A reconnects: B re-announces its own "chat" declaration to A (peer
    // lifecycle mid-channel). The peer declaration must NOT re-authorize A
    // to send on the channel A closed.
    await a.transport.reconnect();
    await settle(hub);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const aErrors: Array<{ code: string }> = [];
    a.client.onError((error) => aErrors.push({ code: error.code }));
    a.client.raw.send("chat", "hi");
    await settle(hub);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(aErrors).toEqual([{ code: "unknown_channel" }]);
    expect(a.getRawDiagnostics().selfDeclaredChannelCount).toBe(0);
    expect(a.getRawDiagnostics().channelCount).toBe(1); // peer declaration only
  });

  it("drops a peer-closed channel when this session did not declare it", async () => {
    const { hub, a, b } = await makeRawPair();
    a.client.raw.createChannel({ name: "chat" });
    await settle(hub);
    expect(b.getRawDiagnostics().channelCount).toBe(1);

    // Ada closes; Ben's recorded peer declaration disappears.
    a.client.raw.close("chat");
    await settle(hub);
    expect(b.getRawDiagnostics().channelCount).toBe(0);
  });

  it("rejects oversized raw payloads with a clear diagnostic", async () => {
    const { hub, a, b } = await makeRawPair();
    a.client.raw.createChannel({ name: "big" });
    b.client.raw.createChannel({ name: "big" });
    await settle(hub);
    const oversized = "x".repeat(rawMessageBytes + 1);
    await expect(a.sendRaw("big", oversized)).rejects.toMatchObject({
      code: "payload_too_large",
    });
    expect(a.getRawDiagnostics().oversizedRejections).toBe(1);
    // The oversized send never reached Ben.
    expect(b.getRawDiagnostics().receivedCount).toBe(0);
  });

  it("rejects sends beyond the per-second rate limit with diagnostics", async () => {
    const { hub, a, b } = await makeRawPair();
    a.client.raw.createChannel({ name: "chat" });
    b.client.raw.createChannel({ name: "chat" });
    await settle(hub);
    let rejected = 0;
    const capacity = rawRatePerSecond * 10 + 5;
    for (let i = 0; i < capacity; i += 1) {
      try {
        await a.sendRaw("chat", { i });
      } catch (error) {
        if (error instanceof Error && (error as { code?: string }).code === "rate_limited") {
          rejected += 1;
        } else {
          throw error;
        }
      }
    }
    expect(rejected).toBeGreaterThan(0);
    expect(a.getRawDiagnostics().rateLimitRejections).toBe(rejected);
    expect(a.getRawDiagnostics().ratePerSecond).toBeGreaterThan(rawWarnRatePerSecond);
    expect(a.getRawDiagnostics().warned).toBe(true);
  });

  it("forwards sender-side transfer progress for chunked payloads", async () => {
    const { hub, a, b } = await makeRawPair();
    a.client.raw.createChannel({ name: "big" });
    b.client.raw.createChannel({ name: "big" });
    const progress: number[] = [];
    const payload = new Uint8Array(200 * 1024).fill(7); // ~200 KiB → chunked
    await a.sendRaw("big", payload, {
      onProgress(observation) {
        progress.push(observation.fraction);
      },
    });
    await settle(hub);
    expect(progress.length).toBeGreaterThan(0);
    expect(progress[progress.length - 1]).toBe(1);
    const received = b.getRawDiagnostics();
    expect(received.receivedCount).toBe(1);
    expect(received.receivedBytes).toBe(payload.byteLength);
  });

  it("counts sent and received bytes in diagnostics", async () => {
    const { hub, a, b } = await makeRawPair();
    a.client.raw.createChannel({ name: "chat" });
    b.client.raw.createChannel({ name: "chat" });
    await settle(hub);
    void a.sendRaw("chat", { text: "hello" });
    await settle(hub);
    expect(a.getRawDiagnostics().sentCount).toBe(1);
    expect(a.getRawDiagnostics().sentBytes).toBe(16);
    expect(b.getRawDiagnostics().receivedCount).toBe(1);
    expect(b.getRawDiagnostics().receivedBytes).toBe(16);
  });
});
