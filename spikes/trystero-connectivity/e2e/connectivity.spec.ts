// F5 connectivity spike — same-machine multi-page simulation.
//
// IMPORTANT SCOPE: these tests exercise the full Trystero protocol stack
// (Nostr relay discovery + WebRTC) between pages on ONE machine (loopback /
// host candidates). They do NOT exercise real-network NAT traversal, carrier
// networks, or phone lifecycle behavior — that is the human cross-device pass
// in docs/testing/physical-device-checklist-f5.md.
import { expect, test } from "@playwright/test";
import type { Browser, Page } from "@playwright/test";

interface HarnessState {
  ready: boolean;
  appId: string;
  selfId: string | null;
  room: string | null;
  peers: string[];
  errors: Array<{ error: string; at: number }>;
  relays: Array<{ url: string; readyState: number }>;
  timings: Record<string, number | undefined>;
  largeReceived: Array<{ size: number; durationMs: number; hash: number }>;
  pingResults: Array<{ peerId: string; ms: number }>;
  lastStruct: unknown;
  progress: Array<{ ns: string; dir: string; percent: number; at: number }>;
  messages: Array<{ ns: string; peerId: string; kind: string; size: number; at: number }>;
  log: Array<{ at: number; level: string; msg: string }>;
  connectionStates: Record<string, string>;
}

interface JoinOptions {
  room: string;
  password?: string;
  relays?: string[];
  admission?: { mode: "all" | "none" | "allow-list"; allowIds: string[] };
  handshakeTimeoutMs?: number;
}

declare global {
  interface Window {
    __harness: {
      ready: boolean;
      createRoom: (options: JoinOptions) => string;
      joinRoomByCode: (options: JoinOptions) => string;
      leave: () => Promise<void>;
      sendLarge: (size?: number) => Promise<void>;
      sendStruct: () => Promise<void>;
      sendBinary: (bytes: Uint8Array) => Promise<void>;
      ping: () => Promise<number | null>;
      dropFirstRelay: () => Promise<string | null>;
      setAdmissionAllowList: (ids: string[]) => void;
      getState: () => HarnessState;
      getSelfId: () => string | null;
      getConnectionStates: () => Record<string, string>;
      defaultRelayUrls: string[];
      LARGE_SIZE: number;
    };
  }
}

const LARGE_SIZE = 5 * 1024 * 1024;

function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

