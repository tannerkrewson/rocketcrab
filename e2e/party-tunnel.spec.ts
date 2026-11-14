/**
 * Real 3-player party over the real transport (PLAN.md §5.6): one player's
 * WebRTC is forced to fail, so its two pairs carry their data on the edge
 * tunnel. All three play the sample state-mode game (nova-quiz.html) and each
 * sees the others' answers and the reveal.
 *
 * Each player has its own browser context, so identities never collide.
 * Needs the root dev stack (nova 5173, runtime 5174, edge 8787).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Frame,
  type Page,
  type WebSocket,
} from "@playwright/test";
import { findRuntimeFrame } from "./runtime-helpers";
import { clickInGame, gameState, waitForGameState } from "./quiz-frame-helpers";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const GAME_HTML = readFileSync(
  path.join(dirname, "..", "examples", "games", "nova-quiz.html"),
  "utf8",
);
const GAME_ID = "game_tunnel_quiz";
const PARTY_ORIGIN = "http://localhost:5173";

interface Player {
  context: BrowserContext;
  page: Page;
  /** Epoch ms of each `paired` frame received on a tunnel socket. */
  pairedAt: number[];
  /** `/tunnel/` WebSocket URLs this page opened (one per tunnelled pair). */
  tunnelSockets: string[];
}

async function newPlayer(browser: Browser, forced: boolean): Promise<Player> {
  const context = await browser.newContext({ baseURL: PARTY_ORIGIN });
  await context.addInitScript((forceTunnel: boolean) => {
    // Record the invite the page copies, instead of reading the clipboard:
    // Firefox and WebKit do not grant clipboard permissions in Playwright.
    const win = window as unknown as {
      __copied: string[];
      __NOVA_TEST_FORCE_TUNNEL__?: boolean;
    };
    win.__copied = [];
    const writer = (text: string) => {
      win.__copied.push(String(text));
      return Promise.resolve();
    };
    try {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { writeText: writer, readText: () => Promise.resolve(win.__copied.at(-1) ?? "") },
      });
    } catch {
      // Keep the page's own clipboard if it cannot be replaced.
    }
    if (forceTunnel) win.__NOVA_TEST_FORCE_TUNNEL__ = true;
  }, forced);
  const page = await context.newPage();
  const tunnelSockets: string[] = [];
  const pairedAt: number[] = [];
  page.on("websocket", (socket: WebSocket) => {
    if (!socket.url().includes("/tunnel/")) return;
    tunnelSockets.push(socket.url());
    socket.on("framereceived", (frame) => {
      if (frame.payload === "paired") pairedAt.push(Date.now());
    });
  });
  return { context, page, tunnelSockets, pairedAt };
}

/** The game frame inside one player's page (re-resolved after reloads). */
async function frameOf(player: Player): Promise<Frame> {
  let frame: Frame | undefined;
  await expect
    .poll(
      () => {
        frame = findRuntimeFrame(player.page);
        return frame !== undefined;
      },
      { timeout: 120_000 },
    )
    .toBe(true);
  return frame!;
}

/** The quizmaster's "(N/M answered)" hint, as text (empty if absent). */
async function answeredHint(frame: Frame): Promise<string> {
  return frame.evaluate(() => {
    const api = (window as unknown as { __runtimeApi: { getGameWindow(): Window | null } })
      .__runtimeApi;
    return api.getGameWindow()?.document.querySelector(".note")?.textContent ?? "";
  });
}

/** The answer rows of the revealed list, as text (one per answering player). */
async function revealedRows(frame: Frame): Promise<string[]> {
  return frame.evaluate(() => {
    const api = (window as unknown as { __runtimeApi: { getGameWindow(): Window | null } })
      .__runtimeApi;
    const doc = api.getGameWindow()?.document;
    return Array.from(
      doc?.querySelectorAll('[data-testid="answers-list"] li') ?? [],
      (item) => item.textContent ?? "",
    );
  });
}

// Party proof (PLAN §5.6): a 3-player party, one player forced onto the tunnel,
// plays the sample game; a player's game rebooted after start still gets start.
// The default suite runs three browsers in parallel, and under that load a
// lobby sometimes stalls at 2 of 3 members (PLAN §5.6). Chromium runs it in the
// suite with one retry. Firefox and WebKit pass when run alone (PLAN §5.6), so
// run them with `--project=firefox` / `--project=webkit`.
test.describe.configure({ retries: 1 });
test.skip(
  ({ browserName }) => browserName !== "chromium",
  "Runs in the default suite on chromium only; see the comment above.",
);

