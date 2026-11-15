/**
 * Start requests from a member that is not the lowest id. The authority-elect
 * is the lowest eligible member (state-engine `lowestEligibleMemberId`). When
 * the starter is not the elect, the elect honours the request by starting as
 * authority, so every session still gets exactly one `start`.
 */
import { describe, expect, it } from "vitest";
import { MINIMAL_GAME_EXAMPLE, SIMULATION_MODE_EXAMPLE } from "./examples";
import { createInMemoryHarness } from "./harness";
import { createNovaSession, type NovaSession } from "./session";

const SESSION = "session-start-request";

function join(
  harness: ReturnType<typeof createInMemoryHarness>,
  memberId: string,
  displayName: string,
  mode: "state" | "simulation",
  acceptStartRequest?: (memberId: string) => boolean,
): { session: NovaSession; starts: number[]; errors: string[] } {
  const transport = harness.createTransport({ memberId, displayName });
  const session = createNovaSession({
    transport,
    room: "arena",
    sessionId: SESSION,
    player: { memberId, displayName },
    game: { gameId: "game-start", mode, title: "Start Game" },
    ...(acceptStartRequest !== undefined ? { acceptStartRequest } : {}),
  });
  new Function("nova", mode === "simulation" ? SIMULATION_MODE_EXAMPLE : MINIMAL_GAME_EXAMPLE)(
    session.client,
  );
  const starts: number[] = [];
  session.client.onStart(() => starts.push(1));
  const errors: string[] = [];
  session.onSessionEvent((event) => {
    if (event.type === "error") errors.push(event.error.code);
  });
  return { session, starts, errors };
}

/** Macrotask flush: the state engine's async apply and sha256 need real turns. */
async function flush(harness: ReturnType<typeof createInMemoryHarness>): Promise<void> {
  for (let i = 0; i < 3; i += 1) {
    for (let j = 0; j < 8; j += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    harness.drain();
  }
  await Promise.resolve();
}

describe("start requests from a non-elect member", () => {
  for (const mode of ["state", "simulation"] as const) {
    it(`the higher-id member starts and every session gets exactly one start (${mode})`, async () => {
      const harness = createInMemoryHarness();
      // member-a is the lowest id, so it is the elected authority.
      const a = join(harness, "member-a", "Ada", mode);
      const b = join(harness, "member-b", "Ben", mode);
      await a.session.join();
      await b.session.join();
      harness.drain();
      b.session.ready();
      a.session.ready();
      await flush(harness);

      b.session.start(); // b is not the elect: it asks, and a starts as authority.
      await flush(harness);

      expect(a.starts).toHaveLength(1);
      expect(b.starts).toHaveLength(1);
    });
  }

  it("the lowest-id member starting still works", async () => {
    const harness = createInMemoryHarness();
    const a = join(harness, "member-a", "Ada", "state");
    const b = join(harness, "member-b", "Ben", "state");
    await a.session.join();
    await b.session.join();
    harness.drain();
    a.session.ready();
    b.session.ready();
    await flush(harness);

    a.session.start();
    await flush(harness);

    expect(a.starts).toHaveLength(1);
    expect(b.starts).toHaveLength(1);
  });

  it("a duplicate start request is idempotent for the elected authority", async () => {
    const harness = createInMemoryHarness();
    const a = join(harness, "member-a", "Ada", "state");
    const b = join(harness, "member-b", "Ben", "state");
    const c = join(harness, "member-c", "Cy", "state");
    for (const player of [a, b, c]) await player.session.join();
    harness.drain();
    for (const player of [a, b, c]) player.session.ready();
    await flush(harness);

    // Two non-elect members both ask to start: a must still start once.
    b.session.start();
    c.session.start();
    await flush(harness);

    expect(a.starts).toHaveLength(1);
    expect(b.starts).toHaveLength(1);
    expect(c.starts).toHaveLength(1);
  });

  it("a member that joins after the game started still catches up with one start", async () => {
    const harness = createInMemoryHarness();
    const a = join(harness, "member-a", "Ada", "state");
    const b = join(harness, "member-b", "Ben", "state");
    await a.session.join();
    await b.session.join();
    harness.drain();
    a.session.ready();
    b.session.ready();
    await flush(harness);
    b.session.start();
    await flush(harness);
    expect(a.starts).toHaveLength(1);

    const late = join(harness, "member-z", "Zed", "state");
    await late.session.join();
    await flush(harness);

    expect(late.starts).toHaveLength(1);
    expect(a.starts).toHaveLength(1);
    expect(b.starts).toHaveLength(1);
  });
});

describe("start request gate (acceptStartRequest)", () => {
  it("ignores a start request from a member the gate rejects", async () => {
    const harness = createInMemoryHarness();
    // member-a is the elected authority; only member-b (the host) may start.
    const host = (memberId: string) => memberId === "member-b";
    const a = join(harness, "member-a", "Ada", "state", host);
    const c = join(harness, "member-c", "Cy", "state", host);
    const b = join(harness, "member-b", "Ben", "state", host);
    for (const player of [a, b, c]) await player.session.join();
    harness.drain();
    for (const player of [a, b, c]) player.session.ready();
    await flush(harness);

    // Only the host may start. A non-host request is rejected and reported.
    c.session.start();
    await flush(harness);

    expect(a.starts).toHaveLength(0);
    expect(a.errors).toEqual(["invalid_state"]);
  });

  it("ignores the host's request before every source is verified", async () => {
    const harness = createInMemoryHarness();
    let verified = false;
    const gate = (memberId: string) => memberId === "member-b" && verified;
    const a = join(harness, "member-a", "Ada", "state", gate);
    const b = join(harness, "member-b", "Ben", "state", gate);
    await a.session.join();
    await b.session.join();
    harness.drain();
    a.session.ready();
    b.session.ready();
    await flush(harness);

    b.session.start();
    await flush(harness);

    expect(a.starts).toHaveLength(0);
    expect(a.errors).toEqual(["invalid_state"]);
  });

  it("starts the game once the host's request passes the gate", async () => {
    const harness = createInMemoryHarness();
    let verified = true;
    const gate = (memberId: string) => memberId === "member-b" && verified;
    const a = join(harness, "member-a", "Ada", "state", gate);
    const b = join(harness, "member-b", "Ben", "state", gate);
    await a.session.join();
    await b.session.join();
    harness.drain();
    a.session.ready();
    b.session.ready();
    await flush(harness);

    b.session.start();
    await flush(harness);

    expect(a.starts).toHaveLength(1);
    expect(b.starts).toHaveLength(1);
    expect(a.errors).toEqual([]);
  });

  it("a re-sent request after the gate opens starts the game once everywhere", async () => {
    const harness = createInMemoryHarness();
    // The elected authority (a) has not verified the sources yet, so it rejects.
    let verified = false;
    const gate = (memberId: string) => memberId === "member-b" && verified;
    const a = join(harness, "member-a", "Ada", "state", gate);
    const b = join(harness, "member-b", "Ben", "state", gate);
    await a.session.join();
    await b.session.join();
    harness.drain();
    a.session.ready();
    b.session.ready();
    await flush(harness);

    b.session.start();
    await flush(harness);
    expect(a.starts).toHaveLength(0);

    // The sources are verified now; the host re-sends its request.
    verified = true;
    b.session.resendStartRequest();
    await flush(harness);

    expect(a.starts).toHaveLength(1);
    expect(b.starts).toHaveLength(1);
  });
});
