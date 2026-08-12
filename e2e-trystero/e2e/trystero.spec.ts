// P1 real-browser integration smoke tests (external network; resilient).
//
// These run the real TrysteroTransport adapter between pages on one machine
// through public Nostr relays + WebRTC — the F5 spike's approach (vite dev
// server, HTTPS + ignoreHTTPSErrors when certs are present, multiple pages
// in one Chromium). If the external relays are unreachable, the adapter's
// join fails with `relay_unreachable` (F5 finding F5 — the adapter detects
// relay failure itself) and the specs SKIP instead of failing.
import { expect, test } from "@playwright/test";
import type { Browser, Page } from "@playwright/test";

interface PeerSummary {
  memberId: string;
  connectionId: string;
  displayName?: string;
}

interface HarnessState {
  ready: boolean;
  appId: string;
  selfMemberId: string;
  selfConnectionId: string | null;
  connectionState: string;
  room: string | null;
  peers: PeerSummary[];
  relays: Array<{ url: string; readyState: number; connected: boolean }> | null;
  messages: Array<{ channel: string; senderMemberId: string; kind: string; size: number }>;
  progress: Array<{ dir: string; fraction: number; channel: string }>;
  pings: number[];
  errors: string[];
}

interface JoinOptions {
  room: string;
  appId?: string;
  relays?: string[];
  relayConnectTimeoutMs?: number;
  joinTimeoutMs?: number;
}

declare global {
  interface Window {
    __harness: {
      ready: boolean;
      createRoom: (options: JoinOptions) => Promise<string>;
      joinRoomByCode: (options: JoinOptions) => Promise<string>;
      leave: () => Promise<void>;
      sendStruct: () => Promise<void>;
      sendBinary: (bytes: Uint8Array) => Promise<void>;
      sendLarge: (size?: number) => Promise<void>;
      ping: () => Promise<number | null>;
      getState: () => HarnessState;
      randomRoom: () => string;
    };
  }
}

const JOINED = "joined";
const UNREACHABLE = "relay_unreachable";
const JOIN_TIMEOUT = "join_timeout";

function randRoom(): string {
  return `p1-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
}

async function openHarness(browser: Browser): Promise<Page> {
  const page = await browser.newPage();
  await page.goto("/");
  await page.waitForFunction(() => window.__harness?.ready === true);
  return page;
}

async function stateOf(page: Page): Promise<HarnessState> {
  return page.evaluate(() => window.__harness.getState());
}

async function waitPeers(page: Page, count: number, timeout = 120_000): Promise<void> {
  await page.waitForFunction(
    (expected) => window.__harness.getState().peers.length === expected,
    count,
    { timeout },
  );
}

async function waitMessages(page: Page, count: number, timeout = 30_000): Promise<void> {
  await page.waitForFunction(
    (expected) => window.__harness.getState().messages.length >= expected,
    count,
    { timeout },
  );
}

/** Join a room through the adapter; SKIP the test when relays are unreachable. */
async function enter(page: Page, room: string, join: "create" | "join"): Promise<void> {
  const result = await page.evaluate(
    ([r, mode]) =>
      mode === "create"
        ? window.__harness.createRoom({ room: r })
        : window.__harness.joinRoomByCode({ room: r }),
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

test("two pages join through the Trystero adapter, exchange messages, ping, and leave", async ({
  browser,
}) => {
  const room = randRoom();
  const p1 = await openHarness(browser);
  const p2 = await openHarness(browser);

  await enter(p1, room, "create");
  await enter(p2, room, "join");

  // Discovery over real relays takes ~20-25 s (F5 F3); allow generous time.
  await Promise.all([waitPeers(p1, 1, 120_000), waitPeers(p2, 1, 120_000)]);

  const s1 = await stateOf(p1);
  const s2 = await stateOf(p2);
  expect(s1.peers).toHaveLength(1);
  expect(s2.peers).toHaveLength(1);
  expect(s1.peers[0]!.memberId).toBe(s2.selfMemberId);
  expect(s2.peers[0]!.memberId).toBe(s1.selfMemberId);
  expect(s1.connectionState).toBe("connected");

  // Structured message p1 -> p2
  await p1.evaluate(() => window.__harness.sendStruct());
  await waitMessages(p2, 1);
  const afterStruct = await stateOf(p2);
  expect(afterStruct.messages[0]).toMatchObject({
    channel: "raw",
    senderMemberId: s1.selfMemberId,
    kind: "json",
  });

  // Binary message p2 -> p1 (256 KiB)
  const bytes: number[] = [];
  for (let i = 0; i < 256 * 1024; i += 1) {
    bytes.push(i % 251);
  }
  await p2.evaluate((payload) => window.__harness.sendBinary(new Uint8Array(payload)), bytes);
  await p1.waitForFunction(
    (size) =>
      window.__harness.getState().messages.some((m) => m.kind === "binary" && m.size === size),
    256 * 1024,
    { timeout: 30_000 },
  );

  // Large transfer with progress on both sides (acceptance: large transfers
  // report progress). 1 MiB over loopback completes in ~1 s; Trystero
  // reports the final chunk as 100%.
  const LARGE = 1024 * 1024;
  await p1.evaluate((size) => window.__harness.sendLarge(size), LARGE);
  const sentProgress = (await stateOf(p1)).progress.filter(
    (p) => p.dir === "send" && p.channel === "large",
  );
  expect(sentProgress.length).toBeGreaterThan(0);
  expect(sentProgress[sentProgress.length - 1]!.fraction).toBe(1);

  await p2.waitForFunction(
    (size) =>
      window.__harness.getState().messages.some((m) => m.channel === "large" && m.size === size),
    LARGE,
    { timeout: 60_000 },
  );
  const receivedProgress = (await stateOf(p2)).progress.filter(
    (p) => p.dir === "receive" && p.channel === "large",
  );
  expect(receivedProgress.length).toBeGreaterThan(0);
  expect(receivedProgress[receivedProgress.length - 1]!.fraction).toBe(1);

  // Ping measures round-trip latency
  const ping = await p1.evaluate(() => window.__harness.ping());
  expect(ping).not.toBeNull();

  // Leave p1; p2 observes peer:left
  await p1.evaluate(() => window.__harness.leave());
  await waitPeers(p2, 0, 30_000);
  const finalS1 = await stateOf(p1);
  expect(finalS1.connectionState).toBe("disconnected");
  await p2.evaluate(() => window.__harness.leave());
});

test("adapter reports relay diagnostics and connection quality after join", async ({ browser }) => {
  const room = randRoom();
  const p1 = await openHarness(browser);
  const p2 = await openHarness(browser);

  await enter(p1, room, "create");
  await enter(p2, room, "join");
  await Promise.all([waitPeers(p1, 1, 120_000), waitPeers(p2, 1, 120_000)]);

  const relays = await p1.evaluate(() => window.__harness.getState().relays);
  expect(relays).not.toBeNull();
  expect(relays!.length).toBeGreaterThanOrEqual(1);
  // join() only resolves once a relay socket is OPEN, so at least one is up
  expect(relays!.some((relay) => relay.connected)).toBe(true);

  const ping = await p1.evaluate(() => window.__harness.ping());
  expect(ping).not.toBeNull();
  const diagnostics = await p1.evaluate(() => window.__harness.getDiagnostics());
  expect(diagnostics).not.toBeNull();
  expect(diagnostics!.kind).toBe("trystero");
  expect(diagnostics!.connectionState).toBe("connected");

  await p1.evaluate(() => window.__harness.leave());
  await p2.evaluate(() => window.__harness.leave());
});
