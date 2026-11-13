import { test, expect } from "@playwright/test";

test("Nova game source reaches a virtual peer with signaling disabled", async ({
  browser,
  request,
}) => {
  const contexts = [];
  try {
    await request.post("/control/reset");
    const pages = [];
    const room = `nova-scale-${Date.now()}`;
    for (let i = 0; i < 8; i++) {
      const context = await browser.newContext();
      contexts.push(context);
      const page = await context.newPage();
      await page.goto("/");
      await page.waitForFunction(() => window.__harness?.ready);
      expect(
        await page.evaluate(
          (name) => window.__harness.joinRoomByCode({ room: name, relayConnectTimeoutMs: 15000 }),
          room,
        ),
      ).toBe("joined");
      expect(await page.evaluate(() => window.adapterPlugins)).toEqual(["scale"]);
      pages.push(page);
    }
    let pair;
    await expect
      .poll(
        async () => {
          const topologies = await Promise.all(
            pages.map((page) => page.evaluate(() => window.testRoom.getTopology())),
          );
          const states = await Promise.all(
            pages.map((page) => page.evaluate(() => window.__harness.getState())),
          );
          if (states.some((state) => state.peers.length !== pages.length - 1)) return false;
          for (let i = 0; i < pages.length; i++)
            for (let j = 0; j < pages.length; j++) {
              if (
                i !== j &&
                topologies[i].routes[topologies[j].peerId]?.hops > 1 &&
                topologies[j].routes[topologies[i].peerId]?.hops > 1
              ) {
                pair = [i, j, topologies[j].peerId, topologies[i].peerId];
                return true;
              }
            }
          return false;
        },
        { timeout: 90000, intervals: [1000] },
      )
      .toBe(true);
    const [host, joiner, target, origin] = pair;
    for (const [page, remote] of [
      [pages[host], target],
      [pages[joiner], origin],
    ]) {
      await page.evaluate((id) => {
        window.sawDirect = window.testRoom.getTopology().directPeerIds.includes(id);
        window.watchDirect = setInterval(() => {
          window.sawDirect ||= window.testRoom.getTopology().directPeerIds.includes(id);
        }, 10);
      }, remote);
    }
    await pages[joiner].evaluate(() => window.__harness.sourceJoinerStart());
    await request.post("/control");
    await pages[host].evaluate(() =>
      window.__harness.sourceHostStart("scale-proof", "x".repeat(2 * 1024 * 1024)),
    );
    await expect
      .poll(() => pages[joiner].evaluate(() => window.__harness.getSourceState()), {
        timeout: 90000,
        intervals: [500],
      })
      .toMatchObject({ received: true, receivedLength: 2 * 1024 * 1024 });
    const received = await pages[joiner].evaluate(() => window.__harness.getSourceState());
    const sent = await pages[host].evaluate(() => window.__harness.getSourceState());
    expect(received.sourceSha256).toBe(sent.sourceSha256);
    for (const page of [pages[host], pages[joiner]]) {
      expect(
        await page.evaluate(() => {
          clearInterval(window.watchDirect);
          return window.sawDirect;
        }),
      ).toBe(false);
    }
    expect(
      (await pages[host].evaluate(() => window.testRoom.getTopology())).directPeerIds,
    ).not.toContain(target);
    await expect
      .poll(async () => (await (await request.get("/control")).json()).dropped, { timeout: 15000 })
      .toBeGreaterThan(0);
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});
