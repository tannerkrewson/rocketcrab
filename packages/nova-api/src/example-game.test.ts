/**
 * S4 — the state-mode vertical-slice example game, executed end to end.
 *
 * `examples/games/nova-quiz.html` is the single-file state-mode game this
 * issue defines as the backendless MVP milestone. Its inline module script
 * is extracted and run against real session-backed `nova` clients (the same
 * clients the runtime frame bridge builds) over the in-memory transport, so
 * this suite exercises the REAL state engine: action application on the
 * authority, per-player views, private answers, round progression, auto
 * reveal/advance racing (and its stale_revision rejections), authority
 * migration mid-game, reconnect catch-up, and late-join spectating.
 *
 * The game's render layer is DOM-guarded (it no-ops without a document), so
 * the exact same source that runs in the arena and real parties runs here.
 * Timing is accelerated through the documented test seam
 * (`globalThis.__novaQuizConfig`), which nothing sets in a real browser.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryTransportHub, type InMemoryTransport } from "@rocketcrab/testing";
// The single-file example game, verbatim (Vite ?raw import; the tests
// execute the exact source that runs in the arena and real parties).
import GAME_SOURCE from "../../../examples/games/nova-quiz.html?raw";
import { createNovaSession, type NovaSession, type NovaSessionOptions } from "./session";
import type { NovaAction } from "./types";

/** Extract the game's inline module script (the only part we execute). */
function extractModuleScript(html: string): string {
  const match = /<script type="module">([\s\S]*?)<\/script>/u.exec(html);
  if (match === null || match[1] === undefined) {
    throw new Error("No inline module script found in the example game.");
  }
  return match[1];
}

const GAME_SCRIPT = extractModuleScript(GAME_SOURCE);

/** The view shape the game's selectView returns (typed for the tests). */
interface QuizView {
  phase: "waiting" | "question" | "revealed" | "finished";
  waiting?: boolean;
  readyToBegin?: boolean;
  beginAt?: number;
  round: number;
  roundsTotal: number;
  roster: Array<{ id: string; name: string }>;
  quizmasterId: string | null;
  question: { text: string; options: readonly string[]; category: string };
  correctChoice: number | null;
  revealed: boolean;
  myAnswer: number | null;
  answers: Record<string, { choice: number; name: string }>;
  revealedAnswers: Array<{ memberId: string; name: string; choice: number }>;
  scores: Array<{ id: string; name: string; score: number }>;
  answeredCount: number;
  deadline: number;
  revealedAt: number | null;
  resultsMs: number;
  isQuizmaster: boolean;
  spectator: boolean;
  winnerId: string | null;
}

interface World {
  hub: InMemoryTransportHub;
  sessions: NovaSession[];
  transports: InMemoryTransport[];
}

/** Short election timings for the migration test (deterministic + fast). */
const AUTHORITY_TIMINGS = {
  heartbeatIntervalMs: 80,
  gracePeriodMs: 250,
  electionWindowMs: 120,
  restoreWindowMs: 120,
};

const PLAYERS: Array<{ memberId: string; name: string }> = [
  { memberId: "member-a", name: "Ada" },
  { memberId: "member-b", name: "Ben" },
  { memberId: "member-c", name: "Cara" },
  { memberId: "member-d", name: "Dana" },
];

/** Every world created by a test; disposed in afterEach. */
const worlds: World[] = [];

function makeWorld(): World {
  const world = { hub: new InMemoryTransportHub(), sessions: [], transports: [] };
  worlds.push(world);
  return world;
}

function addPlayer(
  world: World,
  player: { memberId: string; name: string },
  authority?: NovaSessionOptions["authority"],
): NovaSession {
  const transport = world.hub.createTransport({
    memberId: player.memberId,
    displayName: player.name,
  });
  world.transports.push(transport);
  const session = createNovaSession({
    transport,
    room: "arena",
    sessionId: "session-s4",
    player: { memberId: player.memberId, displayName: player.name },
    game: { gameId: "game-nova-quiz", mode: "state", title: "Nova Quiz" },
    ...(authority !== undefined ? { authority } : {}),
  });
  world.sessions.push(session);
  new Function("nova", GAME_SCRIPT)(session.client);
  return session;
}

async function settle(world: World, ms: number): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
    world.hub.drain();
  }
  world.hub.drain();
}

