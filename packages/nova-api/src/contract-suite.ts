/**
 * Transport-agnostic Nova session contract suite.
 *
 * `runNovaSessionContractTests` runs the same two-player game scenarios
 * against any {@link NovaTransport} implementation provided by a harness.
 * InMemoryTransport (the test arena) and TrysteroTransport
 * (real parties) must pass the same suite (ADR-0003: the game-facing
 * API behaves identically over both transports).
 *
 * state mode is exercised through the same transport-neutral seam games
 * use in the arena: handlers registered via `nova.defineGame` run
 * in-process (LocalGameExecutor, immer), so the suite covers initial
 * state, revisioned snapshots, per-player views, sequential application,
 * exactly-once deduplication, late joining, rejections, and diagnostics —
 * over any transport.
 *
 * Import as `@rocketcrab/nova-api/contract-suite` (vitest is a
 * devDependency of this package; the suite is test infrastructure).
 */
import { describe, expect, it, vi } from "vitest";
import type { NovaTransport } from "@rocketcrab/core";
import { PROTOCOL_VERSION, assertPeerMessage } from "@rocketcrab/protocol";
import { createNovaSession, type NovaSession } from "./session";
import { buildActionDispatchMessage, type PeerMessageBase } from "./messages";
import type { NovaPlayer, NovaStateHandlers, NovaTickContext } from "./types";

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

/**
 * Drain + flush: the state engine's async apply path and sha256 hashing
 * need real event-loop turns, so tests settle with a few macrotasks between
 * drains (deterministic — the in-memory hub only delivers on drain()).
 */
async function settle(harness: NovaTransportHarness): Promise<void> {
  for (let i = 0; i < 2; i += 1) {
    await flushMacrotasks();
    harness.drain();
  }
  await flushMacrotasks();
}

