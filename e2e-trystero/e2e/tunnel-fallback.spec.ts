// Real-browser WebRTC-to-tunnel fallback (PLAN.md §5.6) through the local
// edge Worker: one page's native WebRTC is forced to fail, so its pair moves
// onto the /tunnel/:pairId WebSocket. Shares the harness with trystero.spec.ts.
import { randomBytes } from "node:crypto";
import { expect, test } from "@playwright/test";
import type { Browser, Page, WebSocket } from "@playwright/test";

interface PeerSummary {
  memberId: string;
  connectionId: string;
  tunnelled?: boolean;
}

interface HarnessState {
  peers: PeerSummary[];
  messages: Array<{ channel: string; senderMemberId: string }>;
  tunnel: {
    starts: Array<{ reason: string; elapsedMs: number }>;
    failures: string[];
  };
  outcomes: Array<{ outcome: string; msToConnect: number }>;
  errors: string[];
}

interface SourceState {
  received: boolean;
  receivedLength: number | null;
  sourceSha256: string | null;
  events: string[];
}

interface JoinOptions {
  room: string;
  partySecret?: string;
  forceRelayOnlyNoServers?: boolean;
}

interface HarnessWindow {
  __harness: {
    ready: boolean;
    createRoom: (options: JoinOptions) => Promise<string>;
    joinRoomByCode: (options: JoinOptions) => Promise<string>;
    leave: () => Promise<void>;
    sendStruct: () => Promise<void>;
    getState: () => HarnessState;
    sourceHostStart: (gameId: string, source: string) => Promise<void>;
    sourceJoinerStart: () => Promise<void>;
    getSourceState: () => SourceState;
  };
}

const JOINED = "joined";
/** Fallback timer (FALLBACK_AFTER_MS, 8 s) plus margin for the switch and the tunnel. */
const PAST_FALLBACK_MS = 12_000;

/** Binary traffic that crossed this page's tunnel sockets (paired/text excluded). */
interface TunnelTraffic {
  framesSent: number;
  framesReceived: number;
  bytesSent: number;
  bytesReceived: number;
}

interface Peer {
  page: Page;
  tunnelSockets: string[];
  /** URLs of tunnel sockets that reached the closed state. */
  closedTunnelSockets: string[];
  traffic: TunnelTraffic;
}

async function trafficOf(peer: Peer): Promise<TunnelTraffic> {
  return { ...peer.traffic };
}

