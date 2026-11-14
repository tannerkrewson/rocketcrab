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
      window.marker = window.testRoom.makeState("proof.marker", null);
    });
    const attacker = await page("/context-proof.html");
    await attacker.evaluate(({ room, app }) => window.rawProof.start(room, app, true), {
      room,
      app,
    });
    await attacker.evaluate(() => window.rawProof.set("false-creator"));
    // Positive control: the harness rejects the attacker's deliberately invalid
    // nova.identity payload with this exact category and message.
    await expect
      .poll(() => victim.evaluate(() => window.__harness.getState().errors), { timeout: 30000 })
      .toContain("rejected: Identity handshake failed: peer sent an invalid identity.");
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
      window.marker = window.testRoom.makeState("proof.marker", null);
      await window.marker.set("sent");
    });
    // Positive control: the valid writer's own first value is accepted locally.
    expect(await valid.evaluate(() => window.slot.get())).toBe("real-creator");
    await expect
      .poll(() => victim.evaluate(() => window.__harness.getState().peers.length), {
        timeout: 30000,
      })
      .toBe(1);
    // Delivery signal: the marker is written after "real-creator" on the same
    // peer. Its arrival shows the valid-to-victim state path is live; it does not
    // by itself prove the "real-creator" record arrived and was rejected.
    await expect
      .poll(() => victim.evaluate(() => window.marker.get()), { timeout: 30000 })
      .toBe("sent");
    expect(await victim.evaluate(() => window.slot.get())).toBe("false-creator");
    expect(await valid.evaluate(() => window.slot.get())).toBe("real-creator");
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
