/**
 * S4 — the state-mode vertical slice in a real browser.
 *
 * The complete example game (examples/games/nova-quiz.html) runs in the U6
 * multi-player arena (apps/nova) with four REAL runtime frames over the real
 * in-memory transport: every game frame is an actual runtime-origin iframe
 * executing the game's own HTML, and the host routes Nova API calls through
 * the real session engine. This is the "run four simulated players" step of
 * the S4 end-to-end flow, automated:
 *
 *  1. seed the example game as a draft, open /editor, press Test multiplayer;
 *  2. add players 3 and 4 (four simulated players total);
 *  3. play round 1: answer in every non-quizmaster frame, reveal via the
 *     quizmaster, verify the public results and scores;
 *  4. advance to round 2 and play it;
 *  5. suspend the current AUTHORITY player (simulated backgrounded phone),
 *     observe the elected authority move, and verify the game survives;
 *  6. resume the suspended player and verify it reconnects and receives the
 *     current state (S2 catch-up);
 *  7. keep playing on the migrated authority.
 *
 * The physical-phone steps of the 14-step flow (6/10/13) cannot run here;
 * they are covered by the human checklist in docs/testing/state-mode-
 * vertical-slice.md.
 *
 * Screenshots for the docs are captured when CAPTURE_S4_SCREENSHOTS=1.
 */