/** Join every session and start the game (arena policy: the host starts). */
async function playToStart(world: World): Promise<void> {
  for (const session of world.sessions) {
    await session.join();
  }
  await settle(world, 120);
  for (const session of world.sessions) {
    session.start();
  }
  // The game begins with a short join window (auto-start once enough players
  // are connected), then round 1's question goes live.
  await settle(world, 700);
}

function viewOf(session: NovaSession): QuizView | null {
  return session.client.state.get() as QuizView | null;
}

async function waitForView(
  world: World,
  session: NovaSession,
  predicate: (view: QuizView) => boolean,
  timeoutMs = 4000,
): Promise<QuizView> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    world.hub.drain();
    const view = viewOf(session);
    if (view !== null && predicate(view)) return view;
    if (Date.now() > deadline) {
      throw new Error(
        `Timed out waiting for the view predicate (phase=${JSON.stringify(view?.phase)} round=${JSON.stringify(view?.round)} revealed=${JSON.stringify(view?.revealed)}).`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

/** Dispatch an action and pump the hub until the ack settles the promise. */
async function dispatchSettled(
  world: World,
  session: NovaSession,
  action: NovaAction,
): Promise<void> {
  const promise = session.client.dispatch(action);
  const deadline = Date.now() + 3000;
  for (;;) {
    world.hub.drain();
    const settled = await Promise.race([
      promise.then(
        () => true,
        () => true,
      ),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), 15)),
    ]);
    if (settled === true) {
      // Surface rejection codes (stable NovaError codes) instead of hiding
      // them: a rejected action usually means a stale race that the next
      // view settles, but the migration test must not silently swallow.
      await promise.catch((error: unknown) => {
        throw error;
      });
      return;
    }
    if (Date.now() > deadline) {
      throw new Error(`Action ${action.type} did not settle in time.`);
    }
  }
}

function sessionOf(world: World, memberId: string): NovaSession {
  const session = world.sessions.find((candidate) => candidate.self.id === memberId);
  if (session === undefined) {
    throw new Error(`No session for ${memberId}.`);
  }
  return session;
}

