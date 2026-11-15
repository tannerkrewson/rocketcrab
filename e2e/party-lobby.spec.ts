/**
 * Three players, no forced tunnel: lobby to start on every browser (PLAN §5.6).
 *
 * The control for the tunnel proof. Every pair is a direct WebRTC link, so a
 * failure here is in the party itself (membership, source transfer, the start
 * gate or its retries) and not in the tunnel. Runs with retries disabled.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";

test.describe.configure({ retries: 0 });

const dirname = path.dirname(fileURLToPath(import.meta.url));
const GAME_HTML = readFileSync(
  path.join(dirname, "..", "examples", "games", "nova-quiz.html"),
  "utf8",
);
const GAME_ID = "game_lobby_quiz";
const PARTY_ORIGIN = "http://localhost:5173";

async function newPlayer(browser: Browser): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ baseURL: PARTY_ORIGIN });
  await context.addInitScript(() => {
    // Record the invite the host copies, so the test does not need clipboard
    // permissions (Firefox and WebKit do not grant them in Playwright).
    const win = window as unknown as { __copied: string[] };
    win.__copied = [];
    try {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: (text: string) => {
            win.__copied.push(String(text));
            return Promise.resolve();
          },
          readText: () => Promise.resolve(win.__copied.at(-1) ?? ""),
        },
      });
    } catch {
      // Keep the page's own clipboard if it cannot be replaced.
    }
  });
  return { context, page: await context.newPage() };
}

test("three players reach the lobby and start the game on every browser", async ({ browser }) => {
  test.setTimeout(300_000);
  const players = [await newPlayer(browser), await newPlayer(browser), await newPlayer(browser)];
  const [host, joiner, third] = players.map((player) => player.page) as [Page, Page, Page];
  try {
    await host.goto("/");
    await host.evaluate(
      ([gameId, source]) =>
        sessionStorage.setItem(
          "nova:party-source:v1",
          JSON.stringify({ gameId, source, updatedAt: Date.now() }),
        ),
      [GAME_ID, GAME_HTML] as const,
    );
    await host.goto(`/party?gameId=${GAME_ID}&mode=state&title=Lobby%20Quiz`);

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
      .toContain("/join#secret=");

    await joiner.goto(invite);
    await third.goto(invite);
    // Every page lists all three members: membership is complete everywhere.
    for (const page of [host, joiner, third]) {
      await expect(page.locator('[data-testid^="party-member-"]')).toHaveCount(3, {
        timeout: 120_000,
      });
    }

    // Start enables once every member has the game source and has registered it.
    const startButton = host.getByRole("button", { name: "Start game" });
    await expect(startButton).toBeEnabled({ timeout: 180_000 });
    await startButton.click();
    for (const page of [host, joiner, third]) {
      await expect(page.getByTestId("party-play-view")).toBeVisible({ timeout: 120_000 });
    }
  } finally {
    for (const player of players) await player.context.close();
  }
});
