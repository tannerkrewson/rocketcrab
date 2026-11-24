/**
 * Three isolated browser contexts play nova-quiz with one player's WebRTC
 * forced onto edge tunnels. Requires the root dev stack: Nova on 2722,
 * runtime on 2723. Vite proxies /api to the local Worker.
 */
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
import {
  expectPlayViewOnAll,
  recordConsole,
  recordCopiedInvites,
  seedPlayerName,
} from "./party-debug";
import { clickInGame, gameState, NOVA_QUIZ_HTML, waitForGameState } from "./quiz-frame-helpers";

const GAME_ID = "game_tunnel_quiz";
const PARTY_ORIGIN = "http://localhost:2722";

interface Player {
  context: BrowserContext;
  page: Page;
  /** Epoch ms of each `paired` frame received on a tunnel socket. */
  pairedAt: number[];
  /** URLs of sockets that received the edge's pairing confirmation. */
  pairedSockets: string[];
  /** All tunnel connection attempts, including retries and abandoned attempts. */
  tunnelSockets: string[];
}

async function newPlayer(browser: Browser, forced: boolean): Promise<Player> {
  const context = await browser.newContext({ baseURL: PARTY_ORIGIN });
  await recordCopiedInvites(context);
  await seedPlayerName(
    context,
    forced ? "Tunnelled" : `Player ${Math.random().toString(36).slice(2, 6)}`,
  );
  await context.addInitScript((forceTunnel: boolean) => {
    if (forceTunnel) {
      (window as unknown as { __NOVA_TEST_FORCE_TUNNEL__?: boolean }).__NOVA_TEST_FORCE_TUNNEL__ =
        true;
    }
  }, forced);
  const page = await context.newPage();
  const tunnelSockets: string[] = [];
  const pairedAt: number[] = [];
  const pairedSockets: string[] = [];
  page.on("websocket", (socket: WebSocket) => {
    if (!socket.url().includes("/api/tunnel/")) return;
    tunnelSockets.push(socket.url());
    socket.on("framereceived", (frame) => {
      if (frame.payload !== "paired") return;
      pairedAt.push(Date.now());
      pairedSockets.push(socket.url());
    });
  });
  return { context, page, tunnelSockets, pairedAt, pairedSockets };
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

/** A tunneled pair must join without failure alerts and show relayed diagnostics. */
test("a tunnelled pair joins with no alarm and shows a relayed badge", async ({ browser }) => {
  test.setTimeout(240_000);
  const host = await newPlayer(browser, false);
  const forced = await newPlayer(browser, true);
  const players = [host, forced];
  try {
    // Record connecting-alert visibility as an annotation, not an assertion.
    await forced.page.addInitScript(() => {
      const win = window as unknown as { __sawConnecting: boolean };
      win.__sawConnecting = false;
      new MutationObserver(() => {
        if (document.body?.textContent?.includes("Connecting to a player")) {
          win.__sawConnecting = true;
        }
      }).observe(document, { subtree: true, childList: true, characterData: true });
    });
    await host.page.goto("/party");
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
      .toContain("/party#secret=");

    await forced.page.goto(invite);
    for (const player of players) {
      await expect(player.page.locator('[data-testid^="party-member-"]')).toHaveCount(2, {
        timeout: 120_000,
      });
    }
    await expect.poll(() => forced.pairedAt.length, { timeout: 60_000 }).toBe(1);
    const sawConnecting = await forced.page.evaluate(
      () => (window as unknown as { __sawConnecting: boolean }).__sawConnecting,
    );
    test
      .info()
      .annotations.push({ type: "connecting-alert-seen", description: String(sawConnecting) });

    for (const player of players) {
      await expect(player.page.getByText("Couldn't connect to a player.")).toHaveCount(0);
      // The lobby has no diagnostics panel; read relay use from the dev debug hook.
      await expect
        .poll(
          () =>
            player.page.evaluate(() => {
              const debug = (window as { __NOVA_PARTY_DEBUG__?: () => { relayedPeers?: number } })
                .__NOVA_PARTY_DEBUG__;
              return debug?.().relayedPeers ?? 0;
            }),
          { timeout: 30_000 },
        )
        .toBeGreaterThan(0);
    }
  } finally {
    for (const player of players) await player.context.close();
  }
});

// Disable retries so start stalls stay visible; party-lobby.spec.ts is the
// direct-WebRTC control for this forced-tunnel game flow.
test.describe.configure({ retries: 0 });

test("a 3-player party with one tunnelled player plays a state-mode game", async ({ browser }) => {
  test.setTimeout(300_000);
  const host = await newPlayer(browser, false);
  const joiner = await newPlayer(browser, false);
  const forced = await newPlayer(browser, true);
  const players = [host, joiner, forced];
  // A unique run id keeps each repeat's trace files apart (PLAY_TRACE_DIR).
  const run = Date.now().toString(36);
  const labels = ["host", "joiner", "forced"].map(
    (role) => `${browser.browserType().name()}-${role}-${run}`,
  );
  players.forEach((player, index) => recordConsole(player.page, labels[index]!));
  const pages = players.map((player, index) => ({ page: player.page, label: labels[index]! }));
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
      [GAME_ID, NOVA_QUIZ_HTML] as const,
    );
    await host.page.goto(`/party?gameId=${GAME_ID}&title=Nova%20Quiz`);

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
      .toContain("/party#secret=");

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

    const startButton = host.page.getByRole("button", { name: "Start game", exact: true });
    await expect(startButton).toBeEnabled({ timeout: 180_000 });
    await startButton.click();
    await expectPlayViewOnAll(pages);

    for (const player of players) {
      await waitForGameState(await frameOf(player), (s) => s.phase === "question", 120_000);
    }

    let quizmaster: Player | null = null;
    const answerers: Player[] = [];
    for (const player of players) {
      const state = await gameState(await frameOf(player));
      if (state?.revealButton) quizmaster = player;
      else answerers.push(player);
    }
    expect(quizmaster).not.toBeNull();
    // Start can commit a newer revision before an answer arrives. Retry a
    // stale_revision rejection as a player would, until both answers are visible.
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

    for (const player of players) {
      await waitForGameState(await frameOf(player), (s) => s.phase === "revealed", 120_000);
      const rows = await revealedRows(await frameOf(player));
      expect(rows).toHaveLength(2);
      for (const row of rows) expect(row).toContain("chose");
    }

    // WebSocket creation includes failed dial attempts. Check successful pairings
    // on both ends so a retry can't look like an extra tunnel.
    test.info().annotations.push({
      type: "tunnel-attempts",
      description: players.map((player) => player.tunnelSockets.length).join(","),
    });
    expect(host.pairedSockets).toHaveLength(1);
    expect(joiner.pairedSockets).toHaveLength(1);
    expect(host.pairedSockets[0]).not.toBe(joiner.pairedSockets[0]);
    expect([...forced.pairedSockets].sort()).toEqual(
      [...host.pairedSockets, ...joiner.pairedSockets].sort(),
    );
  } finally {
    for (const player of players) await player.context.close();
  }
});
