import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createInMemoryHarness } from "./harness";
import { createNovaSession, type NovaSession } from "./session";

const reference = readFileSync(
  new URL("../../../apps/nova/src/lib/prompt/nova-api-reference.md", import.meta.url),
  "utf8",
);
const examples = new Map(
  [...reference.matchAll(/^## (.+)\r?\n(?:(?!^## )[\s\S])*?^```js\r?\n([\s\S]*?)^```/gm)].map(
    ([, title, source]) => [title, source],
  ),
);

function example(title: string): string {
  const source = examples.get(title);
  if (!source) throw new Error(`No JavaScript example under "${title}"`);
  return source;
}

const sessions: NovaSession[] = [];

afterEach(async () => {
  await Promise.all(sessions.splice(0).map((session) => session.dispose()));
});

function setup(title: string) {
  const harness = createInMemoryHarness();
  function player(memberId: string) {
    const session = createNovaSession({
      transport: harness.createTransport({ memberId }),
      room: "arena",
      sessionId: "session-examples",
      player: { memberId, displayName: memberId },
      game: { gameId: "game-example", title: "Example Game" },
    });
    sessions.push(session);

    // The real-time snippet expects a button and the page's event and animation APIs.
    const events = new EventTarget();
    const run = new Function(
      "nova",
      "addEventListener",
      "requestAnimationFrame",
      "document",
      `${example(title)}\n${title === "Turn-based example" ? "return draw;" : ""}`,
    );
    const draw = run(session.client, events.addEventListener.bind(events), () => 0, {
      getElementById: () => ({}),
    });
    const onStart = vi.fn();
    session.client.onStart(onStart);
    return { session, events, draw, onStart };
  }

  const a = player("member-a");
  const b = player("member-b");
  async function until(assertion: () => void) {
    await vi.waitFor(
      () => {
        harness.drain();
        assertion();
      },
      { interval: 5 },
    );
  }
  async function start() {
    await a.session.join();
    await b.session.join();
    await until(() => expect(a.session.readyOf("member-b")).toBe(true));
    a.session.start();
    await until(() => expect(b.onStart).toHaveBeenCalledOnce());
  }
  return { a, b, start, until };
}

describe("API reference examples", () => {
  it("registers and starts the whole API example", async () => {
    const { a, start, until } = setup("The whole API");
    await start();
    await until(() => {
      const state = a.session.client.state.get() as { plays: number };
      expect(state.plays).toBeGreaterThan(0);
    });
    expect(a.session.declaration?.apiVersion).toBe(1);
  });

  it("starts the smallest game in at most 30 lines", async () => {
    const title = "Smallest game";
    expect(example(title).trim().split("\n").length).toBeLessThanOrEqual(30);
    const { a, start } = setup(title);
    await start();
    expect(a.session.declaration).toEqual({ title: "Hello Nova", apiVersion: 1 });
  });

  it("draws a card through an action and keeps it out of the other player's view", async () => {
    const { a, b, start, until } = setup("Turn-based example");
    await start();
    b.draw();
    await until(() => {
      expect(b.session.client.state.get()).toEqual({ hand: "queen", cardsLeft: 2 });
      expect(a.session.client.state.get()).toEqual({ hand: null, cardsLeft: 2 });
    });
  });

  it("moves a dot in response to controls sent to the authority", async () => {
    const { b, start, until } = setup("Real-time example");
    await start();
    b.events.dispatchEvent(Object.assign(new Event("keydown"), { key: "ArrowLeft" }));
    await until(() => {
      const state = b.session.client.state.get() as { dots: Record<string, { x: number }> };
      expect(state.dots["member-b"]?.x).toBeLessThan(50);
      expect(state.dots["member-a"]?.x).toBe(50);
    });
  });
});
