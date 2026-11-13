import { test, expect } from "@playwright/test";

test("2 MiB request response over a virtual route with signaling blocked", async ({
  browser,
  request,
}) => {
  const contexts = [];
  try {
    await request.post("/control/reset");
    const pages = [];
    const room = `scale-${Date.now()}`;
    for (let i = 0; i < 8; i++) {
      const context = await browser.newContext();
      contexts.push(context);
      const page = await context.newPage();
      await page.goto(`/scale-proof.html?room=${room}`);
      await page.waitForFunction(() => window.proof !== undefined);
      pages.push(page);
    }
    let pair;
    await expect
      .poll(
        async () => {
          const topologies = await Promise.all(
            pages.map((page) => page.evaluate(() => window.proof.topology())),
          );
          if (topologies.some((topology) => topology.roomPeerIds.length !== pages.length - 1))
            return false;
          for (let i = 0; i < pages.length; i++) {
            for (let j = 0; j < pages.length; j++) {
              if (i !== j && topologies[i].routes[topologies[j].peerId]?.hops > 1) {
                if (
                  topologies[j].routes[topologies[i].peerId]?.hops <= 1 ||
                  !topologies[j].routes[topologies[i].peerId]
                )
                  continue;
                pair = [i, j, topologies[j].peerId, topologies[i].peerId];
                return true;
              }
            }
          }
          return false;
        },
        { timeout: 90000, intervals: [1000] },
      )
      .toBe(true);
    const [from, to, target, origin] = pair;
    await pages[from].evaluate((id) => window.proof.watch(id), target);
    await pages[to].evaluate((id) => window.proof.watch(id), origin);
    await request.post("/control");
    expect((await (await request.get("/control")).json()).blocked).toBe(true);
    expect(await pages[from].evaluate((id) => window.proof.request(id), target)).toBe(
      2 * 1024 * 1024,
    );
    const after = await pages[from].evaluate(() => window.proof.topology());
    expect(after.directPeerIds).not.toContain(target);
    expect(await pages[from].evaluate(() => window.proof.stopWatch())).toBe(false);
    expect(await pages[to].evaluate(() => window.proof.stopWatch())).toBe(false);
    await expect
      .poll(async () => (await (await request.get("/control")).json()).dropped, {
        timeout: 15000,
      })
      .toBeGreaterThan(0);
    const stats = await (await request.get("/control")).json();
    console.log(JSON.stringify({ from, to, route: after.routes[target], dropped: stats.dropped }));
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});
