import { test, expect } from "@playwright/test";
test.setTimeout(120000);
test("shared creator candidate real transport admission boundary", async ({ browser }) => {
  const contexts = [];
  const page = async (path) => {
    const c = await browser.newContext();
    contexts.push(c);
    const p = await c.newPage();
    await p.goto(path);
    return p;
  };
  const room = `creator-proof-${Date.now()}`;
  const app = "creator-proof";
  try {
    const victim = await page("/");
    expect(
      await victim.evaluate(
        ({ room, app }) => window.__harness.joinRoomByCode({ room, appId: app }),
        { room, app },
      ),
    ).toBe("joined");
    await victim.evaluate(() => {
      window.slot = window.testRoom.makeState("proof.creator", null, {
        validate: (v, { prev }) => typeof v === "string" && (prev === null || prev === v),
      });
    });
    const attacker = await page("/context-proof.html");
    await attacker.evaluate(({ room, app }) => window.rawProof.start(room, app, true), {
      room,
      app,
    });
    await attacker.evaluate(() => window.rawProof.set("false-creator"));
    await expect
      .poll(() => victim.evaluate(() => window.__harness.getState().errors), { timeout: 30000 })
      .not.toEqual([]);
    await expect
      .poll(() => victim.evaluate(() => window.slot.get()), { timeout: 30000 })
      .toBe("false-creator");
    expect(await victim.evaluate(() => window.__harness.getState().peers)).toEqual([]);
    const valid = await page("/");
    expect(
      await valid.evaluate(
        ({ room, app }) => window.__harness.joinRoomByCode({ room, appId: app }),
        { room, app },
      ),
    ).toBe("joined");
    await valid.evaluate(async () => {
      window.slot = window.testRoom.makeState("proof.creator", null, {
        validate: (v, { prev }) => typeof v === "string" && (prev === null || prev === v),
      });
      await window.slot.set("real-creator");
    });
    await expect
      .poll(() => victim.evaluate(() => window.__harness.getState().peers.length), {
        timeout: 30000,
      })
      .toBe(1);
    await new Promise((r) => setTimeout(r, 1500));
    expect(await victim.evaluate(() => window.slot.get())).toBe("false-creator");
  } finally {
    await Promise.all(contexts.map((c) => c.close()));
  }
});
test("raw immutable slots: departed author late join and reconnect", async ({ browser }) => {
  const contexts = [];
  const page = async () => {
    const c = await browser.newContext();
    contexts.push(c);
    const p = await c.newPage();
    await p.goto("/context-proof.html");
    return p;
  };
  const room = `creator-late-${Date.now()}`,
    app = "creator-proof";
  try {
    const author = await page(),
      holder = await page();
    await author.evaluate(({ room, app }) => window.rawProof.start(room, app), { room, app });
    await author.evaluate(() => window.rawProof.set("creator"));
    await holder.evaluate(({ room, app }) => window.rawProof.start(room, app), { room, app });
    await expect
      .poll(() => holder.evaluate(() => window.rawProof.get()), { timeout: 30000 })
      .toBe("creator");
    await author.evaluate(() => window.rawProof.leave());
    const late = await page();
    await late.evaluate(({ room, app }) => window.rawProof.start(room, app), { room, app });
    await expect
      .poll(() => late.evaluate(() => window.rawProof.get()), { timeout: 30000 })
      .toBe("creator");
    await late.evaluate(() => window.rawProof.leave());
    await late.evaluate(({ room, app }) => window.rawProof.start(room, app), { room, app });
    await expect
      .poll(() => late.evaluate(() => window.rawProof.get()), { timeout: 30000 })
      .toBe("creator");
  } finally {
    await Promise.all(contexts.map((c) => c.close()));
  }
});