function randRoom(): string {
  return `tun-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
}

async function openPeer(browser: Browser): Promise<Peer> {
  const page = await browser.newPage();
  const tunnelSockets: string[] = [];
  const closedTunnelSockets: string[] = [];
  const traffic: TunnelTraffic = {
    framesSent: 0,
    framesReceived: 0,
    bytesSent: 0,
    bytesReceived: 0,
  };
  page.on("websocket", (socket: WebSocket) => {
    if (!socket.url().includes("/tunnel/")) return;
    tunnelSockets.push(socket.url());
    socket.on("close", () => closedTunnelSockets.push(socket.url()));
    // Only binary frames carry data; the server's text `paired` is excluded.
    socket.on("framesent", (frame) => {
      if (typeof frame.payload === "string") return;
      traffic.framesSent += 1;
      traffic.bytesSent += frame.payload.byteLength;
    });
    socket.on("framereceived", (frame) => {
      if (typeof frame.payload === "string") return;
      traffic.framesReceived += 1;
      traffic.bytesReceived += frame.payload.byteLength;
    });
  });
  await page.goto("/");
  await page.waitForFunction(() => (window as unknown as HarnessWindow).__harness?.ready === true);
  return { page, tunnelSockets, closedTunnelSockets, traffic };
}

async function enter(
  peer: Peer,
  room: string,
  mode: "create" | "join",
  options: { secret: string; forced: boolean },
): Promise<void> {
  const result = await peer.page.evaluate(
    ([r, m, o]) => {
      const harness = (window as unknown as HarnessWindow).__harness;
      const join = {
        room: r,
        partySecret: o.secret,
        forceRelayOnlyNoServers: o.forced,
      };
      return m === "create" ? harness.createRoom(join) : harness.joinRoomByCode(join);
    },
    [room, mode, options] as const,
  );
  expect(result).toBe(JOINED);
}

async function state(page: Page): Promise<HarnessState> {
  return page.evaluate(() => (window as unknown as HarnessWindow).__harness.getState());
}

async function sourceState(page: Page): Promise<SourceState> {
  return page.evaluate(() => (window as unknown as HarnessWindow).__harness.getSourceState());
}

async function waitPeers(page: Page, count: number, timeout = 90_000): Promise<void> {
  await expect.poll(async () => (await state(page)).peers.length, { timeout }).toBe(count);
}

/** Two pages joined to one room with the same party secret. */
async function joinPair(
  browser: Browser,
  forcedSecond: boolean,
): Promise<{ host: Peer; joiner: Peer; room: string; secret: string }> {
  const room = randRoom();
  const secret = randomBytes(32).toString("base64url");
  const host = await openPeer(browser);
  const joiner = await openPeer(browser);
  await enter(host, room, "create", { secret, forced: false });
  await enter(joiner, room, "join", { secret, forced: forcedSecond });
  await waitPeers(host.page, 1);
  await waitPeers(joiner.page, 1);
  return { host, joiner, room, secret };
}

async function closeAll(...peers: Peer[]): Promise<void> {
  for (const peer of peers) {
    await peer.page
      .evaluate(() => (window as unknown as HarnessWindow).__harness.leave())
      .catch(() => undefined);
    await peer.page.close();
  }
}

/** Exact UTF-8 byte budget for the game-source payload (same as game-source.spec.ts). */
function buildGameSource(size: number): string {
  const filler = "🦀 rocketcrab rules ".repeat(2000);
  const document = `<!doctype html><html><body><h1>Tunnel Game</h1>${filler}</body></html>`;
  return document + "x".repeat(Math.max(0, size - new TextEncoder().encode(document).byteLength));
}

test("a forced player and its normal partner both tunnel once, and actions flow both ways", async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const { host, joiner } = await joinPair(browser, true);
  try {
    // Each page's pair is carried by one tunnel socket: exactly one per side.
    await expect.poll(() => host.tunnelSockets.length, { timeout: PAST_FALLBACK_MS * 2 }).toBe(1);
    await expect.poll(() => joiner.tunnelSockets.length, { timeout: 5_000 }).toBe(1);

    // Both report the peer as tunnelled and started exactly one fallback.
    await expect.poll(async () => (await state(host.page)).peers[0]?.tunnelled).toBe(true);
    await expect.poll(async () => (await state(joiner.page)).peers[0]?.tunnelled).toBe(true);
    for (const peer of [host, joiner]) {
      const current = await state(peer.page);
      expect(current.tunnel.starts).toHaveLength(1);
      expect(current.tunnel.failures).toEqual([]);
      expect(current.errors).toEqual([]);
    }
    // One connection outcome per side for the forced pair: the tunnel (PLAN.md §8.2).
    for (const peer of [host, joiner]) {
      await expect
        .poll(async () => (await state(peer.page)).outcomes.map((o) => o.outcome))
        .toEqual(["tunnel"]);
    }

    // Actions flow in both directions over the tunnel. The binary traffic
    // counters must grow across the exchange: this proves the data itself
    // crossed the tunnel, not just that the sockets opened.
    const hostBefore = await trafficOf(host);
    const joinerBefore = await trafficOf(joiner);
    await host.page.evaluate(() => (window as unknown as HarnessWindow).__harness.sendStruct());
    await joiner.page.evaluate(() => (window as unknown as HarnessWindow).__harness.sendStruct());
    await expect
      .poll(
        async () => (await state(joiner.page)).messages.filter((m) => m.channel === "raw").length,
      )
      .toBeGreaterThanOrEqual(1);
    await expect
      .poll(async () => (await state(host.page)).messages.filter((m) => m.channel === "raw").length)
      .toBeGreaterThanOrEqual(1);
    for (const [peer, before] of [
      [host, hostBefore],
      [joiner, joinerBefore],
    ] as const) {
      const after = await trafficOf(peer);
      expect(after.framesSent).toBeGreaterThan(before.framesSent);
      expect(after.framesReceived).toBeGreaterThan(before.framesReceived);
      expect(after.bytesSent).toBeGreaterThan(before.bytesSent);
      expect(after.bytesReceived).toBeGreaterThan(before.bytesReceived);
    }
  } finally {
    await closeAll(host, joiner);
  }
});

test("healthy pairs stay on native WebRTC and never open a tunnel", async ({ browser }) => {
  test.setTimeout(180_000);
  const { host, joiner } = await joinPair(browser, false);
  try {
    // Let the fallback timer pass on the healthy pair.
    await host.page.waitForTimeout(PAST_FALLBACK_MS);

    expect(host.tunnelSockets).toEqual([]);
    expect(joiner.tunnelSockets).toEqual([]);
    expect(await trafficOf(host)).toEqual({
      framesSent: 0,
      framesReceived: 0,
      bytesSent: 0,
      bytesReceived: 0,
    });
    expect(await trafficOf(joiner)).toEqual({
      framesSent: 0,
      framesReceived: 0,
      bytesSent: 0,
      bytesReceived: 0,
    });
    for (const peer of [host, joiner]) {
      const current = await state(peer.page);
      expect(current.peers[0]?.tunnelled).toBe(false);
      expect(current.tunnel.starts).toEqual([]);
      expect(current.tunnel.failures).toEqual([]);
      // One outcome per side on native WebRTC: direct when the selected pair is
      // readable, unknown when it is not. Never tunnel or failed (PLAN.md §8.2).
      await expect
        .poll(async () => (await state(peer.page)).outcomes.map((o) => o.outcome))
        .toHaveLength(1);
      expect(["direct", "unknown"]).toContain((await state(peer.page)).outcomes[0]?.outcome);
    }

    await host.page.evaluate(() => (window as unknown as HarnessWindow).__harness.sendStruct());
    await expect
      .poll(
        async () => (await state(joiner.page)).messages.filter((m) => m.channel === "raw").length,
      )
      .toBeGreaterThanOrEqual(1);
  } finally {
    await closeAll(host, joiner);
  }
});

test("a 2 MiB game source crosses the tunnel byte-identical and verified", async ({ browser }) => {
  test.setTimeout(300_000);
  const gameId = "game_tunnel_1";
  const source = buildGameSource(2 * 1024 * 1024);
  const { host, joiner } = await joinPair(browser, true);
  try {
    await host.page.evaluate(
      ([id, src]) => (window as unknown as HarnessWindow).__harness.sourceHostStart(id, src),
      [gameId, source] as const,
    );
    const hostSource = await sourceState(host.page);
    expect(hostSource.sourceSha256).toMatch(/^[0-9a-f]{64}$/);

    await joiner.page.evaluate(() =>
      (window as unknown as HarnessWindow).__harness.sourceJoinerStart(),
    );
    await expect
      .poll(async () => (await sourceState(joiner.page)).received, {
        timeout: 240_000,
      })
      .toBe(true);
    const received = await sourceState(joiner.page);
    expect(received.sourceSha256).toBe(hostSource.sourceSha256);
    expect(received.receivedLength).toBe(source.length);
    expect(received.events).toContain("received");

    // Still tunnelled: the transfer did not fall back to native WebRTC mid-way.
    expect((await state(joiner.page)).peers[0]?.tunnelled).toBe(true);
    expect((await state(joiner.page)).tunnel.failures).toEqual([]);
    expect(joiner.tunnelSockets).toHaveLength(1);
    // The 2 MiB source (UTF-8 bytes, plus framing) had to cross the tunnel.
    const sourceBytes = new TextEncoder().encode(source).byteLength;
    expect((await trafficOf(joiner)).bytesReceived).toBeGreaterThanOrEqual(sourceBytes);
  } finally {
    await closeAll(host, joiner);
  }
});

test("closing one side tears the tunnelled partner down", async ({ browser }) => {
  test.setTimeout(180_000);
  const { host, joiner } = await joinPair(browser, true);
  try {
    await expect
      .poll(async () => (await state(host.page)).peers[0]?.tunnelled, {
        timeout: PAST_FALLBACK_MS * 2,
      })
      .toBe(true);

    await joiner.page.evaluate(() => (window as unknown as HarnessWindow).__harness.leave());
    await waitPeers(host.page, 0, 60_000);

    // The partner's tunnel socket closes too (the edge closes the pair when
    // one side leaves). The host may see this as a Trystero peer leave before
    // its socket closes, so a terminal failure is not required here.
    await expect.poll(() => host.closedTunnelSockets.length, { timeout: 30_000 }).toBe(1);
  } finally {
    await closeAll(host, joiner);
  }
});
