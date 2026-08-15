// Probe spec (temporary): measure whether the 3 rejecting pinned relays
// (damus / offchain.pub / nostr.info) degrade Trystero room discovery vs a
// healthy-only set. Also captures the exact console relay-failure lines.
//
// Run: npm run test:e2e:trystero -- --grep "discovery probe"
import { expect, test } from "@playwright/test";
import type { Browser, Page } from "@playwright/test";

const HEALTHY4 = [
  "wss://nos.lol",
  "wss://relay.primal.net",
  "wss://nostr.mom",
  "wss://relay.snort.social",
];

declare global {
  interface Window {
    __harness: {
      ready: boolean;
      createRoom: (options: { room: string; relays?: string[] }) => Promise<string>;
      leave: () => Promise<void>;
      getState: () => {
        peers: Array<{ memberId: string }>;
        relays: Array<{ url: string; readyState: number; connected: boolean }> | null;
        connectionState: string;
      };
      randomRoom: () => string;
    };
  }
}

async function openHarness(browser: Browser): Promise<Page> {
  const page = await browser.newPage();
  await page.goto("/");
  await page.waitForFunction(() => window.__harness?.ready === true);
  return page;
}

async function measureDiscovery(browser: Browser, label: string, relays?: string[]) {
  const p1 = await openHarness(browser);
  const p2 = await openHarness(browser);
  const consoleLines: string[] = [];
  const collect = (line: string) => {
    if (line.includes("relay failure")) consoleLines.push(line);
  };
  p1.on("console", (msg) => collect(msg.text()));
  p2.on("console", (msg) => collect(msg.text()));

  const room = `probe-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
  const opts = relays !== undefined ? { room, relays } : { room };
  const start = Date.now();
  const r1 = await p1.evaluate((o) => window.__harness.createRoom(o), opts);
  expect(r1).toBe("joined");
  const r2 = await p2.evaluate((o) => window.__harness.createRoom(o), opts);
  expect(r2).toBe("joined");

  let discoveredMs: number | null = null;
  try {
    await p1.waitForFunction(() => window.__harness.getState().peers.length >= 1, undefined, {
      timeout: 60_000,
    });
    discoveredMs = Date.now() - start;
  } catch {
    discoveredMs = null;
  }

  const s1 = await p1.evaluate(() => window.__harness.getState());
  const s2 = await p2.evaluate(() => window.__harness.getState());
  const failures = [...new Set(consoleLines)];
  await p1.evaluate(() => window.__harness.leave());
  await p2.evaluate(() => window.__harness.leave());
  await p1.close();
  await p2.close();

  console.log(
    `\n### ${label} — discovery: ${discoveredMs === null ? "TIMEOUT (60s)" : `${discoveredMs} ms`}`,
  );
  console.log(
    `    relay sockets p1: ${JSON.stringify(s1.relays?.map((r) => [r.url.split("/")[2], r.connected]))}`,
  );
  console.log(
    `    relay sockets p2: ${JSON.stringify(s2.relays?.map((r) => [r.url.split("/")[2], r.connected]))}`,
  );
  console.log(`    peers p1: ${s1.peers.length}  p2: ${s2.peers.length}`);
  console.log(`    distinct console relay-failure lines (${failures.length}):`);
  for (const f of failures) console.log(`      ${f}`);
  return { discoveredMs, failures };
}

test("discovery probe: ALL7 pinned relays vs HEALTHY4", async ({ browser }) => {
  console.log("\n===== DEFAULT (ALL7 pinned relays, incl. 3 rejecting) =====");
  const all7 = await measureDiscovery(browser, "ALL7 (default GOOD_RELAYS)");

  console.log("\n===== HEALTHY4 (nos.lol, primal, nostr.mom, snort) =====");
  const healthy4 = await measureDiscovery(browser, "HEALTHY4", HEALTHY4);

  console.log("\n===== PROBE SUMMARY =====");
  console.log(
    `  ALL7 discovery:   ${all7.discoveredMs === null ? "TIMEOUT" : `${all7.discoveredMs} ms`}`,
  );
  console.log(
    `  HEALTHY4 discovery: ${healthy4.discoveredMs === null ? "TIMEOUT" : `${healthy4.discoveredMs} ms`}`,
  );
  console.log(`  ALL7 relay-failure console lines: ${all7.failures.length}`);
  for (const f of all7.failures) console.log(`    ${f}`);
  console.log(`  HEALTHY4 relay-failure console lines: ${healthy4.failures.length}`);
  for (const f of healthy4.failures) console.log(`    ${f}`);

  // Informational probe — never fail on external-network variance.
  expect(true).toBe(true);
});