async function flushMacrotasks(): Promise<void> {
  for (let i = 0; i < 8; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  await Promise.resolve();
}

/** The contract-suite test game: draw cards from a shared deck. */
export function contractGameHandlers(): NovaStateHandlers {
  return {
    createInitialState: () => ({
      deck: ["ace", "king", "queen"],
      hands: {} as Record<string, string>,
      log: [] as string[],
    }),
    actions: {
      drawCard(draft: { deck: string[]; hands: Record<string, string>; log: string[] }, context) {
        const actor = context.actor;
        if (actor === undefined) throw new Error("drawCard requires an actor");
        if (draft.hands[actor.id] !== undefined) {
          throw new Error("already drew a card");
        }
        const card = draft.deck.pop();
        if (card === undefined) throw new Error("deck is empty");
        draft.hands[actor.id] = card;
        draft.log.push(`${actor.id} drew ${card}`);
      },
    },
    selectView: (state: { deck: string[]; hands: Record<string, string> }, viewer) => ({
      hand: state.hands[viewer.id],
      deckCount: state.deck.length,
    }),
  };
}

/** Create two joined sessions over a fresh harness. */
async function makePair(
  harnessFactory: () => NovaTransportHarness,
  options:
    | { handlers?: NovaStateHandlers; setup?: (a: NovaSession, b: NovaSession) => void }
    | ((a: NovaSession, b: NovaSession) => void) = {},
): Promise<Pair> {
  const config = typeof options === "function" ? { setup: options } : options;
  const harness = harnessFactory();
  const transportA = harness.createTransport({ memberId: "member-a", displayName: "Ada" });
  const transportB = harness.createTransport({ memberId: "member-b", displayName: "Ben" });
  const a = createNovaSession({
    transport: transportA,
    room: ROOM,
    sessionId: SESSION,
    player: { memberId: "member-a", displayName: "Ada" },
    game: { gameId: "game-1", title: "Contract Game" },
  });
  const b = createNovaSession({
    transport: transportB,
    room: ROOM,
    sessionId: SESSION,
    player: { memberId: "member-b", displayName: "Ben" },
    game: { gameId: "game-1", title: "Contract Game" },
  });
  a.client.defineGame({ title: "Contract Game", ...config.handlers });
  b.client.defineGame({ title: "Contract Game", ...config.handlers });
  config.setup?.(a, b); // subscribe before the first join so no event is missed
  await a.join();
  await b.join();
  await settle(harness);
  return { harness, a, b };
}

/** A session's replicated canonical state (undefined before the first). */
function canonicalOf(session: NovaSession): unknown {
  return session.getCanonicalState()?.state;
}

/** Start both sessions the way a host/arena policy would. */
async function startBoth(pair: Pair): Promise<void> {
  pair.a.start();
  pair.b.start();
  await settle(pair.harness);
}

/** A bare action.dispatch sent directly over the transport (dedup tests). */
function buildInjectedDispatch(
  base: PeerMessageBase,
  input: Parameters<typeof buildActionDispatchMessage>[1],
) {
  return buildActionDispatchMessage(base, input);
}

/**
 * Poll with real time + drain: the in-memory hub only delivers on drain()
 * and the tick clock is driven by real timers.
 */
async function waitForTicks(
  harness: NovaTransportHarness,
  condition: () => boolean,
  what: string,
  timeoutMs = 5_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await settle(harness);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

export function runNovaSessionContractTests(harnessFactory: () => NovaTransportHarness): void {
  describe("Nova session contract (transport-neutral)", () => {
    it("charges actions against a refillable per-player byte budget", async () => {
      const { a, b } = await makePair(harnessFactory);
      const warnings: string[] = [];
      a.onSessionEvent((event) => {
        if (event.type === "bandwidthWarning") warnings.push(event.message);
      });
      const now = performance.now();
      const clock = vi.spyOn(performance, "now").mockReturnValue(now);
      try {
        const payload = "x".repeat(15 * 1024);
        let limited: unknown = null;
        for (let i = 0; i < 80 && limited === null; i += 1) {
          await a.dispatch({ type: "large", payload }, `budget-${i}`).catch((error: unknown) => {
            limited = error;
          });
        }
        expect(warnings).toHaveLength(1);
        expect(limited).toMatchObject({ code: "rate_limited" });
        // Each player has their own budget.
        await expect(b.dispatch({ type: "large", payload }, "budget-b")).resolves.toBeUndefined();
        // The budget refills over time.
        clock.mockReturnValue(now + 1000);
        await expect(
          a.dispatch({ type: "large", payload }, "budget-refill"),
        ).resolves.toBeUndefined();
      } finally {
        clock.mockRestore();
      }
    });

    it("registers a game and exposes the current player", async () => {
      const { a, b } = await makePair(harnessFactory);
      expect(a.client.player).toEqual({ id: "member-a", name: "Ada" });
      expect(b.client.player).toEqual({ id: "member-b", name: "Ben" });
      expect(a.client.version).toBe(1);
      // The declaration is plain data: handler functions never cross.
      expect(a.declaration).toEqual({ title: "Contract Game" });
      expect(b.declaration).toEqual({ title: "Contract Game" });
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
        game: { gameId: "game-1" },
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
        game: { gameId: "game-1" },
      });
      const b = createNovaSession({
        transport: transportB,
        room: ROOM,
        sessionId: SESSION,
        player: { memberId: "member-b", displayName: "Ben" },
        game: { gameId: "game-1" },
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
      b.start();
      await settle(harness);
      expect(aStarted).toHaveLength(1);
      expect(bStarted).toHaveLength(1);
      expect(a.isStarted()).toBe(true);
      expect(b.isStarted()).toBe(true);
      // Even without declared handlers, the default initial state {} commits.
      expect(a.getStateModeDiagnostics().revision).toBe(1);
      expect(b.getStateModeDiagnostics().revision).toBe(1);
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

    // ------------------------------------------------------------------
    // state mode
    // ------------------------------------------------------------------

    it("creates the initial state and delivers each player's selected view", async () => {
      const { harness, a, b } = await makePair(harnessFactory, {
        handlers: contractGameHandlers(),
      });
      expect(b.client.state.get()).toBeNull();
      await startBoth({ harness, a, b });
      // Frames receive only their selected view — never the full state.
      expect(a.client.state.get()).toEqual({ hand: undefined, deckCount: 3 });
      expect(b.client.state.get()).toEqual({ hand: undefined, deckCount: 3 });
      // Shells retain the canonical state for migration (host-side only).
      const canonical = a.getCanonicalState();
      expect(canonical?.revision).toBe(1);
      expect(canonical?.state).toEqual({
        deck: ["ace", "king", "queen"],
        hands: {},
        log: [],
      });
      expect(canonical?.stateHash).toMatch(/^[0-9a-f]{64}$/);
      expect(a.getStateModeDiagnostics().authorityMemberId).toBe("member-a");
      expect(b.getStateModeDiagnostics().authorityMemberId).toBe("member-a");
    });

    it("gives handlers a context that is the same on every device", async () => {
      const contexts: Array<Record<string, unknown>> = [];
      const { harness, a, b } = await makePair(harnessFactory, {
        handlers: {
          createInitialState: (context) => {
            contexts.push({ ...context });
            return { n: 0 };
          },
          actions: {
            bump: (draft: { n: number }, context) => {
              contexts.push({ ...context });
              draft.n += 1;
            },
          },
        },
      });
      await startBoth({ harness, a, b });
      await b.client.dispatch({ type: "bump" });
      await settle(harness);
      const players = [
        { id: "member-a", name: "Ada" },
        { id: "member-b", name: "Ben" },
      ];
      expect(contexts).toHaveLength(2);
      expect(Object.keys(contexts[0]!).sort()).toEqual(["now", "players", "revision"]);
      expect(contexts[0]!.players).toEqual(players);
      expect(Object.keys(contexts[1]!).sort()).toEqual(["actor", "now", "players", "revision"]);
      expect(contexts[1]!.actor).toEqual({ id: "member-b", name: "Ben" });
      expect(contexts[1]!.players).toEqual(players);
    });

    it("applies actions on the authority and updates every player's view", async () => {
      const { harness, a, b } = await makePair(harnessFactory, {
        handlers: contractGameHandlers(),
      });
      await startBoth({ harness, a, b });
      const bChanges: unknown[] = [];
      b.client.state.onChange((state) => bChanges.push(state));

      await expect(a.client.dispatch({ type: "drawCard" })).resolves.toBeUndefined();
      await settle(harness);

      const diagnostics = a.getStateModeDiagnostics();
      expect(diagnostics.revision).toBe(2);
      expect(diagnostics.stateSizeBytes).toBeGreaterThan(0);
      expect(diagnostics.stateHash).toMatch(/^[0-9a-f]{64}$/);
      expect(diagnostics.appliedCount).toBe(2); // initial commit + action
      // The action ran through Immer with the actor in context.
      const canonical = a.getCanonicalState();
      expect(canonical?.state).toMatchObject({
        log: ["member-a drew queen"],
        hands: { "member-a": "queen" },
      });
      // Both players see their own view: Ada has the card, Ben doesn't.
      expect(a.client.state.get()).toEqual({ hand: "queen", deckCount: 2 });
      expect(b.client.state.get()).toEqual({ hand: undefined, deckCount: 2 });
      // Subscribed after start, so only the action's view is observed.
      expect(bChanges).toHaveLength(1);
      expect(bChanges[0]).toEqual({ hand: undefined, deckCount: 2 });
    });

    it("round-trips omitted, undefined and null remote action payloads through JSON transport", async () => {
      const jsonHarness = (): NovaTransportHarness => {
        const harness = harnessFactory();
        return {
          drain: () => harness.drain(),
          createTransport: (identity) => {
            const transport = harness.createTransport(identity);
            const send = transport.send.bind(transport);
            transport.send = (message) =>
              send({ ...message, payload: JSON.parse(JSON.stringify(message.payload)) as unknown });
            return transport;
          },
        };
      };
      const received: unknown[] = [];
      const { harness, a, b } = await makePair(jsonHarness, {
        handlers: {
          createInitialState: () => ({ count: 0 }),
          actions: {
            record(draft: { count: number }, _context, payload) {
              received.push(payload);
              draft.count += 1;
            },
          },
        },
      });
      await startBoth({ harness, a, b });
      for (const action of [
        { type: "record" },
        { type: "record", payload: undefined },
        { type: "record", payload: null },
        { type: "record", payload: {} },
      ]) {
        const dispatched = b.client.dispatch(action);
        await settle(harness);
        await expect(dispatched).resolves.toBeUndefined();
      }
      expect(received).toEqual([undefined, undefined, null, {}]);
      expect(a.getCanonicalState()?.state).toEqual({ count: 4 });
      await a.leave();
      await b.leave();
    });

    it("rejects invalid actions without mutating state", async () => {
      const { harness, a, b } = await makePair(harnessFactory, {
        handlers: contractGameHandlers(),
      });
      await startBoth({ harness, a, b });
      await expect(a.client.dispatch({ type: "noSuchAction" })).rejects.toMatchObject({
        code: "unknown_action",
      });
      await expect(a.client.dispatch({ type: "drawCard", baseRevision: 0 })).rejects.toMatchObject({
        code: "stale_revision",
      });
      await settle(harness);
      expect(a.getStateModeDiagnostics().revision).toBe(1); // nothing committed
      expect(a.getStateModeDiagnostics().rejectedCount).toBe(2);
      expect(a.getCanonicalState()?.state).toMatchObject({ hands: {} });
    });

    it("processes duplicate actions exactly once and replays the ack", async () => {
      const { harness, a, b } = await makePair(harnessFactory, {
        handlers: contractGameHandlers(),
      });
      await startBoth({ harness, a, b });
      // Inject the same action twice from Ben (as a transport re-delivery).
      const base: PeerMessageBase = {
        sessionId: SESSION,
        senderMemberId: "member-b",
        senderConnectionId: b.transport.selfConnectionId,
      };
      const dispatch = buildInjectedDispatch(base, {
        seq: 1,
        actionId: "action-dup-1",
        baseRevision: 1,
        actionType: "drawCard",
        payload: {},
      });
      await b.transport.send({
        channel: "nova.protocol",
        payload: dispatch,
        version: PROTOCOL_VERSION,
        reliability: "reliable",
        ordering: "ordered",
      });
      await settle(harness);
      expect(a.getStateModeDiagnostics().revision).toBe(2);
      await b.transport.send({
        channel: "nova.protocol",
        payload: buildInjectedDispatch(base, {
          seq: 1,
          actionId: "action-dup-1",
          baseRevision: 1,
          actionType: "drawCard",
          payload: {},
        }),
        version: PROTOCOL_VERSION,
        reliability: "reliable",
        ordering: "ordered",
      });
      await settle(harness);
      // Exactly once: the deck lost only one card.
      expect(a.getStateModeDiagnostics().revision).toBe(2);
      expect(a.getCanonicalState()?.state).toMatchObject({
        deck: ["ace", "king"],
        hands: { "member-b": "queen" },
      });
      // The duplicate got a replayed ack, so a reconnecting dispatcher's
      // frame learns the result without a second application.
      const acks: string[] = [];
      b.onSessionEvent((event) => {
        if (event.type === "actionAck") acks.push(event.ack.actionId);
      });
      await b.transport.send({
        channel: "nova.protocol",
        payload: buildInjectedDispatch(base, {
          seq: 1,
          actionId: "action-dup-1",
          baseRevision: 1,
          actionType: "drawCard",
          payload: {},
        }),
        version: PROTOCOL_VERSION,
        reliability: "reliable",
        ordering: "ordered",
      });
      await settle(harness);
      expect(acks.filter((id) => id === "action-dup-1")).toHaveLength(1);
    });

    it("delivers state to late joiners: snapshot, view, and start", async () => {
      const harness = harnessFactory();
      const transportA = harness.createTransport({ memberId: "member-a", displayName: "Ada" });
      const a = createNovaSession({
        transport: transportA,
        room: ROOM,
        sessionId: SESSION,
        player: { memberId: "member-a", displayName: "Ada" },
        game: { gameId: "game-1", title: "Contract Game" },
      });
      a.client.defineGame({ title: "Contract Game", ...contractGameHandlers() });
      await a.join();
      await settle(harness);
      a.start();
      await settle(harness);
      await a.client.dispatch({ type: "drawCard" });
      await settle(harness);
      expect(a.getStateModeDiagnostics().revision).toBe(2);

      // A third player joins after the game started.
      const transportC = harness.createTransport({ memberId: "member-c", displayName: "Cara" });
      const c = createNovaSession({
        transport: transportC,
        room: ROOM,
        sessionId: SESSION,
        player: { memberId: "member-c", displayName: "Cara" },
        game: { gameId: "game-1", title: "Contract Game" },
      });
      c.client.defineGame({ title: "Contract Game", ...contractGameHandlers() });
      const cStarted: number[] = [];
      const cChanges: unknown[] = [];
      c.client.onStart(() => cStarted.push(1));
      c.client.state.onChange((state) => cChanges.push(state));
      await c.join();
      await settle(harness);
      expect(cStarted).toHaveLength(1); // late joiners start from the snapshot
      expect(c.client.state.get()).toEqual({ hand: undefined, deckCount: 2 });
      expect(c.getStateModeDiagnostics().revision).toBe(2);
      expect(c.getStateModeDiagnostics().authorityMemberId).toBe("member-a");
      // Cara can now play.
      await expect(c.client.dispatch({ type: "drawCard" })).resolves.toBeUndefined();
      await settle(harness);
      expect(c.getStateModeDiagnostics().revision).toBe(3);
      expect(c.client.state.get()).toEqual({ hand: "king", deckCount: 1 });
      expect(a.getCanonicalState()?.state).toMatchObject({
        hands: { "member-a": "queen", "member-c": "king" },
      });
    });

    it("keeps the last committed state when the authority runtime fails", async () => {
      const harness = harnessFactory();
      const transportA = harness.createTransport({ memberId: "member-a", displayName: "Ada" });
      const transportB = harness.createTransport({ memberId: "member-b", displayName: "Ben" });
      let failNext = false;
      const executor = {
        createInitialState: async () => ({
          ok: true as const,
          state: { deck: ["ace"], hands: {} as Record<string, string> },
          views: {
            "member-a": { hand: undefined, deckCount: 1 },
            "member-b": { hand: undefined, deckCount: 1 },
          },
        }),
        applyAction: async () => {
          if (failNext) {
            return { ok: false as const, code: "execution_failed", message: "frame crashed" };
          }
          return {
            ok: true as const,
            state: { deck: [], hands: { "member-a": "ace" } },
            views: {
              "member-a": { hand: "ace", deckCount: 0 },
              "member-b": { hand: undefined, deckCount: 0 },
            },
          };
        },
        computeView: async () => ({ ok: false as const, code: "view_error", message: "no view" }),
      };
      const a = createNovaSession({
        transport: transportA,
        room: ROOM,
        sessionId: SESSION,
        player: { memberId: "member-a", displayName: "Ada" },
        game: { gameId: "game-1" },
        stateExecutor: executor,
      });
      const b = createNovaSession({
        transport: transportB,
        room: ROOM,
        sessionId: SESSION,
        player: { memberId: "member-b", displayName: "Ben" },
        game: { gameId: "game-1" },
      });
      a.client.defineGame({ title: "Contract Game" });
      b.client.defineGame({ title: "Contract Game" });
      await a.join();
      await b.join();
      await settle(harness);
      a.start();
      b.start();
      await settle(harness);
      expect(a.getStateModeDiagnostics().revision).toBe(1);

      failNext = true;
      await expect(a.client.dispatch({ type: "drawCard" })).rejects.toMatchObject({
        code: "execution_failed",
      });
      await settle(harness);
      // The last committed state is intact.
      expect(a.getStateModeDiagnostics().revision).toBe(1);
      expect(a.getCanonicalState()?.state).toEqual({
        deck: ["ace"],
        hands: {},
      });
      expect(b.getCanonicalState()?.state).toEqual({ deck: ["ace"], hands: {} });
    });

    it("exposes state-size and action-rate diagnostics", async () => {
      const { harness, a, b } = await makePair(harnessFactory, {
        handlers: contractGameHandlers(),
      });
      await startBoth({ harness, a, b });
      const committed: Array<{
        revision: number;
        stateSizeBytes: number;
        actionRatePerSecond: number;
      }> = [];
      a.onSessionEvent((event) => {
        if (event.type === "stateCommitted") {
          committed.push({
            revision: event.revision,
            stateSizeBytes: event.stateSizeBytes,
            actionRatePerSecond: event.actionRatePerSecond,
          });
        }
      });
      await a.client.dispatch({ type: "drawCard" });
      await settle(harness);
      const diagnostics = a.getStateModeDiagnostics();
      expect(diagnostics.revision).toBe(2);
      expect(diagnostics.stateSizeBytes).toBeGreaterThan(0);
      expect(diagnostics.stateHash).toMatch(/^[0-9a-f]{64}$/);
      expect(diagnostics.appliedCount).toBeGreaterThanOrEqual(2);
      expect(committed).toHaveLength(1); // the drawCard commit (after the listener)
      expect(committed.at(-1)?.revision).toBe(2);
      expect(committed.at(-1)?.stateSizeBytes).toBeGreaterThan(0);
    });

    it("continues after the authority leaves: election, restore, buffered actions (S3)", async () => {
      const harness = harnessFactory();
      const transportA = harness.createTransport({ memberId: "member-a", displayName: "Ada" });
      const transportB = harness.createTransport({ memberId: "member-b", displayName: "Ben" });
      // Small deterministic timings: the migration completes in ~100 ms.
      const authority = {
        heartbeatIntervalMs: 50,
        gracePeriodMs: 400,
        electionWindowMs: 40,
        restoreWindowMs: 40,
      };
      const a = createNovaSession({
        transport: transportA,
        room: ROOM,
        sessionId: SESSION,
        player: { memberId: "member-a", displayName: "Ada" },
        game: { gameId: "game-1" },
        authority,
      });
      const b = createNovaSession({
        transport: transportB,
        room: ROOM,
        sessionId: SESSION,
        player: { memberId: "member-b", displayName: "Ben" },
        game: { gameId: "game-1" },
        authority,
      });
      a.client.defineGame({ title: "Contract Game", ...contractGameHandlers() });
      b.client.defineGame({ title: "Contract Game", ...contractGameHandlers() });
      await a.join();
      await b.join();
      await settle(harness);
      a.start();
      b.start();
      await settle(harness);
      expect(a.getStateModeDiagnostics().authorityMemberId).toBe("member-a");

      // The authority closes its tab: the remaining member suspects
      // immediately (the connection dropped), elects itself deterministically,
      // restores the replicated state, and continues the game (ADR-0007).
      await a.leave();
      await settle(harness);
      expect(b.getStateModeDiagnostics().authorityMemberId).toBeNull(); // electing
      expect(b.getStateModeDiagnostics().electionInProgress).toBe(true);
      // A dispatch during the election buffers and completes after migration.
      const dispatched = b.client.dispatch({ type: "drawCard" });
      await vi.waitFor(
        () => expect(b.getStateModeDiagnostics().authorityMemberId).toBe("member-b"),
        { timeout: 5_000, interval: 10 },
      );
      await expect(dispatched).resolves.toBeUndefined();
      await settle(harness);
      expect(b.getStateModeDiagnostics().revision).toBe(2);
      expect(b.getCanonicalState()?.state).toMatchObject({
        deck: ["ace", "king"],
        hands: { "member-b": "queen" },
      });
      // The new term is strictly higher than the old one.
      expect(b.getStateModeDiagnostics().term).toBeGreaterThanOrEqual(2);
    });

    // ------------------------------------------------------------------
    // Protocol boundaries
    // ------------------------------------------------------------------

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

    it("replicates canonical snapshots to every shell (never to game frames)", async () => {
      const { harness, a, b } = await makePair(harnessFactory, {
        handlers: contractGameHandlers(),
      });
      await startBoth({ harness, a, b });
      // A raw snapshot pushed over the transport updates the shell copy...
      await a.transport.send({
        channel: "nova.protocol",
        payload: assertPeerMessage({
          version: PROTOCOL_VERSION,
          sessionId: SESSION,
          senderMemberId: "member-a",
          senderConnectionId: a.transport.selfConnectionId,
          messageId: "snapshot-manual",
          sentAt: 1_700_000_000_000,
          seq: 999,
          type: "state.snapshot",
          revision: 5,
          stateHash: "a".repeat(64),
          term: 1,
          authorityMemberId: "member-a",
          processedActionIds: [],
          historyMode: "full",
          state: { shellOnly: true },
        }),
        version: PROTOCOL_VERSION,
        reliability: "reliable",
        ordering: "ordered",
      });
      await settle(harness);
      expect(b.getCanonicalState()?.state).toEqual({ shellOnly: true });
      // ...but never reaches the game-facing state handle.
      expect(b.client.state.get()).toEqual({ hand: undefined, deckCount: 3 });
    });

    // ------------------------------------------------------------------
    // ticking games (state mode with a tick)
    // ------------------------------------------------------------------

    it("ticks on the authority and steps each player by their controls", async () => {
      const handlers: NovaStateHandlers = {
        createInitialState: () => ({ x: {} as Record<string, number>, ticks: 0 }),
        tick(draft: { x: Record<string, number>; ticks: number }, context) {
          draft.ticks += 1;
          for (const player of context.players) {
            const controls = context.controls[player.id] as { dx?: number } | undefined;
            draft.x[player.id] = (draft.x[player.id] ?? 0) + (controls?.dx ?? 0);
          }
          expect(context.dt).toBeCloseTo(1 / 50);
        },
      };
      const pair = await makePair(harnessFactory, {
        handlers: { ...handlers, tickRate: 50 } as NovaStateHandlers,
      });
      await startBoth(pair);
      const views: Array<{ x: Record<string, number>; ticks: number }> = [];
      pair.b.client.state.onChange((view) => views.push(view as (typeof views)[number]));
      pair.b.client.controls.set({ dx: 1 });
      pair.b.client.controls.set({ dx: 1 }); // unchanged: nothing more is sent
      await waitForTicks(
        pair.harness,
        () => (views.at(-1)?.x["member-b"] ?? 0) >= 3,
        "Ben's controls moving him on every screen",
      );
      expect(views.at(-1)?.x["member-a"]).toBe(0);
      // Ben leaves: his controls stop counting.
      await pair.b.leave();
      await settle(pair.harness);
      const before = canonicalOf(pair.a) as { x: Record<string, number> };
      await waitForTicks(
        pair.harness,
        () => ((canonicalOf(pair.a) as { ticks?: number } | undefined)?.ticks ?? 0) > 5,
        "more ticks",
      );
      expect((canonicalOf(pair.a) as { x: Record<string, number> }).x["member-b"]).toBe(
        before.x["member-b"],
      );
    });

    it("keeps ticking from the replicated state after the authority leaves", async () => {
      const handlers = {
        createInitialState: () => ({ ticks: 0, held: {} as Record<string, unknown> }),
        tick(draft: { ticks: number; held: Record<string, unknown> }, context: NovaTickContext) {
          draft.ticks += 1;
          draft.held = { ...context.controls };
        },
        tickRate: 50,
      };
      const pair = await makePair(harnessFactory, { handlers: handlers as NovaStateHandlers });
      await startBoth(pair);
      pair.b.client.controls.set({ fire: true });
      await waitForTicks(
        pair.harness,
        () => ((canonicalOf(pair.b) as { ticks?: number } | undefined)?.ticks ?? 0) >= 5,
        "ticks before migration",
      );
      // Ada (the lowest id) ticks. When she leaves, Ben continues from his
      // replicated copy, and his controls still count.
      await pair.a.leave();
      await settle(pair.harness);
      const ticksAtHandoff = (canonicalOf(pair.b) as { ticks: number }).ticks;
      await waitForTicks(
        pair.harness,
        () => {
          const state = canonicalOf(pair.b) as {
            ticks: number;
            held: Record<string, unknown>;
          };
          return state.ticks > ticksAtHandoff + 3 && state.held["member-b"] !== undefined;
        },
        "Ben ticking as the new authority",
        8_000,
      );
    });

    it("hands authority to another player when the host's page is hidden", async () => {
      const handlers = {
        createInitialState: () => ({ ticks: 0 }),
        tick(draft: { ticks: number }) {
          draft.ticks += 1;
        },
        tickRate: 50,
      };
      const pair = await makePair(harnessFactory, { handlers: handlers as NovaStateHandlers });
      await startBoth(pair);
      await waitForTicks(
        pair.harness,
        () => ((canonicalOf(pair.b) as { ticks?: number } | undefined)?.ticks ?? 0) >= 3,
        "Ada ticking",
      );
      pair.a.setAway(true); // Ada switches apps
      await waitForTicks(
        pair.harness,
        () =>
          pair.a.getStateModeDiagnostics().authorityMemberId === "member-b" &&
          pair.b.getStateModeDiagnostics().authorityMemberId === "member-b",
        "Ben taking over",
      );
      const ticks = (canonicalOf(pair.b) as { ticks: number }).ticks;
      await waitForTicks(
        pair.harness,
        () => (canonicalOf(pair.a) as { ticks: number }).ticks > ticks + 3,
        "Ben's ticks reaching Ada",
      );
      // Coming back does not take authority back.
      pair.a.setAway(false);
      await settle(pair.harness);
      expect(pair.b.getStateModeDiagnostics().authorityMemberId).toBe("member-b");
    });

    it("keeps authority when nobody else could take over", async () => {
      const pair = await makePair(harnessFactory);
      await startBoth(pair);
      pair.b.setAway(true);
      await settle(pair.harness);
      pair.a.setAway(true); // the last eligible player stays the authority
      await settle(pair.harness);
      expect(pair.a.getStateModeDiagnostics().authorityMemberId).toBe("member-a");
      expect(pair.b.getStateModeDiagnostics().authorityMemberId).toBe("member-a");
    });

    it("keeps the authority's state identical to what others receive (NaN)", async () => {
      const handlers = {
        createInitialState: () => ({ speed: 0, distance: 0 }),
        actions: {
          divide(draft: { speed: number; distance: number }) {
            draft.speed = draft.distance / 0 - draft.distance / 0; // NaN
          },
        },
      };
      const errors: string[] = [];
      const pair = await makePair(harnessFactory, {
        handlers: handlers as NovaStateHandlers,
        setup: (a) =>
          a.onSessionEvent((event) => {
            if (event.type === "error") errors.push(event.error.message);
          }),
      });
      await startBoth(pair);
      await pair.b.dispatch({ type: "divide" }, "divide-1");
      await settle(pair.harness);
      expect(canonicalOf(pair.a)).toEqual({ speed: null, distance: 0 });
      expect(canonicalOf(pair.b)).toEqual({ speed: null, distance: 0 });
      expect(errors).toEqual([expect.stringContaining('"speed" is NaN')]);
    });
  });
}
