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
  seedPartySource,
  seedPlayerName,
} from "./party-debug";
import { findRuntimeFrame } from "./runtime-helpers";

test.describe.configure({ retries: 0 });

const GAME_ID = "game_reload_seats";
const PARTY_ORIGIN = "http://localhost:2722";

const SEATS_HTML = `<!doctype html>
<html><body><pre id="state"></pre><button id="share">Share picture</button><img id="picture">
<p id="file-error"></p><script>
const picture = document.getElementById("picture");
const fileError = document.getElementById("file-error");
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
  actions: {
    share(state, context, ref) {
      state.picture = ref;
    },
  },
});
document.getElementById("share").onclick = async () => {
  try {
    // Larger than a Trystero action frame so this exercises binary chunking.
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="23" height="23">' +
      '<rect width="23" height="23" fill="green"/><!--' + " ".repeat(48 * 1024) + '--></svg>';
    const ref = await nova.files.put(new Blob([svg], { type: "image/svg+xml" }));
    await nova.dispatch({ type: "share", payload: ref });
  } catch (error) {
    fileError.textContent = error.message;
  }
};
let pictureRef;
nova.state.onChange(async (state) => {
  document.getElementById("state").textContent = JSON.stringify(state);
  if (!state.picture || state.picture === pictureRef) return;
  pictureRef = state.picture;
  try {
    picture.src = await nova.files.url(pictureRef);
  } catch (error) {
    fileError.textContent = error.message;
  }
});
nova.ready();
</script></body></html>`;

interface Seats {
  seats: string[];
  log: string[];
}

async function newPlayer(
  browser: Browser,
  forceTunnel = false,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ baseURL: PARTY_ORIGIN });
  await recordCopiedInvites(context);
  await seedPlayerName(context, `Player ${Math.random().toString(36).slice(2, 6)}`);
  if (forceTunnel) {
    await context.addInitScript(() => {
      (window as { __NOVA_TEST_FORCE_TUNNEL__?: boolean }).__NOVA_TEST_FORCE_TUNNEL__ = true;
    });
  }
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
      const api = (window as unknown as { __runtimeApi?: { getGameWindow(): Window | null } })
        .__runtimeApi;
      const game = api?.getGameWindow() as (Window & { nova?: { player?: { id: string } } }) | null;
      const text = game?.document.getElementById("state")?.textContent ?? "";
      return {
        id: game?.nova?.player?.id ?? null,
        state: text === "" ? null : (JSON.parse(text) as Seats),
      };
    })
    .catch(() => null);
}

async function expectSharedPicture(page: Page): Promise<void> {
  await expect
    .poll(
      async () =>
        (await gameFrame(page)).evaluate(() => {
          const api = (window as unknown as { __runtimeApi?: { getGameWindow(): Window | null } })
            .__runtimeApi;
          const doc = api?.getGameWindow()?.document;
          return {
            width: doc?.querySelector<HTMLImageElement>("#picture")?.naturalWidth,
            error: doc?.getElementById("file-error")?.textContent,
          };
        }),
      { timeout: 45_000 },
    )
    .toEqual({ width: 23, error: "" });
}

async function verifyReload(browser: Browser, forceTunnel: boolean): Promise<void> {
  test.setTimeout(300_000);
  const players = [await newPlayer(browser), await newPlayer(browser, forceTunnel)];
  const [host, joiner] = players.map((player) => player.page) as [Page, Page];
  const pages = [
    { page: host, label: "host" },
    { page: joiner, label: "joiner" },
  ];
  recordConsole(host, "host");
  recordConsole(joiner, "joiner");
  try {
    await seedPartySource(host, GAME_ID, SEATS_HTML);
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
    if (forceTunnel) {
      await expect
        .poll(
          () =>
            joiner.evaluate(() => {
              const debug = (window as { __NOVA_PARTY_DEBUG__?: () => { relayedPeers: number } })
                .__NOVA_PARTY_DEBUG__;
              return debug?.().relayedPeers ?? 0;
            }),
          { timeout: 30_000 },
        )
        .toBeGreaterThan(0);
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

    await (
      await gameFrame(joiner)
    ).evaluate(() => {
      const api = (window as unknown as { __runtimeApi?: { getGameWindow(): Window | null } })
        .__runtimeApi;
      api?.getGameWindow()?.document.getElementById("share")?.click();
    });
    await Promise.all([expectSharedPicture(host), expectSharedPicture(joiner)]);
    await joiner.reload();
    await expectPlayViewOnAll(pages);
    await expect.poll(async () => (await readGame(joiner))?.id, { timeout: 120_000 }).toBe(before);
    await expect
      .poll(async () => (await readGame(joiner))?.state?.seats.includes(before!), {
        timeout: 60_000,
      })
      .toBe(true);
    await expectSharedPicture(joiner);

    if (forceTunnel) return;
    // Past the grace period, the host's game never saw the reload as a leave.
    await host.waitForTimeout(playerLeaveGraceMs + 5_000);
    const after = await readGame(host);
    expect(after?.state?.log.filter((entry) => entry.startsWith("left"))).toEqual([]);
    expect(after?.state?.seats).toContain(before);
  } finally {
    for (const player of players) await player.context.close();
  }
}

test("a player who reloads mid-game keeps their id, seat and shared picture", async ({
  browser,
}) => {
  await verifyReload(browser, false);
});

test("a player who reloads over a tunnel can still fetch the shared picture", async ({
  browser,
}) => {
  await verifyReload(browser, true);
});
