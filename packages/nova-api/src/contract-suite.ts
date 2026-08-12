/**
 * Transport-agnostic Nova session contract suite (S1).
 *
 * `runNovaSessionContractTests` runs the same two-player game scenarios
 * against any {@link NovaTransport} implementation provided by a harness.
 * InMemoryTransport (the test arena, U5) runs it today; TrysteroTransport
 * (real parties, P1) must pass the same suite (ADR-0003: the game-facing
 * API behaves identically over both transports).
 *
 * The suite drives sessions directly (register → join → ready → start →
 * play) and asserts every S1 concept functions over the transport: player
 * lists and join/leave subscriptions, connection status, the ready
 * lifecycle, game start/end, dispatch, state subscription, raw channels
 * (JSON and binary, broadcast and targeted), simulation inputs, and clear
 * errors for invalid inbound messages.
 *
 * Import as `@rocketcrab/nova-api/contract-suite` (vitest is a
 * devDependency of this package; the suite is test infrastructure).
 */
import { describe, expect, it } from "vitest";
import type { NovaTransport } from "@rocketcrab/core";
import {
  PROTOCOL_VERSION,
  assertPeerMessage,
  stateSnapshotMessageSchema,
} from "@rocketcrab/protocol";
import { createNovaSession, type NovaSession } from "./session";
import type { NovaPlayer, NovaRawMessage, NovaSimulationInput } from "./types";

/** A transport factory plus a deterministic delivery pump (see module docs). */
export interface NovaTransportHarness {
  /** Create a fresh idle transport for one player. */
  createTransport(identity: { memberId: string; displayName?: string }): NovaTransport;
  /** Synchronously deliver every pending message (in-memory hub). */
  drain(): void;
}

const ROOM = "contract-room";
const SESSION = "session-contract";

interface Pair {
  harness: NovaTransportHarness;
  a: NovaSession;
  b: NovaSession;
}

async function settle(harness: NovaTransportHarness): Promise<void> {
  harness.drain();
  await Promise.resolve();
}

/** Create two joined sessions over a fresh harness. */
async function makePair(
  harnessFactory: () => NovaTransportHarness,
  setup?: (a: NovaSession, b: NovaSession) => void,
): Promise<Pair> {
  const harness = harnessFactory();
  const transportA = harness.createTransport({ memberId: "member-a", displayName: "Ada" });
  const transportB = harness.createTransport({ memberId: "member-b", displayName: "Ben" });
  const a = createNovaSession({
    transport: transportA,
    room: ROOM,
    sessionId: SESSION,
    player: { memberId: "member-a", displayName: "Ada" },
    game: { gameId: "game-1", mode: "state", title: "Contract Game" },
  });
  const b = createNovaSession({
    transport: transportB,
    room: ROOM,
    sessionId: SESSION,
    player: { memberId: "member-b", displayName: "Ben" },
    game: { gameId: "game-1", mode: "state", title: "Contract Game" },
  });
  a.client.defineGame({ title: "Contract Game", mode: "state" });
  b.client.defineGame({ title: "Contract Game", mode: "state" });
  setup?.(a, b); // subscribe before the first join so no event is missed
  await a.join();
  await b.join();
  await settle(harness);
  return { harness, a, b };
}

/** Start both sessions the way a host/arena policy would. */
function startBoth(pair: Pair): void {
  pair.a.start();
  pair.b.start();
}

