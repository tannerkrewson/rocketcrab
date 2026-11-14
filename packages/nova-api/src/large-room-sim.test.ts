/**
 * Large-room authority fan-out simulation (PLAN §3.7), in-process.
 *
 * N real `NovaSession`s (the real session, protocol and state engine) run in
 * ONE Node process over the in-memory transport hub. There are no browsers,
 * WebRTC, Trystero, servers or ports. The question is the one §3.7 asks: the
 * state-mode authority sends state to every player, so its upload and CPU
 * should grow with party size. This suite measures that cheaply.
 *
 * What is measured (see docs/testing/large-room-load.md for interpretation):
 * - Outbound traffic per sender, by wrapping each transport's `send`. Every
 *   protocol message goes through `transport.send`, so the wrapper sees the
 *   authority's snapshot broadcast and per-player views. A broadcast counts
 *   as one transmission per recipient, the way a WebRTC mesh pays for it.
 *   Bytes are JSON of the send envelope. This is approximate: Trystero
 *   framing, encryption and SCTP overhead are not included.
 * - Convergence in ms: wall clock from dispatch until every session shows the
 *   new view. The hub models a 20 ms ± 5 ms link. The session engine's own
 *   timers are real, so this is not pure virtual time, and it includes all
 *   CPU in the process.
 * - CPU via `process.cpuUsage()` deltas. This is WHOLE-PROCESS CPU, because
 *   every simulated player shares this process. It is not attributable to the
 *   authority alone.
 *
 * Runs only with `LARGE_ROOM_SIM=1` (`npm run sim:large-room`), so the normal
 * `npm run check` stays fast. Only sanity conditions are asserted. The numbers
 * are written to docs/testing/large-room-sim-<date>.json.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { cpus, totalmem } from "node:os";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { InMemoryTransportHub, type InMemoryTransport } from "@rocketcrab/testing";
import { createNovaSession, type NovaSession } from "./session";
import { STATE_HISTORY_LIMIT } from "./state-engine";
import type { NovaStateHandlers } from "./types";

/** Party sizes measured, in increasing order (one hub per size). */
const PARTY_SIZES = [10, 25, 50, 100, 200] as const;
const ACTIONS_PER_SIZE = 20;
const ROOM = "large-room-sim";
const SESSION_ID = "session-large-room-sim";
const HUB_SEED = "large-room-sim-v1";
/** Modeled link: 20 ms one-way latency, ±5 ms uniform jitter. */
const LINK = { latencyMs: 20, jitterMs: 5 } as const;
const WAIT_TIMEOUT_MS = 180_000;

interface SimState {
  count: number;
  /** Count of no-op `touch` actions; they fill the snapshot history, not the score. */
  touches: number;
  /** One entry per player, so the canonical state grows with party size. */
  scores: Record<string, number>;
}

interface SimView {
  count: number;
  myScore: number;
}

interface Bucket {
  messages: number;
  bytes: number;
  /** For `state.snapshot` only: bytes of the canonical state body (all copies). */
  stateBytes: number;
  /** For `state.snapshot` only: bytes of the processed-action-id history (all copies). */
  historyBytes: number;
}

interface ActionRecord {
  action: number;
  convergenceMs: number;
  authorityMessages: number;
  authorityBytes: number;
  /** Average bytes sent by one non-authority player during this action. */
  nonAuthorityBytesPerMember: number;
  /** Bytes sent by the single player who dispatched this action. */
  dispatcherBytes: number;
  /** Share of authorityBytes that is the snapshot's canonical state body. */
  authoritySnapshotStateBytes: number;
  /** Share of authorityBytes that is the snapshot's processed-id history. */
  authoritySnapshotHistoryBytes: number;
}

interface PartySizeResult {
  players: number;
  authorityMemberId: string;
  rosterConvergedMs: number;
  setupMs: number;
  stateSizeBytes: number;
  /** Processed action ids the authority ships in each snapshot (bounded). */
  processedActionCountBeforeBatch: number;
  heapUsedBytesAfterSetup: number;
  peakRssKiBSoFar: number;
  actions: ActionRecord[];
  summary: {
    authorityMessagesPerAction: number;
    authorityBytesPerAction: number;
    authorityBytesPerActionPerPlayer: number;
    authoritySnapshotStateBytesPerAction: number;
    authoritySnapshotHistoryBytesPerAction: number;
    nonAuthorityBytesPerMemberPerAction: number;
    dispatcherBytesPerAction: number;
    convergenceMsMean: number;
    convergenceMsMax: number;
  };
  batch: {
    wallMs: number;
    processCpuMs: number;
    processCpuMsPerAction: number;
    authorityByType: Record<string, Bucket>;
  };
}