/** Wait until a session reports itself connected (post-reconnect). */
async function waitForConnection(
  world: World,
  session: NovaSession,
  timeoutMs = 4000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    world.hub.drain();
    if (session.connectionStatus === "connected") return;
    if (Date.now() > deadline) {
      throw new Error(
        `Timed out waiting for ${session.self.id} to reconnect (status=${session.connectionStatus}).`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

function expectedScore(view: QuizView, memberId: string): number {
  const answer = view.revealedAnswers.find((entry) => entry.memberId === memberId);
  if (answer === undefined) return 0;
  return answer.choice === view.correctChoice ? 1 : 0;
}

/** Override the game's timing (must run BEFORE the game script evaluates). */
function config(overrides: { answerMs?: number; resultsMs?: number; rounds?: number }): void {
  (globalThis as Record<string, unknown>).__novaQuizConfig = overrides;
}

beforeEach(() => {
  config({ answerMs: 2000, resultsMs: 1200, rounds: 2 });
});

afterEach(() => {
  vi.restoreAllMocks();
  delete (globalThis as Record<string, unknown>).__novaQuizConfig;
  for (const world of worlds.splice(0)) {
    for (const session of world.sessions) {
      session.dispose();
    }
    world.hub.dispose();
  }
});

describe("the S4 example game document", () => {
  it("is one complete HTML file with an inline state-mode module script", () => {
    expect(GAME_SOURCE).toMatch(/^<!doctype html>/i);
    expect(GAME_SOURCE).toMatch(/<meta name="viewport"/i);
    expect(GAME_SCRIPT).toContain("nova.defineGame({");
    expect(GAME_SCRIPT).toContain('mode: "state"');
    expect(GAME_SCRIPT).toContain("selectView:");
    expect(GAME_SCRIPT).toContain("actions:");
    expect(GAME_SCRIPT).toContain("nova.ready();");
    // Acceptance: the example uses only the Nova API — no direct peer-to-peer
    // transport usage and no remote dependency imports (ADR-0003, rule 1).
    expect(GAME_SOURCE).not.toMatch(
      /(?:from|require\()\s*["'](?:@)?trystero|@trystero-p2p|createTrysteroTransport|trystero\./iu,
    );
    expect(GAME_SOURCE).not.toMatch(/\bimport\s*\(|\bfrom\s+["']/u);
    // The source stays far under the 2 MiB HTML limit.
    expect(new TextEncoder().encode(GAME_SOURCE).byteLength).toBeLessThan(512 * 1024);
  });
});

describe("four players play full rounds (arena-style)", () => {
  it(
    "runs the whole game: answers, reveal, scoring, rounds, finish",
    { timeout: 25_000 },
    async () => {
      const world = makeWorld();
      for (const player of PLAYERS) {
        addPlayer(world, player);
      }
      await playToStart(world);

      const a = sessionOf(world, "member-a");
      await waitForView(world, a, (view) => view.phase === "question" && view.round === 1);

      // Round 1: the first roster member is the quizmaster; the others answer.
      let view = await waitForView(world, a, (v) => v.phase === "question");
      expect(view.quizmasterId).toBe("member-a");
      const answers1 = [
        { memberId: "member-b", choice: 0 },
        { memberId: "member-c", choice: 1 },
        { memberId: "member-d", choice: 2 },
      ];
      for (const answer of answers1) {
        await dispatchSettled(world, sessionOf(world, answer.memberId), {
          type: "answer",
          payload: { choice: answer.choice },
        });
      }

      // The auto-reveal timer closes the round in every frame.
      view = await waitForView(world, a, (v) => v.phase === "revealed" && v.round === 1);
      expect(view.correctChoice).toBeTypeOf("number");
      expect(view.revealedAnswers).toHaveLength(3);
      for (const answer of answers1) {
        expect(view.scores.find((entry) => entry.id === answer.memberId)?.score).toBe(
          expectedScore(view, answer.memberId),
        );
      }

      // Round 2 auto-advances; the second roster member is the quizmaster.
      view = await waitForView(world, a, (v) => v.phase === "question" && v.round === 2);
      expect(view.quizmasterId).toBe("member-b");
      const answers2 = [
        { memberId: "member-a", choice: 3 },
        { memberId: "member-c", choice: 2 },
        { memberId: "member-d", choice: 0 },
      ];
      for (const answer of answers2) {
        await dispatchSettled(world, sessionOf(world, answer.memberId), {
          type: "answer",
          payload: { choice: answer.choice },
        });
      }
      view = await waitForView(world, a, (v) => v.phase === "revealed" && v.round === 2);

      // The game finishes after the last round with a winner.
      view = await waitForView(world, a, (v) => v.phase === "finished");
      expect(view.winnerId).not.toBeNull();
      expect(view.scores[0]?.id).toBe(view.winnerId);
      // Every frame agrees on the final state.
      for (const session of world.sessions) {
        const finalView = await waitForView(world, session, (v) => v.phase === "finished");
        expect(finalView.roundsTotal).toBe(2);
        expect(finalView.winnerId).toBe(view.winnerId);
      }
    },
  );

  it("surfaces action races with stable, actionable error codes", { timeout: 15_000 }, async () => {
    const entries: Array<unknown[]> = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      entries.push(args);
    });
    const world = makeWorld();
    for (const player of PLAYERS) {
      addPlayer(world, player);
    }
    await playToStart(world);

    // Round 1's auto-reveal races across all four frames: the losers are
    // rejected with stale_revision and the game logs the stable code (S2
    // acceptance: errors are actionable rather than generic).
    const a = sessionOf(world, "member-a");
    await waitForView(world, a, (v) => v.phase === "revealed");
    await settle(world, 300);
    const joined = entries.map((args) => args.join(" ")).join("\n");
    expect(joined).toContain("stale_revision");
    expect(joined).toContain("Nova Quiz started with 4 player(s)");
    // The game still progressed despite the races.
    await waitForView(world, a, (v) => v.round >= 2);
  });
});

describe("private views (selectView)", () => {
  it("hides everyone's answers and the correct choice until the reveal", async () => {
    config({ answerMs: 60_000, resultsMs: 60_000, rounds: 2 });
    const world = makeWorld();
    for (const player of PLAYERS) {
      addPlayer(world, player);
    }
    await playToStart(world);

    const a = sessionOf(world, "member-a");
    await waitForView(world, a, (v) => v.phase === "question");

    const choices = [
      { memberId: "member-b", choice: 1 },
      { memberId: "member-c", choice: 2 },
      { memberId: "member-d", choice: 3 },
    ];
    for (const entry of choices) {
      await dispatchSettled(world, sessionOf(world, entry.memberId), {
        type: "answer",
        payload: { choice: entry.choice },
      });
    }
    await settle(world, 150);

    // Private-view invariants while the round is still open:
    for (const session of world.sessions) {
      const view = await waitForView(world, session, (v) => v.phase === "question");
      // No frame — including the authority's — may see the correct answer.
      expect(view.correctChoice).toBeNull();
      // A view contains only the viewer's own answer, never a peer's.
      expect(Object.keys(view.answers)).toEqual(view.myAnswer === null ? [] : [session.self.id]);
      // The public question is present in every player's view.
      expect(view.question.text.length).toBeGreaterThan(0);
    }

    // The quizmaster reveals; every view now shows the same public result.
    const round1 = viewOf(a)!;
    await dispatchSettled(world, sessionOf(world, round1.quizmasterId!), { type: "reveal" });
    await settle(world, 150);

    for (const session of world.sessions) {
      const view = await waitForView(world, session, (v) => v.phase === "revealed");
      expect(view.correctChoice).toBeTypeOf("number");
      expect(view.revealedAnswers).toHaveLength(3);
      for (const entry of choices) {
        expect(view.scores.find((s) => s.id === entry.memberId)?.score).toBe(
          expectedScore(view, entry.memberId),
        );
      }
    }
  });
});

describe("authority migration mid-game (ADR-0007)", () => {
  it("continues the game after the authority's connection drops", { timeout: 25_000 }, async () => {
    config({ answerMs: 60_000, resultsMs: 60_000, rounds: 2 });
    const world = makeWorld();
    for (const player of PLAYERS) {
      addPlayer(world, player, AUTHORITY_TIMINGS);
    }
    await playToStart(world);

    const a = sessionOf(world, "member-a");
    await waitForView(world, a, (v) => v.phase === "question" && v.round === 1);
    const before = a.getStateModeDiagnostics();
    expect(before.authorityMemberId).toBe("member-a"); // lowest member id
    expect(before.term).toBe(1);

    // Answer round 1, then force the authority's transport to drop and
    // rejoin — exactly what the arena's "Authority loss" button does.
    for (const answer of [
      { memberId: "member-b", choice: 0 },
      { memberId: "member-c", choice: 1 },
      { memberId: "member-d", choice: 2 },
    ]) {
      await dispatchSettled(world, sessionOf(world, answer.memberId), {
        type: "answer",
        payload: { choice: answer.choice },
      });
    }
    // The authority's link drops for a while (simulated backgrounded phone):
    // a rejoin delay keeps it out of the room until the election finalizes,
    // exactly like the arena's "Authority loss" control over a real link.
    const authorityIndex = world.sessions.findIndex((s) => s.self.id === before.authorityMemberId);
    world.transports[authorityIndex]!.faultProfile.rejoinDelayMs = 800;
    await world.transports[authorityIndex]!.reconnect();
    await settle(world, 400);

    // A new authority was elected at a higher term.
    const after = a.getStateModeDiagnostics();
    expect(after.term).toBeGreaterThan(before.term);
    expect(after.authorityMemberId).not.toBe(before.authorityMemberId);

    // The game continued: the new authority accepted the reveal (round 1's
    // quizmaster is the reconnected player, so wait for its rejoin first).
    await waitForConnection(world, a);
    const round1 = viewOf(a)!;
    await dispatchSettled(world, sessionOf(world, round1.quizmasterId!), { type: "reveal" });
    const revealed1 = await waitForView(world, a, (v) => v.phase === "revealed" && v.round === 1);
    expect(revealed1.correctChoice).toBeTypeOf("number");
    await dispatchSettled(world, sessionOf(world, revealed1.quizmasterId!), {
      type: "nextRound",
    });

    const round2 = await waitForView(world, a, (v) => v.phase === "question" && v.round === 2);
    await dispatchSettled(world, sessionOf(world, "member-d"), {
      type: "answer",
      payload: { choice: 2 },
    });
    await dispatchSettled(world, sessionOf(world, round2.quizmasterId!), { type: "reveal" });
    const revealed2 = await waitForView(world, a, (v) => v.phase === "revealed" && v.round === 2);
    expect(revealed2.correctChoice).toBeTypeOf("number");
    // The migrated authority applied the post-migration actions.
    expect(a.getStateModeDiagnostics().revision).toBeGreaterThan(before.revision);
  });
});

describe("reconnect and late join", () => {
  it("a player who joins mid-game spectates and plays from the next round", async () => {
    config({ answerMs: 60_000, resultsMs: 60_000, rounds: 2 });
    const world = makeWorld();
    for (const player of PLAYERS.slice(0, 3)) {
      addPlayer(world, player);
    }
    await playToStart(world);
    const a = sessionOf(world, "member-a");
    await waitForView(world, a, (v) => v.phase === "question" && v.round === 1);

    // Dana joins mid-round: she spectates the current question.
    const d = addPlayer(world, PLAYERS[3]!);
    await d.join();
    await settle(world, 250);
    const spectatorView = await waitForView(world, d, (v) => v.round === 1);
    expect(spectatorView.spectator).toBe(true);
    expect(spectatorView.correctChoice).toBeNull();

    // Advance manually: reveal (round 1's quizmaster), then next round
    // (round 2's quizmaster) — Dana is now a full player.
    const round1 = viewOf(a)!;
    await dispatchSettled(world, sessionOf(world, round1.quizmasterId!), { type: "reveal" });
    const revealed1 = await waitForView(world, a, (v) => v.phase === "revealed" && v.round === 1);
    await dispatchSettled(world, sessionOf(world, revealed1.quizmasterId!), {
      type: "nextRound",
    });

    const round2 = await waitForView(world, a, (v) => v.phase === "question" && v.round === 2);
    expect(round2.quizmasterId).toBe("member-b");
    const dRound2 = await waitForView(world, d, (v) => v.phase === "question" && v.round === 2);
    expect(dRound2.spectator).toBe(false);
    expect(dRound2.roster.map((p) => p.id)).toContain("member-d");
    await dispatchSettled(world, d, { type: "answer", payload: { choice: 2 } });
    await dispatchSettled(world, sessionOf(world, round2.quizmasterId!), { type: "reveal" });
    await waitForView(world, a, (v) => v.phase === "revealed" && v.round === 2);
    const dRevealed = await waitForView(world, d, (v) => v.phase === "revealed" && v.round === 2);
    expect(dRevealed.revealedAnswers.some((entry) => entry.memberId === "member-d")).toBe(true);
  });

  it("a disconnected player reconnects and catches up to the current round", async () => {
    config({ answerMs: 60_000, resultsMs: 60_000, rounds: 3 });
    const world = makeWorld();
    for (const player of PLAYERS) {
      addPlayer(world, player);
    }
    await playToStart(world);
    const a = sessionOf(world, "member-a");
    const d = sessionOf(world, "member-d");
    await waitForView(world, a, (v) => v.phase === "question" && v.round === 1);

    // Dana's connection drops (simulated background suspension).
    await d.leave();
    await settle(world, 300);

    // The game advances without her; the roster reconciles.
    const round1 = viewOf(a)!;
    await dispatchSettled(world, sessionOf(world, round1.quizmasterId!), { type: "reveal" });
    const revealed1 = await waitForView(world, a, (v) => v.phase === "revealed" && v.round === 1);
    await dispatchSettled(world, sessionOf(world, revealed1.quizmasterId!), {
      type: "nextRound",
    });
    const aRound2 = await waitForView(world, a, (v) => v.phase === "question" && v.round === 2);
    expect(aRound2.roster.map((p) => p.id)).not.toContain("member-d");

    // Dana reconnects: the authority hands her the current canonical state
    // (S2 late-join catch-up), so her frame shows the live round.
    await d.join();
    await settle(world, 250);
    const dView = await waitForView(world, d, (v) => v.round === 2);
    expect(dView.phase).toBe("question");
    expect(dView.spectator).toBe(true); // back in the roster next round
    expect(dView.question.text).toBe(aRound2.question.text);

    // Advance round 2 (someone answers, the quizmaster reveals), then start
    // round 3: Dana is back in the roster from the following round.
    await dispatchSettled(world, sessionOf(world, "member-b"), {
      type: "answer",
      payload: { choice: 1 },
    });
    await dispatchSettled(world, sessionOf(world, aRound2.quizmasterId!), { type: "reveal" });
    const revealed2 = await waitForView(world, a, (v) => v.phase === "revealed" && v.round === 2);
    await dispatchSettled(world, sessionOf(world, revealed2.quizmasterId!), {
      type: "nextRound",
    });
    const dRound3 = await waitForView(world, d, (v) => v.phase === "question" && v.round === 3);
    expect(dRound3.roster.map((p) => p.id)).toContain("member-d");
  });
});
