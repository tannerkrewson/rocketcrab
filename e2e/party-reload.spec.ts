/**
 * A player who reloads mid-game comes back with the same player id, inside
 * the leave grace period, so the game's playerLeft never runs for them.
 */
import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Frame,
  type Page,
} from "@playwright/test";
import { playerLeaveGraceMs } from "@rocketcrab/protocol";
import {
  expectPlayViewOnAll,
  recordConsole,
  recordCopiedInvites,
  seedPlayerName,
} from "./party-debug";
import { findRuntimeFrame } from "./runtime-helpers";

test.describe.configure({ retries: 0 });

const GAME_ID = "game_reload_seats";
const PARTY_ORIGIN = "http://localhost:2722";

const SEATS_HTML = `<!doctype html>
<html><body><pre id="state"></pre><script>
nova.defineGame({
  title: "Seats",
  apiVersion: 1,
  createInitialState: (context) => ({ seats: context.players.map((p) => p.id), log: [] }),
  playerJoined(state, context, player) {
    if (!state.seats.includes(player.id)) state.seats.push(player.id);
    state.log.push("joined " + player.id);
  },
  playerLeft(state, context, player) {
    state.seats = state.seats.filter((id) => id !== player.id);
    state.log.push("left " + player.id);
  },
});
nova.state.onChange((state) => {
  document.getElementById("state").textContent = JSON.stringify(state);
});
nova.ready();
</script></body></html>`;

interface Seats {
  seats: string[];
  log: string[];
}

async function newPlayer(browser: Browser): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ baseURL: PARTY_ORIGIN });
  await recordCopiedInvites(context);
  await seedPlayerName(context, `Player ${Math.random().toString(36).slice(2, 6)}`);
  return { context, page: await context.newPage() };
}

async function gameFrame(page: Page): Promise<Frame> {
  let frame: Frame | undefined;
  await expect
    .poll(() => (frame = findRuntimeFrame(page)) !== undefined, { timeout: 120_000 })
    .toBe(true);
  return frame!;
}

/** This player's id and the game state its frame shows, or null while the frame boots. */
async function readGame(page: Page): Promise<{ id: string | null; state: Seats | null } | null> {
  const frame = await gameFrame(page);
  return frame
    .evaluate(() => {
      const api = (window as unknown as { __runtimeApi: { getGameWindow(): Window | null } })
        .__runtimeApi;
      const game = api.getGameWindow() as (Window & { nova?: { player?: { id: string } } }) | null;
      const text = game?.document.getElementById("state")?.textContent ?? "";
      return {
        id: game?.nova?.player?.id ?? null,
        state: text === "" ? null : (JSON.parse(text) as Seats),
      };
    })
    .catch(() => null);
}

test("a player who reloads mid-game keeps their id and seat", async ({ browser }) => {
  test.setTimeout(300_000);
  const players = [await newPlayer(browser), await newPlayer(browser)];
  const [host, joiner] = players.map((player) => player.page) as [Page, Page];
  const pages = [
    { page: host, label: "host" },
    { page: joiner, label: "joiner" },
  ];
  recordConsole(host, "host");
  recordConsole(joiner, "joiner");
  try {
    await host.goto("/");
    await host.evaluate(
      ([gameId, source]) =>
        sessionStorage.setItem(
          "nova:party-source:v1",
          JSON.stringify({ gameId, source, updatedAt: Date.now() }),
        ),
      [GAME_ID, SEATS_HTML] as const,
    );
    await host.goto(`/party?gameId=${GAME_ID}&title=Seats`);
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
    for (const page of [host, joiner]) {
      await expect(page.locator('[data-testid^="party-member-"]')).toHaveCount(2, {
        timeout: 120_000,
      });
    }
    const startButton = host.getByRole("button", { name: "Start game", exact: true });
    await expect(startButton).toBeEnabled({ timeout: 180_000 });
    await startButton.click();
    await expectPlayViewOnAll(pages);

    let before: string | null = null;
    await expect
      .poll(async () => (before = (await readGame(joiner))?.id ?? null), { timeout: 60_000 })
      .not.toBeNull();
    await expect
      .poll(async () => (await readGame(host))?.state?.seats.includes(before!), { timeout: 60_000 })
      .toBe(true);

    await joiner.reload();
    await expectPlayViewOnAll([{ page: joiner, label: "joiner" }]);
    await expect.poll(async () => (await readGame(joiner))?.id, { timeout: 120_000 }).toBe(before);
    await expect
      .poll(async () => (await readGame(joiner))?.state?.seats.includes(before!), {
        timeout: 60_000,
      })
      .toBe(true);

    // Past the grace period, the host's game never saw the reload as a leave.
    await host.waitForTimeout(playerLeaveGraceMs + 5_000);
    const after = await readGame(host);
    expect(after?.state?.log.filter((entry) => entry.startsWith("left"))).toEqual([]);
    expect(after?.state?.seats).toContain(before);
  } finally {
    for (const player of players) await player.context.close();
  }
});
