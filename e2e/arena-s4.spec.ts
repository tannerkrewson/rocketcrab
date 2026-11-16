/**
 * Play the quiz in four real runtime frames over in-memory transports,
 * including authority migration, suspension, and state catch-up.
 * Physical-device coverage lives in docs/testing/state-mode-vertical-slice.md.
 * Set CAPTURE_S4_SCREENSHOTS=1 to capture documentation screenshots.
 */
import { expect, test, type Frame, type Page } from "@playwright/test";
import { clickInGame, gameState, NOVA_QUIZ_HTML, waitForGameState } from "./quiz-frame-helpers";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dirname = path.dirname(fileURLToPath(import.meta.url));

const PLAYER_IDS = ["player-1", "player-2", "player-3", "player-4"];

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

/** Each player has one card; phone layouts hide it with CSS rather than duplicating it. */
function playerCard(page: Page, playerId: string): ReturnType<Page["locator"]> {
  return page.locator(`[data-testid="arena-grid"] [data-testid="arena-player-${playerId}"]`);
}

async function authorityPlayerId(page: Page): Promise<string | null> {
  const cards = page.locator('[data-testid="arena-grid"] section[data-testid^="arena-player-"]');
  for (let index = 0; index < (await cards.count()); index += 1) {
    const card = cards.nth(index);
    if ((await card.getByText("Authority", { exact: true }).count()) > 0) {
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

async function openArenaWithFourPlayers(page: Page): Promise<void> {
  await page.goto("/");
  await page.evaluate((source) => {
    sessionStorage.setItem(
      "nova:draft-source:v1",
      JSON.stringify({ gameId: "draft-s4", source, updatedAt: Date.now() }),
    );
  }, NOVA_QUIZ_HTML);
  await page.goto("/editor");

  const addButton = page.getByRole("button", { name: /Add player/ });
  await expect(addButton).toBeVisible({ timeout: 30_000 });
  for (let index = 0; index < 2; index += 1) {
    await addButton.click();
  }
  await expect(page.locator('[data-testid^="arena-frame-player-"] iframe')).toHaveCount(4, {
    timeout: 30_000,
  });
  await expect(page.getByText("Test passed")).toBeVisible({ timeout: 90_000 });
}

test.describe("S4 arena — four simulated players play Nova Quiz", () => {
  test("plays full rounds, survives authority loss, and reconnects", async ({ page }) => {
    test.setTimeout(240_000);
    await openArenaWithFourPlayers(page);

    const player1 = await runtimeFrameOf(page, "player-1");
    let state = await waitForGameState(player1, (s) => s.phase === "question");
    expect(state.roundChip).toMatch(/^Round 1 of /u);
    const round1Quizmaster = quizmasterPlayerId(state.quizmaster);
    await capture(page, "arena-round-1.png");

    // Answer controls reject spectators, so clicking every frame is safe.
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

    await clickInGame(await runtimeFrameOf(page, round1Quizmaster), '[data-action="next"]');
    state = await waitForGameState(player1, (s) => s.phase === "question");
    expect(state.roundChip).toMatch(/^Round 2 of /u);
    const round2Quizmaster = quizmasterPlayerId(state.quizmaster);
    expect(round2Quizmaster).not.toBe(round1Quizmaster);
    for (const playerId of PLAYER_IDS) {
      if (playerId !== round2Quizmaster) {
        await clickInGame(await runtimeFrameOf(page, playerId), '[data-choice="2"]');
      }
    }

    const authorityBefore = await authorityPlayerId(page);
    expect(authorityBefore).not.toBeNull();
    const suspendedPlayerId = authorityBefore as string;
    const suspendedCard = playerCard(page, suspendedPlayerId);
    await suspendedCard.getByRole("button", { name: /Suspend/ }).click();
    await expect(suspendedCard.getByText("Suspended", { exact: true })).toBeVisible({
      timeout: 10_000,
    });
    await capture(page, "arena-authority-suspended.png");

    await expect
      .poll(async () => authorityPlayerId(page), { timeout: 30_000 })
      .not.toBe(authorityBefore);
    const authorityAfter = await authorityPlayerId(page);
    expect(authorityAfter).not.toBeNull();

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

    const suspendedState = await gameState(await runtimeFrameOf(page, suspendedPlayerId));
    expect(suspendedState?.phase).toBe("question");

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

    await clickInGame(await runtimeFrameOf(page, round2Quizmaster), '[data-action="next"]');
    const round3 = await waitForGameState(
      await runtimeFrameOf(page, round2Quizmaster),
      (s) => s.phase === "question",
    );
    expect(round3.roundChip).toMatch(/^Round 3 of /u);
    await capture(page, "arena-round-3.png");
  });
});