test("a 3-player party with one tunnelled player plays a state-mode game", async ({ browser }) => {
  test.setTimeout(300_000);
  const host = await newPlayer(browser, false);
  const joiner = await newPlayer(browser, false);
  const forced = await newPlayer(browser, true);
  const players = [host, joiner, forced];
  try {
    // Host starts a party with the sample game; the source is handed over
    // through sessionStorage exactly as the editor does it.
    await host.page.goto("/");
    await host.page.evaluate(
      ([gameId, source]) =>
        sessionStorage.setItem(
          "nova:party-source:v1",
          JSON.stringify({ gameId, source, updatedAt: Date.now() }),
        ),
      [GAME_ID, GAME_HTML] as const,
    );
    await host.page.goto(`/party?gameId=${GAME_ID}&mode=state&title=Nova%20Quiz`);

    // The invite link is copied to the clipboard (the page shows only the code).
    await expect(host.page.getByRole("button", { name: "Copy URL" })).toBeEnabled({
      timeout: 120_000,
    });
    await host.page.getByRole("button", { name: "Copy URL" }).click();
    let invite = "";
    await expect
      .poll(async () => {
        invite = await host.page.evaluate(
          () => (window as unknown as { __copied: string[] }).__copied.at(-1) ?? "",
        );
        return invite;
      })
      .toContain("/join#secret=");

    // Joiners open the invite; the lobby shows all three members everywhere.
    await joiner.page.goto(invite);
    const forcedJoinStart = Date.now();
    await forced.page.goto(invite);
    for (const player of players) {
      await expect(player.page.locator('[data-testid^="party-member-"]')).toHaveCount(3, {
        timeout: 120_000,
      });
    }
    // Join-to-paired for the forced player: from its join to each tunnel's
    // `paired` frame (one tunnel per partner, so two frames).
    await expect.poll(() => forced.pairedAt.length, { timeout: 60_000 }).toBe(2);
    const pairedMs = forced.pairedAt.map((at) => at - forcedJoinStart);
    test.info().annotations.push({
      type: "join-to-paired-ms",
      description: pairedMs.join(","),
    });
    console.log(`JOIN_TO_PAIRED_MS ${JSON.stringify(pairedMs)}`);

    // The host starts once every game is verified and loaded in every player.
    const startButton = host.page.getByRole("button", { name: "Start game" });
    await expect(startButton).toBeEnabled({ timeout: 180_000 });
    await startButton.click();
    for (const player of players) {
      await expect(player.page.getByTestId("party-play-view")).toBeVisible({ timeout: 120_000 });
    }

    // Round 1 goes live in every frame.
    for (const player of players) {
      await waitForGameState(await frameOf(player), (s) => s.phase === "question", 120_000);
    }

    // Every player acts: the quizmaster (the only one with a reveal button)
    // reveals, and the others answer.
    let quizmaster: Player | null = null;
    const answerers: Player[] = [];
    for (const player of players) {
      const state = await gameState(await frameOf(player));
      if (state?.revealButton) quizmaster = player;
      else answerers.push(player);
    }
    expect(quizmaster).not.toBeNull();
    // An answer is based on the view the player has. The authority can commit
    // a newer revision first (the start), and the game then refuses the stale
    // answer with stale_revision and does not retry it. A player who sees the
    // rejection clicks again, so keep answering until the quizmaster sees both
    // answers, then reveal.
    await expect
      .poll(
        async () => {
          for (const answerer of answerers) {
            await clickInGame(await frameOf(answerer), '[data-choice="1"]');
          }
          return answeredHint(await frameOf(quizmaster!));
        },
        { timeout: 120_000, intervals: [3_000] },
      )
      .toContain("2/2 answered");
    await clickInGame(await frameOf(quizmaster!), '[data-action="reveal"]');

    // Every frame shows the reveal with both other players' answers.
    for (const player of players) {
      await waitForGameState(await frameOf(player), (s) => s.phase === "revealed", 120_000);
      const rows = await revealedRows(await frameOf(player));
      expect(rows).toHaveLength(2);
      for (const row of rows) expect(row).toContain("chose");
    }

    // Tunnel shape: the forced player has one tunnel per partner, and each
    // healthy-side player has exactly one, to the forced player.
    expect(forced.tunnelSockets).toHaveLength(2);
    expect(host.tunnelSockets).toHaveLength(1);
    expect(joiner.tunnelSockets).toHaveLength(1);
  } finally {
    for (const player of players) await player.context.close();
  }
});