// ---------------------------------------------------------------------------
// Game: a counter with one score per player (a realistic per-player state).
// ---------------------------------------------------------------------------

function simHandlers(): NovaStateHandlers {
  return {
    createInitialState: (): SimState => ({ count: 0, touches: 0, scores: {} }),
    actions: {
      touch(draft: SimState, context) {
        if (context.actor === undefined) throw new Error("touch requires an actor");
        draft.touches += 1;
      },
      checkIn(draft: SimState, context) {
        const actor = context.actor;
        if (actor === undefined) throw new Error("checkIn requires an actor");
        draft.scores[actor.id] = 0;
      },
      increment(draft: SimState, context) {
        const actor = context.actor;
        if (actor === undefined) throw new Error("increment requires an actor");
        draft.count += 1;
        draft.scores[actor.id] = (draft.scores[actor.id] ?? 0) + 1;
      },
    },
    selectView: (state: unknown, viewer): SimView => {
      const sim = state as SimState;
      return { count: sim.count, myScore: sim.scores[viewer.id] ?? 0 };
    },
  };
}

// ---------------------------------------------------------------------------
// Traffic metering (outbound, per sender, per message type)
// ---------------------------------------------------------------------------

type SendOptions = Parameters<InMemoryTransport["send"]>[0];

class TrafficMeter {
  /** Only counts while the measured batch is running. */
  active = false;
  private readonly byMember = new Map<string, Map<string, Bucket>>();
  private readonly encoder = new TextEncoder();

  record(
    memberId: string,
    type: string,
    messages: number,
    bytes: number,
    parts: { stateBytes: number; historyBytes: number } = { stateBytes: 0, historyBytes: 0 },
  ): void {
    let types = this.byMember.get(memberId);
    if (types === undefined) {
      types = new Map();
      this.byMember.set(memberId, types);
    }
    const bucket = types.get(type) ?? emptyBucket();
    bucket.messages += messages;
    bucket.bytes += bytes;
    bucket.stateBytes += parts.stateBytes;
    bucket.historyBytes += parts.historyBytes;
    types.set(type, bucket);
  }

  /** Wrap one transport's `send` so every outbound message is metered. */
  instrument(transport: InMemoryTransport): void {
    const send = transport.send.bind(transport);
    transport.send = (options: SendOptions) => {
      if (this.active && transport.connectionState === "connected") {
        const type = payloadType(options.payload);
        // A broadcast is one transmission per connected peer; a targeted send is one.
        const recipients =
          options.targetConnectionId === undefined
            ? Math.max(0, transport.hub.membersOf(transport.roomName).length - 1)
            : 1;
        const bytes = this.wireBytes(transport, options) * recipients;
        const parts = snapshotParts(options.payload);
        this.record(transport.selfMemberId, type, recipients, bytes, {
          stateBytes: parts.stateBytes * recipients,
          historyBytes: parts.historyBytes * recipients,
        });
      }
      return send(options);
    };
  }

  /** Cumulative totals per member (copy), for per-action deltas. */
  totals(): Map<string, Bucket> {
    const out = new Map<string, Bucket>();
    for (const [memberId, types] of this.byMember) {
      const sum = emptyBucket();
      for (const bucket of types.values()) {
        sum.messages += bucket.messages;
        sum.bytes += bucket.bytes;
        sum.stateBytes += bucket.stateBytes;
        sum.historyBytes += bucket.historyBytes;
      }
      out.set(memberId, sum);
    }
    return out;
  }

  byType(memberId: string): Record<string, Bucket> {
    const out: Record<string, Bucket> = {};
    for (const [type, bucket] of this.byMember.get(memberId) ?? []) {
      out[type] = { ...bucket };
    }
    return out;
  }

  private wireBytes(transport: InMemoryTransport, options: SendOptions): number {
    // Approximates the hub's TransportMessage envelope (fixed-width ids and
    // timestamps) around the payload. The payload dominates the total.
    const envelope = {
      version: options.version,
      sessionId: transport.sessionId,
      channel: options.channel,
      senderMemberId: transport.selfMemberId,
      senderConnectionId: transport.selfConnectionId,
      messageId: `msg-${"0".repeat(16)}`,
      sentAt: 1_700_000_000_000,
      seq: options.seq,
      reliability: options.reliability ?? "reliable",
      ordering: options.ordering ?? "ordered",
      deliverySeq: 1_000_000,
      binary: false,
      payload: options.payload,
    };
    return this.encoder.encode(JSON.stringify(envelope)).byteLength;
  }
}

