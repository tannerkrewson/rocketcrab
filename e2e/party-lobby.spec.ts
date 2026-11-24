/**
 * Direct-WebRTC lobby-to-start control for party-tunnel.spec.ts. Separate
 * party-flow failures from tunnel failures, without retries hiding stalls.
 */
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import {
  expectPlayViewOnAll,
  recordConsole,
  recordCopiedInvites,
  seedPlayerName,
} from "./party-debug";
import { NOVA_QUIZ_HTML } from "./quiz-frame-helpers";

test.describe.configure({ retries: 0 });

const GAME_ID = "game_lobby_quiz";
const PARTY_ORIGIN = "http://localhost:2722";

async function newPlayer(browser: Browser): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ baseURL: PARTY_ORIGIN });
  await recordCopiedInvites(context);
  await seedPlayerName(context, `Player ${Math.random().toString(36).slice(2, 6)}`);
  return { context, page: await context.newPage() };
}

test("three players reach the lobby and start the game on every browser", async ({ browser }) => {
  test.setTimeout(300_000);
  const players = [await newPlayer(browser), await newPlayer(browser), await newPlayer(browser)];
  const [host, joiner, third] = players.map((player) => player.page) as [Page, Page, Page];
  // A unique run id keeps each repeat's trace files apart (PLAY_TRACE_DIR).
  const run = Date.now().toString(36);
  const labels = ["host", "joiner", "third"].map(
    (role) => `${browser.browserType().name()}-${role}-${run}`,
  );
  players.forEach((player, index) => recordConsole(player.page, labels[index]!));
  const pages = [host, joiner, third].map((page, index) => ({ page, label: labels[index]! }));
  try {
    await host.goto("/");
    await host.evaluate(
      ([gameId, source]) =>
        sessionStorage.setItem(
          "nova:party-source:v1",
          JSON.stringify({ gameId, source, updatedAt: Date.now() }),
        ),
      [GAME_ID, NOVA_QUIZ_HTML] as const,
    );
    await host.goto(`/party?gameId=${GAME_ID}&title=Lobby%20Quiz`);

    await expect(host.getByRole("button", { name: "Copy URL" })).toBeEnabled({ timeout: 120_000 });
    await host.getByRole("button", { name: "Copy URL" }).click();
    let invite = "";
    await expect
      .poll(async () => {
        invite = await host.evaluate(
          () => (window as unknown as { __copied: string[] }).__copied.at(-1) ?? "",
        );
        return invite;
      })
      .toContain("/party#secret=");

    await joiner.goto(invite);
    await third.goto(invite);
    for (const page of [host, joiner, third]) {
      await expect(page.locator('[data-testid^="party-member-"]')).toHaveCount(3, {
        timeout: 120_000,
      });
    }

    const startButton = host.getByRole("button", { name: "Start game" });
    await expect(startButton).toBeEnabled({ timeout: 180_000 });
    await startButton.click();
    await expectPlayViewOnAll(pages);
  } finally {
    for (const player of players) await player.context.close();
  }
});
