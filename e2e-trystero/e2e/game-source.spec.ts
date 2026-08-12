// P3 real-browser integration smoke test (external network; resilient).
//
// Runs the GameSourceCoordinator between two real browser pages over the real
// Trystero transport (Nostr relays + WebRTC): the host registers a game
// source, the joiner requests it, the coordinator transfers the chunks as
// binary payloads with progress, the joiner verifies the SHA-256 digest and
// byte count, and both sides acknowledge. Like the P1 specs, this is NOT
// part of the default CI smoke — run with `npm run test:e2e:trystero`, and
// SKIP (not fail) when the external relays are unreachable.
import { expect, test } from "@playwright/test";
import type { Browser, Page } from "@playwright/test";

interface PeerSummary {
  memberId: string;
  connectionId: string;
}

interface SourceState {
  gameId: string | null;
  sourceSha256: string | null;
  sourceSizeBytes: number | null;
  received: boolean;
  receivedLength: number | null;
  events: string[];
}

interface JoinOptions {
  room: string;
  appId?: string;
  relays?: string[];
}

/** Scoped harness shape (the shared global is declared in trystero.spec.ts). */
interface HarnessWindow {
  __harness: {
    ready: boolean;
    createRoom: (options: JoinOptions) => Promise<string>;
    joinRoomByCode: (options: JoinOptions) => Promise<string>;
    leave: () => Promise<void>;
    getState: () => { peers: PeerSummary[] };
    sourceHostStart: (gameId: string, source: string) => Promise<void>;
    sourceJoinerStart: () => Promise<void>;
    getSourceState: () => SourceState;
    randomRoom: () => string;
  };
}

const JOINED = "joined";
const UNREACHABLE = "relay_unreachable";
const JOIN_TIMEOUT = "join_timeout";

function randRoom(): string {
  return `p3-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
}

async function openHarness(browser: Browser): Promise<Page> {
  const page = await browser.newPage();
  await page.goto("/");
  await page.waitForFunction(() => (window as unknown as HarnessWindow).__harness?.ready === true);
  return page;
}

async function sourceStateOf(page: Page): Promise<SourceState> {
  return page.evaluate(() => (window as unknown as HarnessWindow).__harness.getSourceState());
}

/** Join a room through the adapter; SKIP the test when relays are unreachable. */
async function enter(page: Page, room: string, join: "create" | "join"): Promise<void> {
  const result = await page.evaluate(
    ([r, mode]) =>
      mode === "create"
        ? (window as unknown as HarnessWindow).__harness.createRoom({ room: r })
        : (window as unknown as HarnessWindow).__harness.joinRoomByCode({ room: r }),
    [room, join] as const,
  );
  if (result === UNREACHABLE) {
    test.skip(true, "external Nostr relays unreachable — skipping external-network smoke");
    return;
  }
  if (result === JOIN_TIMEOUT) {
    test.skip(true, "join timed out (external relays slow/unreachable) — skipping smoke");
    return;
  }
  expect(result).toBe(JOINED);
}

async function waitPeers(page: Page, count: number, timeout = 120_000): Promise<void> {
  await page.waitForFunction(
    (expected) =>
      (window as unknown as HarnessWindow).__harness.getState().peers.length === expected,
    count,
    { timeout },
  );
}

async function waitForReceived(page: Page, timeout = 120_000): Promise<void> {
  await page.waitForFunction(
    () => (window as unknown as HarnessWindow).__harness.getSourceState().received === true,
    { timeout },
  );
}

/** A multi-chunk source: several 64 KiB protocol chunks, multi-byte content. */
function buildGameSource(size: number): string {
  const filler = "🦀 rocketcrab rules ".repeat(2000);
  const pad = "x".repeat(Math.max(0, size - filler.length));
  return `<!doctype html><html><body><h1>E2E Game</h1><script>window.__game = "rocketcrab";</script>${filler}${pad}</body></html>`;
}

test("host transfers the game source to an admitted joiner, byte-identical and verified", async ({
  browser,
}) => {
  const room = randRoom();
  const gameId = "game_e2e_1";
  const source = buildGameSource(250 * 1024); // ~4 chunks at the 64 KiB protocol chunk size
  const p1 = await openHarness(browser);
  const p2 = await openHarness(browser);

  await enter(p1, room, "create");
  await enter(p2, room, "join");
  await Promise.all([waitPeers(p1, 1, 120_000), waitPeers(p2, 1, 120_000)]);

  // The host registers the game and announces it over the private transport.
  await p1.evaluate(
    ([id, src]) => (window as unknown as HarnessWindow).__harness.sourceHostStart(id, src),
    [gameId, source] as const,
  );
  const hostSource = await sourceStateOf(p1);
  expect(hostSource.gameId).toBe(gameId);
  expect(hostSource.sourceSha256).toMatch(/^[0-9a-f]{64}$/);
  expect(hostSource.sourceSizeBytes).toBe(new TextEncoder().encode(source).byteLength);

  // The joiner attaches its coordinator, requests the game, and receives the
  // verified, byte-identical source.
  await p2.evaluate(() => (window as unknown as HarnessWindow).__harness.sourceJoinerStart());
  await waitForReceived(p2);
  const joinerSource = await sourceStateOf(p2);
  expect(joinerSource.gameId).toBe(gameId);
  expect(joinerSource.received).toBe(true);
  expect(joinerSource.sourceSha256).toBe(hostSource.sourceSha256);
  // Byte-identical: same character length and byte count as the host's.
  expect(joinerSource.receivedLength).toBe(source.length);
  expect(joinerSource.sourceSizeBytes ?? 0).toBe(new TextEncoder().encode(source).byteLength);
  expect(joinerSource.events).toContain("received");
  expect(joinerSource.events).toContain("progress");

  // The host observed the acknowledgement.
  const hostAfter = await sourceStateOf(p1);
  expect(hostAfter.events).toContain("complete");

  await p1.evaluate(() => (window as unknown as HarnessWindow).__harness.leave());
  await p2.evaluate(() => (window as unknown as HarnessWindow).__harness.leave());
});