function emptyBucket(): Bucket {
  return { messages: 0, bytes: 0, stateBytes: 0, historyBytes: 0 };
}

/** Per-copy JSON bytes of a snapshot's state body and its action-id history. */
function snapshotParts(payload: unknown): { stateBytes: number; historyBytes: number } {
  if (payloadType(payload) !== "state.snapshot") return { stateBytes: 0, historyBytes: 0 };
  const body = payload as { state?: unknown; processedActionIds?: unknown };
  const encoder = new TextEncoder();
  return {
    stateBytes: encoder.encode(JSON.stringify(body.state ?? null)).byteLength,
    historyBytes: encoder.encode(JSON.stringify(body.processedActionIds ?? [])).byteLength,
  };
}

function payloadType(payload: unknown): string {
  if (typeof payload === "object" && payload !== null && "type" in payload) {
    const type = (payload as { type: unknown }).type;
    if (typeof type === "string") return type;
  }
  return "unknown";
}

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------

interface SimPlayer {
  memberId: string;
  session: NovaSession;
  /** Time (performance.now) each view count was first seen by this session. */
  arrivals: Map<number, number>;
}

async function waitFor(predicate: () => boolean, label: string): Promise<void> {
  const deadline = performance.now() + WAIT_TIMEOUT_MS;
  while (!predicate()) {
    if (performance.now() > deadline) {
      throw new Error(`Timed out waiting for ${label}.`);
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 1));
  }
}

