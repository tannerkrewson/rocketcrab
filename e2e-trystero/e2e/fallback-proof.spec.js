import { expect, test } from "@playwright/test";

for (const blocked of [false, true]) {
  test(`Trystero 0.27 ${blocked ? "tunnels when one browser blocks WebRTC" : "retains native WebRTC"}`, async ({
    browser,
  }) => {
    const contexts = await Promise.all([browser.newContext(), browser.newContext()]);
    try {
      const pages = await Promise.all(contexts.map((context) => context.newPage()));
      await Promise.all(
        pages.map((page, index) =>
          page.goto(`/fallback.html${blocked && index === 1 ? "?blocked" : ""}`),
        ),
      );
      const room = `proof-${Date.now()}-${Math.random()}`;
      await Promise.all(pages.map((page) => page.evaluate((id) => window.proof.join(id), room)));
      for (const page of pages)
        await expect
          .poll(() => page.evaluate(() => window.proof.state.peers), { timeout: 30000 })
          .toBe(1);
      await pages[0].evaluate(() => window.proof.send("from-first"));
      await pages[1].evaluate(() => window.proof.send("from-second"));
      await expect
        .poll(() => pages[0].evaluate(() => window.proof.state.messages))
        .toEqual(["from-second"]);
      await expect
        .poll(() => pages[1].evaluate(() => window.proof.state.messages))
        .toEqual(["from-first"]);
      // Give the fallback timer time to fire on the healthy path too.
      if (!blocked) await pages[0].waitForTimeout(3000);
      for (const page of pages) {
        const state = await page.evaluate(() => window.proof.state);
        expect(state.errors).toEqual([]);
        expect(state.tunnels).toBe(blocked ? 1 : 0);
        expect(state.nativeOpens).toBe(blocked ? 0 : 1);
      }
    } finally {
      await Promise.all(contexts.map((context) => context.close()));
    }
  });
}