const randRoom = (): string =>
  `f5-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;

async function openHarness(browser: Browser): Promise<Page> {
  const page = await browser.newPage();
  await page.goto("/");
  await page.waitForFunction(() => window.__harness?.ready === true);
  return page;
}

async function stateOf(page: Page): Promise<HarnessState> {
  return page.evaluate(() => window.__harness.getState());
}

async function waitPeers(page: Page, count: number, timeout = 60_000): Promise<void> {
  await page.waitForFunction(
    (expected) => window.__harness.getState().peers.length === expected,
    count,
    { timeout },
  );
}

async function waitErrors(page: Page, timeout = 30_000): Promise<string[]> {
  await page.waitForFunction(() => window.__harness.getState().errors.length > 0, null, {
    timeout,
  });
  const state = await stateOf(page);
  return state.errors.map((e) => e.error);
}

const REJECT_ERR = /admission|rejected/i;

test("1. two peers discover and establish WebRTC", async ({ browser }) => {
  const room = randRoom();
  const p1 = await openHarness(browser);
  const p2 = await openHarness(browser);
  const wallStart = Date.now();
  await p1.evaluate((r) => window.__harness.createRoom({ room: r }), room);
  await p2.evaluate((r) => window.__harness.joinRoomByCode({ room: r }), room);
  await Promise.all([waitPeers(p1, 1), waitPeers(p2, 1)]);
  const s1 = await stateOf(p1);
  const s2 = await stateOf(p2);
  expect(s1.peers).toHaveLength(1);
  expect(s2.peers).toHaveLength(1);
  expect(s1.peers[0]).toBe(s2.selfId);
  expect(s2.peers[0]).toBe(s1.selfId);
  expect(s1.timings.discoveryMs).toBeGreaterThan(0);
  const conn = await p1.evaluate(() => window.__harness.getConnectionStates());
  expect(Object.values(conn)).toContain("connected");
  test.info().annotations.push({
    type: "metric",
    description: `two peers: discovery+establish ${s1.timings.discoveryMs}ms (wall ${Date.now() - wallStart}ms)`,
  });
  await p1.close();
  await p2.close();
});

test("2. four simultaneous peers all connect", async ({ browser }) => {
  const room = randRoom();
  const pages = await Promise.all([1, 2, 3, 4].map(() => openHarness(browser)));
  await pages[0]!.evaluate((r) => window.__harness.createRoom({ room: r }), room);
  await Promise.all(
    pages
      .slice(1)
      .map((page) => page.evaluate((r) => window.__harness.joinRoomByCode({ room: r }), room)),
  );
  await Promise.all(pages.map((page) => waitPeers(page, 3)));
  for (const page of pages) {
    const state = await stateOf(page);
    expect(state.peers).toHaveLength(3);
    const conn = await page.evaluate(() => window.__harness.getConnectionStates());
    expect(Object.values(conn).filter((s) => s === "connected")).toHaveLength(3);
  }
  await Promise.all(pages.map((page) => page.close()));
});

test("3. peer leave and rejoin", async ({ browser }) => {
  const room = randRoom();
  const p1 = await openHarness(browser);
  const p2 = await openHarness(browser);
  await p1.evaluate((r) => window.__harness.createRoom({ room: r }), room);
  await p2.evaluate((r) => window.__harness.joinRoomByCode({ room: r }), room);
  await Promise.all([waitPeers(p1, 1), waitPeers(p2, 1)]);

  await p2.evaluate(() => window.__harness.leave());
  await waitPeers(p1, 0);
  expect((await stateOf(p2)).peers).toHaveLength(0);

  await p2.evaluate((r) => window.__harness.joinRoomByCode({ room: r }), room);
  await waitPeers(p1, 1);
  await waitPeers(p2, 1);
  test.info().annotations.push({
    type: "note",
    description: "leave produced onPeerLeave on p1; rejoin re-established the pair",
  });
  await p1.close();
  await p2.close();
});

test("4. multi-megabyte HTML string transfer with progress", async ({ browser }) => {
  const room = randRoom();
  const p1 = await openHarness(browser);
  const p2 = await openHarness(browser);
  await p1.evaluate((r) => window.__harness.createRoom({ room: r }), room);
  await p2.evaluate((r) => window.__harness.joinRoomByCode({ room: r }), room);
  await Promise.all([waitPeers(p1, 1), waitPeers(p2, 1)]);

  await p1.evaluate(() => window.__harness.sendLarge());
  await p2.waitForFunction(() => window.__harness.getState().largeReceived.length === 1, null, {
    timeout: 60_000,
  });
  const s1 = await stateOf(p1);
  const s2 = await stateOf(p2);
  expect(s2.largeReceived[0]!.size).toBe(LARGE_SIZE);
  expect(s2.largeReceived[0]!.hash).toBe(fnv1a("x".repeat(LARGE_SIZE)));
  expect(s2.largeReceived[0]!.durationMs).toBeGreaterThan(0);
  const sendProgress = s1.progress.filter((p) => p.ns === "large" && p.dir === "send");
  const recvProgress = s2.progress.filter((p) => p.ns === "large" && p.dir === "recv");
  expect(sendProgress.length).toBeGreaterThan(0);
  expect(recvProgress.length).toBeGreaterThan(0);
  const durationMs = s2.largeReceived[0]!.durationMs;
  const mibPerSec = LARGE_SIZE / 1024 / 1024 / (durationMs / 1000);
  test.info().annotations.push({
    type: "metric",
    description: `5 MiB transfer: ${durationMs}ms → ${mibPerSec.toFixed(2)} MiB/s; send progress events ${sendProgress.length}, recv progress events ${recvProgress.length}`,
  });
  await p1.close();
  await p2.close();
});

test("5. structured action transfer", async ({ browser }) => {
  const room = randRoom();
  const p1 = await openHarness(browser);
  const p2 = await openHarness(browser);
  await p1.evaluate((r) => window.__harness.createRoom({ room: r }), room);
  await p2.evaluate((r) => window.__harness.joinRoomByCode({ room: r }), room);
  await Promise.all([waitPeers(p1, 1), waitPeers(p2, 1)]);

  await p1.evaluate(() => window.__harness.sendStruct());
  await p2.waitForFunction(() => window.__harness.getState().lastStruct !== null, null, {
    timeout: 30_000,
  });
  const received = await p2.evaluate(() => window.__harness.getState().lastStruct);
  expect(received).toMatchObject({
    type: "action.test",
    seq: 1,
    payload: { score: 42, tags: ["a", "b"], nested: { ok: true } },
  });
  await p1.close();
  await p2.close();
});

test("6. binary transfer", async ({ browser }) => {
  const room = randRoom();
  const p1 = await openHarness(browser);
  const p2 = await openHarness(browser);
  await p1.evaluate((r) => window.__harness.createRoom({ room: r }), room);
  await p2.evaluate((r) => window.__harness.joinRoomByCode({ room: r }), room);
  await Promise.all([waitPeers(p1, 1), waitPeers(p2, 1)]);

  const bytes = new Uint8Array(1024 * 1024).map((_, i) => i % 251);
  await p1.evaluate((data) => window.__harness.sendBinary(new Uint8Array(data)), Array.from(bytes));
  await p2.waitForFunction(() => window.__harness.getState().largeReceived.length === 1, null, {
    timeout: 60_000,
  });
  const s2 = await stateOf(p2);
  expect(s2.largeReceived[0]!.size).toBe(1024 * 1024);
  let expected = 0x811c9dc5;
  for (const b of bytes) {
    expected ^= b;
    expected = Math.imul(expected, 0x01000193);
  }
  expect(s2.largeReceived[0]!.hash).toBe(expected >>> 0);
  expect(s2.messages.some((m) => m.ns === "bin" && m.kind === "Uint8Array")).toBe(true);
  await p1.close();
  await p2.close();
});

test("7. admission handshake rejects a peer before room events", async ({ browser }) => {
  const room = randRoom();
  const p1 = await openHarness(browser);
  const p2 = await openHarness(browser);
  const p3 = await openHarness(browser);
  // Creator admits nobody yet; joiners cooperate with the symmetric handshake.
  await p1.evaluate(
    (r) =>
      window.__harness.createRoom({
        room: r,
        admission: { mode: "allow-list", allowIds: [] },
        handshakeTimeoutMs: 10_000,
      }),
    room,
  );
  await p2.evaluate(
    (r) =>
      window.__harness.joinRoomByCode({
        room: r,
        admission: { mode: "all", allowIds: [] },
        handshakeTimeoutMs: 10_000,
      }),
    room,
  );
  const p2Errors = await waitErrors(p2);
  const p1Errors = await waitErrors(p1);
  expect(p2Errors.some((e) => REJECT_ERR.test(e))).toBe(true);
  expect(p1Errors.some((e) => REJECT_ERR.test(e))).toBe(true);
  // The rejected peer never saw normal room events.
  expect((await stateOf(p1)).peers).toHaveLength(0);
  expect((await stateOf(p2)).peers).toHaveLength(0);
  expect((await stateOf(p2)).messages).toHaveLength(0);

  // FINDING (F5): Trystero does NOT clean up a failed peer's room subscription
  // automatically. The rejected client must leave() explicitly or it keeps
  // re-offering (~every 5s) and churns the creator's offer pool, starving
  // legitimate joiners. A real client fails fast and leaves the rendezvous.
  await p2.evaluate(() => window.__harness.leave());

  // Admit p3 by id, then p3 joins successfully.
  const p3Id = await p3.evaluate(() => window.__harness.getSelfId());
  expect(p3Id).toBeTruthy();
  const p3IdOk = p3Id as string;
  await p1.evaluate((id) => window.__harness.setAdmissionAllowList([id]), p3IdOk);
  await p3.evaluate(
    (r) =>
      window.__harness.joinRoomByCode({
        room: r,
        admission: { mode: "all", allowIds: [] },
        handshakeTimeoutMs: 10_000,
      }),
    room,
  );
  await Promise.all([waitPeers(p1, 1), waitPeers(p3, 1)]);
  test.info().annotations.push({
    type: "note",
    description: `rejected peer errors: ${p2Errors.join(" | ")}; approved peer p3 connected`,
  });
  await p1.close();
  await p2.close();
  await p3.close();
});

test("8. password-protected room", async ({ browser }) => {
  const room = randRoom();
  const password = "s3cret-room";
  const p1 = await openHarness(browser);
  const p2 = await openHarness(browser);
  const p3 = await openHarness(browser);
  await p1.evaluate(
    (args) =>
      window.__harness.createRoom({
        room: args.room,
        password: args.password,
        handshakeTimeoutMs: 8_000,
      }),
    { room, password },
  );
  // Wrong password: at least one side must surface a structured error.
  await p2.evaluate(
    (args) =>
      window.__harness.joinRoomByCode({
        room: args.room,
        password: "wrong-password",
        handshakeTimeoutMs: 8_000,
      }),
    { room },
  );
  const errors = await Promise.race([
    waitErrors(p1).catch(() => [] as string[]),
    waitErrors(p2).catch(() => [] as string[]),
  ]);
  expect(errors.join(" ").toLowerCase()).toContain("password");
  expect((await stateOf(p1)).peers).toHaveLength(0);
  expect((await stateOf(p2)).peers).toHaveLength(0);

  // Correct password connects.
  await p3.evaluate(
    (args) =>
      window.__harness.joinRoomByCode({
        room: args.room,
        password: args.password,
        handshakeTimeoutMs: 8_000,
      }),
    { room, password },
  );
  await Promise.all([waitPeers(p1, 1), waitPeers(p3, 1)]);
  test.info().annotations.push({
    type: "note",
    description: `password errors surfaced: ${errors.join(" | ") || "(none on the winning side)"}`,
  });
  await p1.close();
  await p2.close();
  await p3.close();
});

test("9. latency measurement via ping", async ({ browser }) => {
  const room = randRoom();
  const p1 = await openHarness(browser);
  const p2 = await openHarness(browser);
  await p1.evaluate((r) => window.__harness.createRoom({ room: r }), room);
  await p2.evaluate((r) => window.__harness.joinRoomByCode({ room: r }), room);
  await Promise.all([waitPeers(p1, 1), waitPeers(p2, 1)]);

  const ms = await p1.evaluate(() => window.__harness.ping());
  expect(ms).not.toBeNull();
  // Loopback ping can legitimately be 0ms (sub-millisecond round trip).
  expect(ms!).toBeGreaterThanOrEqual(0);
  expect(ms!).toBeLessThan(10_000);
  test.info().annotations.push({
    type: "metric",
    description: `ping latency: ${ms}ms`,
  });
  await p1.close();
  await p2.close();
});

test("10. relay disconnect and reconnect", async ({ browser }) => {
  const room = randRoom();
  const p1 = await openHarness(browser);
  const p2 = await openHarness(browser);
  await p1.evaluate((r) => window.__harness.createRoom({ room: r }), room);
  await p2.evaluate((r) => window.__harness.joinRoomByCode({ room: r }), room);
  await Promise.all([waitPeers(p1, 1), waitPeers(p2, 1)]);

  const before = await stateOf(p1);
  expect(before.relays.length).toBeGreaterThan(0);
  const relayUrl = await p1.evaluate(() => window.__harness.dropFirstRelay());
  expect(relayUrl).toBeTruthy();

  // The socket leaves OPEN state...
  await p1.waitForFunction(
    (url) => {
      const relay = window.__harness.getState().relays.find((r) => r.url === url);
      return relay !== undefined && relay.readyState !== WebSocket.OPEN;
    },
    relayUrl,
    { timeout: 30_000 },
  );
  // ...and Trystero's built-in reconnect brings it back to OPEN (backoff ~3.3s first retry).
  const reconnectStart = Date.now();
  await p1.waitForFunction(
    (url) => {
      const relay = window.__harness.getState().relays.find((r) => r.url === url);
      return relay !== undefined && relay.readyState === WebSocket.OPEN;
    },
    relayUrl,
    { timeout: 60_000 },
  );
  const reconnectMs = Date.now() - reconnectStart;
  // Established peer connection survives the relay drop (relay is signaling-only).
  const conn = await p1.evaluate(() => window.__harness.getConnectionStates());
  expect(Object.values(conn)).toContain("connected");

  // A NEW peer can still join after relay recovery.
  const p3 = await openHarness(browser);
  await p3.evaluate((r) => window.__harness.joinRoomByCode({ room: r }), room);
  await waitPeers(p1, 2);
  test.info().annotations.push({
    type: "metric",
    description: `relay ${relayUrl} reconnected in ${reconnectMs}ms; established peers unaffected; new peer joined after recovery`,
  });
  await p1.close();
  await p2.close();
  await p3.close();
});

test("11. connection failure reporting", async ({ browser }) => {
  const page = await openHarness(browser);
  const consoleLines: string[] = [];
  page.on("console", (msg) => {
    consoleLines.push(`${msg.type()}: ${msg.text()}`);
  });
  const badRelay = "wss://127.0.0.1:1";
  await page.evaluate(
    (args) => window.__harness.joinRoomByCode({ room: args.room, relays: [args.relay] }),
    { room: randRoom(), relay: badRelay },
  );
  await page.waitForTimeout(8_000);
  const state = await stateOf(page);
  expect(state.peers).toHaveLength(0);
  const relay = state.relays.find((r) => r.url === badRelay);
  expect(relay).toBeTruthy();
  expect(relay!.readyState).not.toBe(WebSocket.OPEN);
  test.info().annotations.push({
    type: "note",
    description: `unreachable relay ${badRelay}: no peer joined; socket readyState ${relay?.readyState} after 8s; console: ${consoleLines.join(" || ") || "(no console diagnostics)"}`,
  });
  await page.close();
});