function mean(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** Wait until one session holds the authority's current revision. */
async function awaitRevision(player: SimPlayer, authorityRevision: () => number): Promise<void> {
  await waitFor(
    () => player.session.getStateModeDiagnostics().revision === authorityRevision(),
    `${player.memberId} to catch up to the authority revision`,
  );
}

/** Dispatch once the sender is current, then wait until it applies the commit. */
async function dispatchAndAwaitCommit(
  player: SimPlayer,
  authorityRevision: () => number,
  action: { type: string },
): Promise<void> {
  await awaitRevision(player, authorityRevision);
  const expected = authorityRevision() + 1;
  await player.session.client.dispatch(action);
  await waitFor(
    () => player.session.getStateModeDiagnostics().revision >= expected,
    `${player.memberId} to see revision ${expected}`,
  );
}

async function runPartySize(size: number): Promise<PartySizeResult> {
  const hub = new InMemoryTransportHub({ seed: HUB_SEED, defaultFaults: LINK });
  const meter = new TrafficMeter();
  const players: SimPlayer[] = [];
  try {
    const setupStart = performance.now();
    for (let index = 0; index < size; index += 1) {
      const memberId = `member-${String(index + 1).padStart(3, "0")}`;
      const displayName = `Player ${index + 1}`;
      const transport = hub.createTransport({ memberId, displayName });
      meter.instrument(transport);
      const session = createNovaSession({
        transport,
        room: ROOM,
        sessionId: SESSION_ID,
        player: { memberId, displayName },
        game: { gameId: "game-large-room-sim", mode: "state", title: "Large Room Sim" },
      });
      session.client.defineGame({ title: "Large Room Sim", mode: "state", ...simHandlers() });
      const player: SimPlayer = { memberId, session, arrivals: new Map() };
      session.client.state.onChange((state) => {
        const count = (state as SimView).count;
        if (!player.arrivals.has(count)) player.arrivals.set(count, performance.now());
      });
      players.push(player);
    }

    for (const player of players) {
      await player.session.join();
    }
    await waitFor(
      () => players.every((player) => player.session.players.length === size),
      `every session to see ${size} players`,
    );
    const rosterConvergedMs = performance.now() - setupStart;

    for (const player of players) {
      player.session.start();
    }
    const authorityOf = (player: SimPlayer) =>
      player.session.getStateModeDiagnostics().authorityMemberId;
    await waitFor(() => {
      const authorities = new Set(players.map(authorityOf));
      return authorities.size === 1 && !authorities.has(null);
    }, "one agreed authority");
    const firstPlayer = players[0];
    if (firstPlayer === undefined) throw new Error("No players.");
    const authorityMemberId = authorityOf(firstPlayer);
    if (authorityMemberId === null) throw new Error("No authority elected.");
    const authority = players.find((player) => player.memberId === authorityMemberId);
    const dispatcher = players.find((player) => player.memberId !== authorityMemberId);
    if (authority === undefined || dispatcher === undefined) {
      throw new Error("Expected one authority and at least one other player.");
    }

    await waitFor(
      () => players.every((player) => player.session.getStateModeDiagnostics().revision >= 1),
      "the initial state revision on every session",
    );

    // Check in every player sequentially, so the state holds one score per
    // player. An action carries the sender's revision as its base, and the
    // engine rejects it as stale if the authority has moved on, so each
    // sender first catches up to the authority's live revision.
    const authorityRevision = () => authority.session.getStateModeDiagnostics().revision;
    for (const player of players) {
      await dispatchAndAwaitCommit(player, authorityRevision, { type: "checkIn" });
    }
    await waitFor(
      () =>
        players.every(
          (player) => player.session.getStateModeDiagnostics().revision === authorityRevision(),
        ),
      "every session on the authority revision",
    );
    // Fill the authority's processed-action history to its cap before measuring.
    // Snapshots ship that history to every peer, so a short party would
    // otherwise measure an unrepresentative, smaller snapshot. Round-robin
    // senders with `touch` (no effect on the score).
    for (
      let index = 0;
      authority.session.getStateModeDiagnostics().processedActionCount < STATE_HISTORY_LIMIT;
      index += 1
    ) {
      const sender = players[index % players.length];
      if (sender === undefined) throw new Error("No players.");
      await dispatchAndAwaitCommit(sender, authorityRevision, { type: "touch" });
    }
    await waitFor(
      () =>
        players.every(
          (player) => player.session.getStateModeDiagnostics().revision === authorityRevision(),
        ),
      "every session on the authority revision after history fill",
    );
    const setupMs = performance.now() - setupStart;
    const heapUsedBytesAfterSetup = process.memoryUsage().heapUsed;
    const authorityDiagnostics = authority.session.getStateModeDiagnostics();
    const stateSizeBytes = authorityDiagnostics.stateSizeBytes;
    const processedActionCountBeforeBatch = authorityDiagnostics.processedActionCount;

    // Measured batch: the non-authority player dispatches sequential increments.
    for (const player of players) player.arrivals.clear();
    meter.active = true;
    const cpuStart = process.cpuUsage();
    const batchStart = performance.now();
    const actions: ActionRecord[] = [];
    for (let action = 1; action <= ACTIONS_PER_SIZE; action += 1) {
      await awaitRevision(dispatcher, authorityRevision);
      const before = meter.totals();
      const dispatcherBefore = before.get(dispatcher.memberId) ?? emptyBucket();
      const started = performance.now();
      await dispatcher.session.client.dispatch({ type: "increment" });
      await waitFor(
        () => players.every((player) => player.arrivals.has(action)),
        `every session to show action ${action}`,
      );
      let lastArrival = started;
      for (const player of players) {
        lastArrival = Math.max(lastArrival, player.arrivals.get(action) ?? started);
      }
      const after = meter.totals();
      const authorityBefore = before.get(authority.memberId) ?? emptyBucket();
      const authorityAfter = after.get(authority.memberId) ?? emptyBucket();
      let nonAuthorityBytes = 0;
      for (const player of players) {
        if (player.memberId === authority.memberId) continue;
        nonAuthorityBytes +=
          (after.get(player.memberId)?.bytes ?? 0) - (before.get(player.memberId)?.bytes ?? 0);
      }
      const dispatcherAfter = after.get(dispatcher.memberId) ?? emptyBucket();
      actions.push({
        action,
        convergenceMs: lastArrival - started,
        authorityMessages: authorityAfter.messages - authorityBefore.messages,
        authorityBytes: authorityAfter.bytes - authorityBefore.bytes,
        nonAuthorityBytesPerMember: nonAuthorityBytes / Math.max(1, size - 1),
        dispatcherBytes: dispatcherAfter.bytes - dispatcherBefore.bytes,
        authoritySnapshotStateBytes: authorityAfter.stateBytes - authorityBefore.stateBytes,
        authoritySnapshotHistoryBytes: authorityAfter.historyBytes - authorityBefore.historyBytes,
      });
    }
    const batchWallMs = performance.now() - batchStart;
    const cpuDelta = process.cpuUsage(cpuStart);
    meter.active = false;
    const processCpuMs = (cpuDelta.user + cpuDelta.system) / 1000;

    // Sanity: every session saw every action (views 1..N, in order of arrival).
    for (const player of players) {
      for (let action = 1; action <= ACTIONS_PER_SIZE; action += 1) {
        expect(player.arrivals.has(action), `${player.memberId} saw action ${action}`).toBe(true);
      }
      expect((player.session.client.state.get() as SimView).count).toBe(ACTIONS_PER_SIZE);
    }

    const authorityBytes = actions.map((record) => record.authorityBytes);
    const authorityMessages = actions.map((record) => record.authorityMessages);
    const convergence = actions.map((record) => record.convergenceMs);
    const result: PartySizeResult = {
      players: size,
      authorityMemberId,
      rosterConvergedMs,
      setupMs,
      stateSizeBytes,
      processedActionCountBeforeBatch,
      heapUsedBytesAfterSetup,
      peakRssKiBSoFar: process.resourceUsage().maxRSS,
      actions,
      summary: {
        authorityMessagesPerAction: mean(authorityMessages),
        authorityBytesPerAction: mean(authorityBytes),
        authorityBytesPerActionPerPlayer: mean(authorityBytes) / size,
        authoritySnapshotStateBytesPerAction: mean(
          actions.map((r) => r.authoritySnapshotStateBytes),
        ),
        authoritySnapshotHistoryBytesPerAction: mean(
          actions.map((r) => r.authoritySnapshotHistoryBytes),
        ),
        nonAuthorityBytesPerMemberPerAction: mean(actions.map((r) => r.nonAuthorityBytesPerMember)),
        dispatcherBytesPerAction: mean(actions.map((r) => r.dispatcherBytes)),
        convergenceMsMean: mean(convergence),
        convergenceMsMax: Math.max(...convergence),
      },
      batch: {
        wallMs: batchWallMs,
        processCpuMs,
        processCpuMsPerAction: processCpuMs / ACTIONS_PER_SIZE,
        authorityByType: meter.byType(authority.memberId),
      },
    };
    console.log(
      `[large-room-sim] N=${size} converge=${result.summary.convergenceMsMean.toFixed(1)}ms ` +
        `authority=${Math.round(result.summary.authorityBytesPerAction)}B/action ` +
        `(${result.summary.authorityMessagesPerAction.toFixed(0)} msgs) ` +
        `cpu=${result.batch.processCpuMsPerAction.toFixed(1)}ms/action ` +
        `heap=${(heapUsedBytesAfterSetup / 1048576).toFixed(0)}MiB`,
    );
    return result;
  } finally {
    for (const player of players) player.session.dispose();
    hub.dispose();
  }
}

/**
 * Pretty JSON that matches the repo formatter: short arrays of plain numbers
 * stay on one line (for example `partySizes`), so the committed sample file
 * passes `npm run format:check`.
 */
function formatReport(report: unknown): string {
  const json = JSON.stringify(report, null, 2);
  const inlined = json.replace(
    /\[\s*(-?\d[\d.e+-]*(?:,\s*-?\d[\d.e+-]*)*)\s*\]/gu,
    (_match, numbers: string) => `[${numbers.replace(/,\s*/gu, ", ")}]`,
  );
  return `${inlined}\n`;
}

function localDateIso(now: Date): string {
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

describe.skipIf(!process.env.LARGE_ROOM_SIM)("large-room authority fan-out simulation", () => {
  it(
    "measures authority traffic, convergence and CPU per party size",
    async () => {
      const startedAt = new Date();
      const results: PartySizeResult[] = [];
      for (const size of PARTY_SIZES) {
        results.push(await runPartySize(size));
      }

      const date = localDateIso(startedAt);
      const outputPath = fileURLToPath(
        new URL(`../../../docs/testing/large-room-sim-${date}.json`, import.meta.url),
      );
      const report = {
        date,
        startedAt: startedAt.toISOString(),
        generator: "packages/nova-api/src/large-room-sim.test.ts",
        environment: {
          node: process.version,
          platform: process.platform,
          logicalCpus: cpus().length,
          totalMemoryBytes: totalmem(),
          note: "Single Node process; all simulated players share it. CPU is whole-process.",
        },
        config: {
          partySizes: PARTY_SIZES,
          actionsPerSize: ACTIONS_PER_SIZE,
          hubSeed: HUB_SEED,
          link: LINK,
          setup:
            "One checkIn per player (state holds one score per player), then touch actions until the authority's processed-action history reaches STATE_HISTORY_LIMIT. Measured batch starts after that.",
          historyLimit: STATE_HISTORY_LIMIT,
          sendAccounting:
            "Every transport.send is metered. A broadcast counts one transmission per recipient. Bytes are JSON of the approximate envelope plus payload.",
          timing:
            "Convergence is wall clock with real session timers and the modeled link. It is not pure virtual time.",
        },
        results,
      };
      mkdirSync(fileURLToPath(new URL("../../../docs/testing/", import.meta.url)), {
        recursive: true,
      });
      writeFileSync(outputPath, formatReport(report));

      for (const result of results) {
        expect(result.authorityMemberId).toMatch(/^member-/u);
        expect(result.actions).toHaveLength(ACTIONS_PER_SIZE);
        expect(result.summary.convergenceMsMax).toBeGreaterThan(0);
      }
    },
    60 * 60_000,
  );
});
