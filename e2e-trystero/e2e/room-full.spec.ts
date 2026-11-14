// Real Trystero `room-full` rejection (PLAN §3.2, §3.3). A test-only raw page
// joins with `maxUsers: 2`; production sets no cap. A third joiner must receive
// a real RoomError with code `room-full` (mapped by Nova's `fromRoomError` to
// category `room_full`), while the first two stay connected and keep messaging.
import { expect, test } from "@playwright/test";
import type { Browser, Page } from "@playwright/test";

interface ErrorReport {
  code: string | undefined;
  category: string;
  message: string;
}

interface RoomFullState {
  peers: number;
  messages: string[];
  errors: ErrorReport[];
}

declare global {
  interface Window {
    roomFull: {
      ready: boolean;
      join: (roomId: string, maxUsers: number | undefined) => Promise<void>;
      send: (text: string) => Promise<unknown>;
      state: () => RoomFullState;
      leave: () => Promise<void>;
    };
  }
}

async function openRoomPage(browser: Browser): Promise<Page> {
  const page = await browser.newPage();
  await page.goto("/room-full.html");
  await page.waitForFunction(() => window.roomFull?.ready === true);
  return page;
}

async function stateOf(page: Page): Promise<RoomFullState> {
  return page.evaluate(() => window.roomFull.state());
}

test("a third joiner gets a real room-full RoomError; the first two stay connected", async ({
  browser,
}) => {
  const roomId = `room-full-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
  const p1 = await openRoomPage(browser);
  const p2 = await openRoomPage(browser);
  const p3 = await openRoomPage(browser);

  await p1.evaluate((id) => window.roomFull.join(id, 2), roomId);
  await p2.evaluate((id) => window.roomFull.join(id, 2), roomId);
  await expect.poll(async () => (await stateOf(p1)).peers, { timeout: 120_000 }).toBe(1);
  await expect.poll(async () => (await stateOf(p2)).peers, { timeout: 120_000 }).toBe(1);

  // Third joiner exceeds the two-seat cap.
  await p3.evaluate((id) => window.roomFull.join(id, 2), roomId);
  await expect
    .poll(async () => (await stateOf(p3)).errors.map((e) => e.code), { timeout: 120_000 })
    .toContain("room-full");
  const rejected = await stateOf(p3);
  expect(rejected.errors).toContainEqual(
    expect.objectContaining({ code: "room-full", category: "room_full" }),
  );
  expect(rejected.peers).toBe(0);

  // The first two remain connected to each other and still exchange messages.
  expect((await stateOf(p1)).peers).toBe(1);
  expect((await stateOf(p2)).peers).toBe(1);
  await p1.evaluate(() => window.roomFull.send("still-seated"));
  await expect.poll(async () => (await stateOf(p2)).messages).toEqual(["still-seated"]);

  // The cap is not reported to the seated players as a room-full error.
  expect((await stateOf(p1)).errors.filter((e) => e.code === "room-full")).toEqual([]);
  expect((await stateOf(p2)).errors.filter((e) => e.code === "room-full")).toEqual([]);

  await Promise.all([p1, p2, p3].map((page) => page.evaluate(() => window.roomFull.leave())));
});