export function runNovaSessionContractTests(harnessFactory: () => NovaTransportHarness): void {
  describe("Nova session contract (transport-neutral)", () => {
    it("registers a game and exposes the current player", async () => {
      const { a, b } = await makePair(harnessFactory);
      expect(a.client.player).toEqual({ id: "member-a", name: "Ada" });
      expect(b.client.player).toEqual({ id: "member-b", name: "Ben" });
      expect(a.client.version).toBe(1);
      expect(a.declaration).toEqual({ title: "Contract Game", mode: "state" });
      expect(b.declaration).toEqual({ title: "Contract Game", mode: "state" });
    });

    it("tracks the player list and fires join/leave subscriptions", async () => {
      const aJoined: NovaPlayer[] = [];
      const aLeft: NovaPlayer[] = [];
      const bJoined: NovaPlayer[] = [];
      const { harness, a, b } = await makePair(harnessFactory, (aSession, bSession) => {
        aSession.client.onPlayerJoin((player) => aJoined.push(player));
        aSession.client.onPlayerLeave((player) => aLeft.push(player));
        bSession.client.onPlayerJoin((player) => bJoined.push(player));
      });
      expect(a.client.players).toEqual([
        { id: "member-a", name: "Ada" },
        { id: "member-b", name: "Ben" },
      ]);
      expect(b.client.players).toEqual([
        { id: "member-b", name: "Ben" },
        { id: "member-a", name: "Ada" },
      ]);
      expect(aJoined).toHaveLength(1);
      expect(aJoined[0]).toEqual({ id: "member-b", name: "Ben" });
      expect(bJoined).toHaveLength(1);
      expect(bJoined[0]).toEqual({ id: "member-a", name: "Ada" });

      await b.leave();
      await settle(harness);
      expect(aLeft).toHaveLength(1);
      expect(aLeft[0]).toEqual({ id: "member-b", name: "Ben" });
      expect(a.client.players).toEqual([{ id: "member-a", name: "Ada" }]);
    });

    it("reports connection status changes", async () => {
      const harness = harnessFactory();
      const transport = harness.createTransport({ memberId: "member-a", displayName: "Ada" });
      const session = createNovaSession({
        transport,
        room: ROOM,
        sessionId: SESSION,
        player: { memberId: "member-a", displayName: "Ada" },
        game: { gameId: "game-1", mode: "state" },
      });
      const statuses: string[] = [];
      session.client.onConnectionChange((status) => statuses.push(status));
      expect(session.client.connectionStatus).toBe("disconnected");
      await session.join();
      await settle(harness);
      expect(session.client.connectionStatus).toBe("connected");
      expect(statuses).toContain("connecting");
      expect(statuses).toContain("connected");
    });

    it("propagates the ready lifecycle and game start over the transport", async () => {
      const harness = harnessFactory();
      const transportA = harness.createTransport({ memberId: "member-a", displayName: "Ada" });
      const transportB = harness.createTransport({ memberId: "member-b", displayName: "Ben" });
      const a = createNovaSession({
        transport: transportA,
        room: ROOM,
        sessionId: SESSION,
        player: { memberId: "member-a", displayName: "Ada" },
        game: { gameId: "game-1", mode: "state" },
      });
      const b = createNovaSession({
        transport: transportB,
        room: ROOM,
        sessionId: SESSION,
        player: { memberId: "member-b", displayName: "Ben" },
        game: { gameId: "game-1", mode: "state" },
      });
      const aStarted: number[] = [];
      const bStarted: number[] = [];
      a.client.defineGame({ title: "Ready Game" });
      b.client.defineGame({ title: "Ready Game" });
      // ready() before the transport connects exercises the session outbox.
      a.client.ready();
      b.client.ready();
      a.client.onStart(() => aStarted.push(Date.now()));
      b.client.onStart(() => bStarted.push(Date.now()));

      await a.join();
      await b.join();
      await settle(harness);
      // Readiness crossed the transport (B knows A is ready and vice versa).
      expect(b.readyOf("member-a")).toBe(true);
      expect(a.readyOf("member-b")).toBe(true);
      expect(bStarted).toHaveLength(0); // start is host policy, not automatic

      a.start();
      await settle(harness);
      expect(aStarted).toHaveLength(1);
      expect(bStarted).toHaveLength(1);
      expect(a.isStarted()).toBe(true);
      expect(b.isStarted()).toBe(true);
    });

    it("propagates game end over the transport", async () => {
      const { harness, a, b } = await makePair(harnessFactory);
      const aEnded: string[] = [];
      const bEnded: string[] = [];
      a.client.onEnd((reason) => aEnded.push(reason));
      b.client.onEnd((reason) => bEnded.push(reason));

      b.end("user_exit");
      await settle(harness);
      expect(aEnded).toEqual(["user_exit"]);
      expect(bEnded).toEqual(["user_exit"]);
      expect(a.isEnded()).toBe(true);
      expect(b.isEnded()).toBe(true);
      // Idempotent: a second end is ignored.
      a.end("error");
      await settle(harness);
      expect(aEnded).toEqual(["user_exit"]);
    });

    it("dispatches actions over the transport", async () => {
      const { harness, a, b } = await makePair(harnessFactory);
      startBoth({ harness, a, b });
      const received: Array<{ type: string; payload: unknown }> = [];
      b.onSessionEvent((event) => {
        if (event.type === "actionReceived") {
          received.push({ type: event.action.type, payload: event.action.payload });
        }
      });
      const sent = a.client.dispatch({ type: "playCard", payload: { card: "ace" } });
      await settle(harness);
      await expect(sent).resolves.toBeUndefined();
      expect(received).toHaveLength(1);
      expect(received[0]).toEqual({ type: "playCard", payload: { card: "ace" } });
    });

    it("delivers state snapshots to state subscribers", async () => {
      const { harness, a, b } = await makePair(harnessFactory);
      const changes: unknown[] = [];
      b.client.state.onChange((state) => changes.push(state));
      expect(b.client.state.get()).toBeNull();

      // S2 owns the publishing side; for S1 the receive path is exercised
      // with a schema-valid state.snapshot sent over the protocol channel.
      await a.transport.send({
        channel: "nova.protocol",
        payload: assertPeerMessage(
          stateSnapshotMessageSchema.parse({
            version: PROTOCOL_VERSION,
            sessionId: SESSION,
            senderMemberId: "member-a",
            senderConnectionId: a.transport.selfConnectionId,
            messageId: "snapshot-1",
            sentAt: 1_700_000_000_000,
            seq: 1,
            type: "state.snapshot",
            revision: 1,
            term: 1,
            authorityMemberId: "member-a",
            processedActionIds: [],
            state: { deck: ["ace"] },
          }),
        ),
        version: PROTOCOL_VERSION,
        reliability: "reliable",
        ordering: "ordered",
      });
      await settle(harness);
      expect(b.client.state.get()).toEqual({ deck: ["ace"] });
      expect(changes).toHaveLength(1);
      expect(changes[0]).toEqual({ deck: ["ace"] });
    });

    it("exchanges raw channel messages, targeted and binary", async () => {
      const { harness, a, b } = await makePair(harnessFactory);
      startBoth({ harness, a, b });
      const aReceived: NovaRawMessage[] = [];
      const bReceived: NovaRawMessage[] = [];
      a.client.raw.createChannel({ name: "chat", reliable: true, ordered: true });
      b.client.raw.createChannel({ name: "chat", reliable: true, ordered: true });
      a.client.raw.createChannel({ name: "positions", binary: true });
      b.client.raw.createChannel({ name: "positions", binary: true });
      a.client.raw.onMessage("chat", (message) => aReceived.push(message));
      b.client.raw.onMessage("chat", (message) => bReceived.push(message));
      a.client.raw.onMessage("positions", (message) => aReceived.push(message));
      b.client.raw.onMessage("positions", (message) => bReceived.push(message));

      a.client.raw.send("chat", { text: "hello" });
      b.client.raw.send("chat", { text: "hi" }, { to: "member-a" });
      a.client.raw.send("positions", new Uint8Array([1, 2, 3]));
      await settle(harness);

      expect(bReceived[0]?.payload).toEqual({ text: "hello" });
      expect(bReceived[0]?.binary).toBe(false);
      expect(bReceived[1]?.binary).toBe(true);
      const binary = bReceived[1]?.payload;
      expect(binary instanceof Uint8Array).toBe(true);
      expect(Array.from(binary as Uint8Array)).toEqual([1, 2, 3]);
      expect(aReceived).toHaveLength(1); // targeted send only reaches Ada
      expect(aReceived[0]?.payload).toEqual({ text: "hi" });
      expect(aReceived[0]?.from).toEqual({ id: "member-b", name: "Ben" });
    });

    it("routes simulation inputs to registered handlers", async () => {
      const { harness, a, b } = await makePair(harnessFactory);
      startBoth({ harness, a, b });
      const received: NovaSimulationInput[] = [];
      let sender: NovaPlayer | null = null;
      b.client.simulation.register({
        onInput(input) {
          received.push({ type: input.type, payload: input.payload, tick: input.tick });
          sender = input.sender;
        },
      });
      a.client.simulation.sendInput({ type: "move", payload: { dx: 1 }, tick: 3 });
      await settle(harness);
      expect(received).toHaveLength(1);
      expect(received[0]).toEqual({ type: "move", payload: { dx: 1 }, tick: 3 });
      expect(sender).toEqual({ id: "member-a", name: "Ada" });
    });

    it("reports invalid inbound protocol messages as clear errors", async () => {
      const { harness, a, b } = await makePair(harnessFactory);
      const errors: Array<{ code: string; message: string }> = [];
      b.client.onError((error) => errors.push({ code: error.code, message: error.message }));
      await a.transport.send({
        channel: "nova.protocol",
        payload: { version: 1, type: "party.identity", junk: true },
      });
      await settle(harness);
      expect(errors).toHaveLength(1);
      expect(errors[0]?.code).toBe("invalid_message");
      expect(errors[0]?.message).toContain("protocol message");
    });
  });
}