import { expect, test, type Frame, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dirname = path.dirname(fileURLToPath(import.meta.url));

const GAME_HTML = readFileSync(
  path.join(dirname, "..", "examples", "games", "nova-quiz.html"),
  "utf8",
);

const PLAYER_IDS = ["player-1", "player-2", "player-3", "player-4"];

interface GameFrameState {
  roundChip: string | null;
  quizmaster: string | null;
  question: string | null;
  phase: "waiting" | "question" | "revealed" | "finished" | "unknown";
  spectator: boolean;
  revealButton: boolean;
  nextButton: boolean;
  answersList: boolean;
  scores: string | null;
  connChip: string | null;
}

/** The runtime frame hosting one arena player's game frame. */
async function runtimeFrameOf(page: Page, playerId: string): Promise<Frame> {
  const handle = await page
    .locator(`[data-testid="arena-frame-${playerId}"] iframe`)
    .elementHandle();
  if (handle === null) {
    throw new Error(`No runtime frame for ${playerId}.`);
  }
  const frame = await handle.contentFrame();
  if (frame === null) {
    throw new Error(`No content frame inside ${playerId}'s runtime iframe.`);
  }
  return frame;
}

/** Snapshot the game's DOM through the runtime frame's game window. */
async function gameState(frame: Frame): Promise<GameFrameState | null> {
  return frame.evaluate(() => {
    const api = (window as unknown as { __runtimeApi: { getGameWindow(): Window | null } })
      .__runtimeApi;
    const doc = api.getGameWindow()?.document;
    if (doc === undefined) return null;
    const text = (selector: string): string | null =>
      doc.querySelector(selector)?.textContent?.trim() ?? null;
    const has = (selector: string): boolean => doc.querySelector(selector) !== null;
    const quizmaster = doc.querySelector(".quizmaster-line span")?.textContent?.trim() ?? null;
    const question = text('[data-testid="question"]');
    const answersList = has('[data-testid="answers-list"]');
    const gameOver = has('[data-testid="game-over"]');
    let phase: GameFrameState["phase"] = "unknown";
    if (has('[data-testid="waiting-line"]')) phase = "waiting";
    else if (question !== null && !answersList && !gameOver) phase = "question";
    else if (answersList && !gameOver) phase = "revealed";
    else if (gameOver) phase = "finished";
    return {
      roundChip: text('[data-testid="round-chip"]'),
      quizmaster,
      question,
      phase,
      spectator: has('[data-testid="spectator-banner"]'),
      revealButton: has('[data-action="reveal"]'),
      nextButton: has('[data-action="next"]'),
      answersList,
      scores: text('[data-testid="scores"]'),
      connChip: text('[data-testid="conn-chip"]'),
    };
  });
}

async function waitForGameState(
  frame: Frame,
  predicate: (state: GameFrameState) => boolean,
  timeoutMs = 60_000,
): Promise<GameFrameState> {
  const deadline = Date.now() + timeoutMs;
  let last: GameFrameState | null = null;
  for (;;) {
    last = await gameState(frame);
    if (last !== null && predicate(last)) return last;
    if (Date.now() > deadline) {
      throw new Error(
        `Timed out waiting for the game frame (last state: ${JSON.stringify(last)}).`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

/** Dispatch a synthetic click inside one game frame. */
async function clickInGame(frame: Frame, selector: string): Promise<void> {
  await frame.evaluate((clickSelector) => {
    const api = (window as unknown as { __runtimeApi: { getGameWindow(): Window | null } })
      .__runtimeApi;
    const element = api
      .getGameWindow()
      ?.document.querySelector(clickSelector) as HTMLElement | null;
    element?.click();
  }, selector);
}

/** Map an arena player card id from its game-frame quizmaster label. */
function quizmasterPlayerId(quizmaster: string | null): string {
  const match = /^🎤 (.+?) is the quizmaster$/u.exec(quizmaster ?? "");
  if (match === null) {
    throw new Error(`Could not parse the quizmaster line: ${String(quizmaster)}`);
  }
  const number = /Player (\d+)/u.exec(match[1])?.[1];
  if (number === undefined) {
    throw new Error(`Unexpected quizmaster name: ${match[1]}`);
  }
  return `player-${number}`;
}

/** The arena player card (scoped to the desktop grid: every card also
 * renders in the phone-tab layout, so unscoped locators would be strict-mode
 * violations). */
function playerCard(page: Page, playerId: string): ReturnType<Page["locator"]> {
  return page.locator(`[data-testid="arena-desktop"] [data-testid="arena-player-${playerId}"]`);
}

async function authorityPlayerId(page: Page): Promise<string | null> {
  const cards = page.locator('[data-testid="arena-desktop"] section[data-testid^="arena-player-"]');
  for (let index = 0; index < (await cards.count()); index += 1) {
    const card = cards.nth(index);
    if ((await card.locator(".badge-accent").count()) > 0) {
      return (await card.getAttribute("data-testid"))?.replace("arena-player-", "") ?? null;
    }
  }
  return null;
}

async function capture(page: Page, name: string): Promise<void> {
  if (process.env.CAPTURE_S4_SCREENSHOTS !== "1") return;
  const dir = path.join(dirname, "..", "docs", "testing", "screenshots");
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: path.join(dir, name), fullPage: false });
}

/** Seed the draft, open the consolidated editor, and reach four players in
 *  the embedded test arena (the arena moved onto the editor page, 7.40). */
async function openArenaWithFourPlayers(page: Page): Promise<void> {
  // Seed the example game as a draft so the /editor route opens with it.
  await page.goto("/");
  await page.evaluate((source) => {
    sessionStorage.setItem(
      "nova:draft-source:v1",
      JSON.stringify({ gameId: "draft-s4", source, updatedAt: Date.now() }),
    );
  }, GAME_HTML);
  await page.goto("/editor");

  // The test arena lives on the editor page now: open it with the draft.
  const testButton = page.getByRole("button", { name: /Test multiplayer/ }).first();
  await expect(testButton).toBeVisible({ timeout: 30_000 });
  await testButton.click();

  const addButton = page.getByRole("button", { name: /Add player/ });
  await expect(addButton).toBeVisible({ timeout: 30_000 });
  for (let index = 0; index < 2; index += 1) {
    await addButton.click();
  }
  await expect(page.locator('[data-testid^="arena-frame-player-"] iframe')).toHaveCount(4, {
    timeout: 30_000,
  });
  // A clean run: every player registered and started (U6 summary badge).
  await expect(page.getByText("Test passed")).toBeVisible({ timeout: 90_000 });
}

test.describe("S4 arena — four simulated players play Nova Quiz", () => {
  test("plays full rounds, survives authority loss, and reconnects", async ({ page }) => {
    test.setTimeout(240_000);
    await openArenaWithFourPlayers(page);

    // The join window closes and round 1 goes live in every frame.
    const player1 = await runtimeFrameOf(page, "player-1");
    let state = await waitForGameState(player1, (s) => s.phase === "question");
    expect(state.roundChip).toMatch(/^Round 1 of /u);
    const round1Quizmaster = quizmasterPlayerId(state.quizmaster);
    await capture(page, "arena-round-1.png");

    // Round 1: everyone except the quizmaster answers; the quizmaster
    // reveals. Answer buttons are only clickable for roster players, so
    // clicking everywhere is safe (spectators' clicks are ignored).
    for (const playerId of PLAYER_IDS) {
      if (playerId !== round1Quizmaster) {
        await clickInGame(await runtimeFrameOf(page, playerId), '[data-choice="1"]');
      }
    }
    await clickInGame(await runtimeFrameOf(page, round1Quizmaster), '[data-action="reveal"]');
    state = await waitForGameState(player1, (s) => s.phase === "revealed");
    expect(state.answersList).toBe(true);
    expect(state.scores).toContain("Player");
    await capture(page, "arena-round-1-revealed.png");

    // Advance to round 2 (the round-1 quizmaster drives the next round).
    await clickInGame(await runtimeFrameOf(page, round1Quizmaster), '[data-action="next"]');
    state = await waitForGameState(player1, (s) => s.phase === "question");
    expect(state.roundChip).toMatch(/^Round 2 of /u);
    const round2Quizmaster = quizmasterPlayerId(state.quizmaster);
    expect(round2Quizmaster).not.toBe(round1Quizmaster); // the quizmaster rotates
    for (const playerId of PLAYER_IDS) {
      if (playerId !== round2Quizmaster) {
        await clickInGame(await runtimeFrameOf(page, playerId), '[data-choice="2"]');
      }
    }

    // Authority migration (issue step 10: background the authority phone).
    const authorityBefore = await authorityPlayerId(page);
    expect(authorityBefore).not.toBeNull();
    const suspendedPlayerId = authorityBefore as string;
    const suspendedCard = playerCard(page, suspendedPlayerId);
    await suspendedCard.getByRole("button", { name: /Suspend/ }).click();
    await expect(suspendedCard.getByText("Suspended", { exact: true })).toBeVisible({
      timeout: 10_000,
    });
    await capture(page, "arena-authority-suspended.png");

    // Peers elect a new authority (S3); the badge moves off the suspended
    // player's card.
    await expect
      .poll(async () => authorityPlayerId(page), { timeout: 30_000 })
      .not.toBe(authorityBefore);
    const authorityAfter = await authorityPlayerId(page);
    expect(authorityAfter).not.toBeNull();

    // The game continued through the election: round 2 still open, and the
    // quizmaster can still reveal (its dispatch reaches the new authority).
    state = await waitForGameState(
      await runtimeFrameOf(page, round2Quizmaster),
      (s) => s.phase === "question",
    );
    expect(state.question).not.toBeNull();
    await clickInGame(await runtimeFrameOf(page, round2Quizmaster), '[data-action="reveal"]');
    await waitForGameState(
      await runtimeFrameOf(page, round2Quizmaster),
      (s) => s.phase === "revealed",
    );

    // The suspended player's frame is frozen on the pre-reveal question…
    const suspendedState = await gameState(await runtimeFrameOf(page, suspendedPlayerId));
    expect(suspendedState?.phase).toBe("question");

    // …and after resume it reconnects and receives the current state.
    await suspendedCard.getByRole("button", { name: /Resume/ }).click();
    await expect(suspendedCard.getByText("Connected", { exact: true })).toBeVisible({
      timeout: 30_000,
    });
    const reconnected = await waitForGameState(
      await runtimeFrameOf(page, suspendedPlayerId),
      (s) => s.phase === "revealed" && s.roundChip?.startsWith("Round 2") === true,
    );
    expect(reconnected.answersList).toBe(true);
    await capture(page, "arena-reconnected-caught-up.png");

    // The game keeps going on the migrated authority: round 3 starts.
    await clickInGame(await runtimeFrameOf(page, round2Quizmaster), '[data-action="next"]');
    const round3 = await waitForGameState(
      await runtimeFrameOf(page, round2Quizmaster),
      (s) => s.phase === "question",
    );
    expect(round3.roundChip).toMatch(/^Round 3 of /u);
    await capture(page, "arena-round-3.png");
  });
});
