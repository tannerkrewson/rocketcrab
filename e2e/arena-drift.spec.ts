/**
 * Nova Drift, a ticking game, in two real runtime frames: one player's
 * keyboard steers the puck on every screen, and the puck keeps moving after
 * the authority is suspended and another player takes over the tick.
 */
import { expect, test, type Frame, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DRIFT_HTML = readFileSync(
  path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "examples",
    "games",
    "nova-drift.html",
  ),
  "utf8",
);

async function runtimeFrameOf(page: Page, playerId: string): Promise<Frame> {
  const handle = await page
    .locator(`[data-testid="arena-frame-${playerId}"] iframe`)
    .elementHandle();
  const frame = await handle?.contentFrame();
  if (!frame) throw new Error(`No runtime frame for ${playerId}.`);
  return frame;
}

type GameWindow = Window & { nova: { state: { get(): { puck: { x: number } } | null } } };

/** The puck's x in one player's game, from the state Nova delivered to it. */
async function puckX(frame: Frame): Promise<number | null> {
  return frame.evaluate(() => {
    const api = (window as unknown as { __runtimeApi: { getGameWindow(): Window | null } })
      .__runtimeApi;
    const game = api.getGameWindow() as GameWindow | null;
    return game?.nova.state.get()?.puck.x ?? null;
  });
}

async function key(frame: Frame, type: "keydown" | "keyup", name: string): Promise<void> {
  await frame.evaluate(
    ({ type, name }) => {
      const api = (window as unknown as { __runtimeApi: { getGameWindow(): Window | null } })
        .__runtimeApi;
      const game = api.getGameWindow();
      game?.document.dispatchEvent(new (game as typeof window).KeyboardEvent(type, { key: name }));
    },
    { type, name },
  );
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

test("Nova Drift: controls steer the puck everywhere and survive a host handoff", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto("/");
  await page.evaluate((source) => {
    sessionStorage.setItem(
      "nova:draft-source:v1",
      JSON.stringify({ gameId: "draft-drift", source, updatedAt: Date.now() }),
    );
  }, DRIFT_HTML);
  await page.goto("/editor");
  await expect(page.locator('[data-testid^="arena-frame-player-"] iframe')).toHaveCount(2, {
    timeout: 30_000,
  });
  await expect(page.getByText("Test passed")).toBeVisible({ timeout: 90_000 });

  const one = await runtimeFrameOf(page, "player-1");
  const two = await runtimeFrameOf(page, "player-2");
  await expect.poll(() => puckX(one), { timeout: 15_000 }).toBe(400);

  // Player 2 holds right: the authority's tick moves the puck for both.
  await key(two, "keydown", "ArrowRight");
  await expect.poll(() => puckX(one), { timeout: 15_000 }).toBeGreaterThan(450);
  await expect.poll(() => puckX(two), { timeout: 15_000 }).toBeGreaterThan(450);

  await key(two, "keyup", "ArrowRight");

  // Suspend the authority: the other player takes over the tick, and its
  // keys still steer.
  const authority = await authorityPlayerId(page);
  expect(authority).not.toBeNull();
  const survivor = authority === "player-1" ? two : one;
  const card = page.locator(`[data-testid="arena-grid"] [data-testid="arena-player-${authority}"]`);
  await card.getByRole("button", { name: /Suspend/ }).click();
  await expect.poll(() => authorityPlayerId(page), { timeout: 30_000 }).not.toBe(authority);
  const x = (await puckX(survivor)) ?? 0;
  await key(survivor, "keydown", "ArrowLeft");
  await expect.poll(() => puckX(survivor), { timeout: 15_000 }).toBeLessThan(x - 40);
});
