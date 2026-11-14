import { expect, test } from "@playwright/test";

// Question map (PLAN.md §3.5 makeUserState bullet):
//   Q1 existing admitted peer sees a rename (and a burst settles on the final name)
//   Q2 late joiner sees the latest name, not the original
//   Q3 an update before admission is applied from the current slot at admission
//   Q4 writes from an unadmitted or rejected peer are not applied
//   Q5 reconnect: the old endpoint's slot disappears; the new endpoint is a new user
//      whose name is applied only after admission
// Every "not applied" assertion first waits until the value has reached the slot,
// so an empty event list cannot pass merely because the update has not arrived yet.

const POLL = { timeout: 30_000 };

async function withRoom(browser, body) {
  const contexts = [];
  const roomId = `presence-${Date.now()}-${Math.random()}`;
  const h = {
    async open() {
      const context = await browser.newContext();
      contexts.push(context);
      const page = await context.newPage();
      await page.goto(`/presence-proof.html?room=${roomId}`);
      await page.waitForFunction(() => window.proof);
      const self = await page.evaluate(() => window.proof.self());
      return { page, ...self };
    },
    async waitPeer(observer, peer) {
      await expect
        .poll(
          () => observer.page.evaluate((id) => Boolean(window.proof.peers()[id]), peer.peerId),
          POLL,
        )
        .toBe(true);
    },
    async admit(observer, peer) {
      await observer.page.evaluate((id) => window.proof.admit(id), peer.peerId);
    },
    async reject(observer, peer) {
      await observer.page.evaluate((id) => window.proof.reject(id), peer.peerId);
    },
    async reset(observer) {
      await observer.page.evaluate(() => window.proof.reset());
    },
    async set(peer, value) {
      await peer.page.evaluate((v) => window.proof.set(v), value);
    },
    async slot(observer, target) {
      return observer.page.evaluate((id) => window.proof.get(id), target.userId);
    },
    async expectSlot(observer, target, value) {
      await expect.poll(() => h.slot(observer, target), POLL).toBe(value);
    },
    async appliedValues(observer) {
      const events = await observer.page.evaluate(() => window.proof.events());
      return events.map((event) => event.value);
    },
    async pair() {
      const a = await h.open();
      const b = await h.open();
      await h.waitPeer(b, a);
      await h.waitPeer(a, b);
      return { a, b };
    },
  };
  try {
    await body(h);
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
}

test("Q1: an admitted peer sees a rename", async ({ browser }) => {
  await withRoom(browser, async (h) => {
    const { a, b } = await h.pair();
    await h.admit(b, a);
    await h.reset(b);
    await h.set(a, "Alpha");
    await expect.poll(() => h.appliedValues(b), POLL).toEqual(["Alpha"]);
    await h.reset(b);
    await h.set(a, "Beta");
    await expect.poll(() => h.appliedValues(b), POLL).toEqual(["Beta"]);
  });
});

test("Q1: a burst of renames settles on the final name", async ({ browser }) => {
  await withRoom(browser, async (h) => {
    const { a, b } = await h.pair();
    await h.admit(b, a);
    await h.reset(b);
    await a.page.evaluate(() => window.proof.burst(["one", "two", "three"]));
    await expect.poll(() => h.appliedValues(b), POLL).toEqual(["three"]);
    await h.expectSlot(b, a, "three");
  });
});

test("Q2: a late joiner sees the latest name, not the original", async ({ browser }) => {
  await withRoom(browser, async (h) => {
    const { a, b } = await h.pair();
    await h.admit(b, a);
    await h.set(a, "original");
    await expect.poll(() => h.appliedValues(b), POLL).toEqual(["original"]);
    await h.set(a, "latest");
    await expect.poll(() => h.appliedValues(b), POLL).toEqual(["original", "latest"]);

    const c = await h.open();
    await h.waitPeer(c, a);
    await h.expectSlot(c, a, "latest");
    expect(await h.appliedValues(c)).toEqual([]);
    await h.admit(c, a);
    expect(await h.appliedValues(c)).toEqual(["latest"]);
  });
});

test("Q3: an update before admission is applied from the current slot at admission", async ({
  browser,
}) => {
  await withRoom(browser, async (h) => {
    const { a, b } = await h.pair();
    await h.set(a, "before admission");
    await h.expectSlot(b, a, "before admission");
    expect(await h.appliedValues(b)).toEqual([]);

    await h.admit(b, a);
    expect(await h.appliedValues(b)).toEqual(["before admission"]);

    await h.set(a, "after admission");
    await expect
      .poll(() => h.appliedValues(b), POLL)
      .toEqual(["before admission", "after admission"]);
  });
});

test("Q4: writes from a never-admitted peer are not applied", async ({ browser }) => {
  await withRoom(browser, async (h) => {
    const { a, b } = await h.pair();
    const c = await h.open();
    await h.waitPeer(b, c);
    await h.set(c, "intruder");
    await h.expectSlot(b, c, "intruder");
    expect(await h.appliedValues(b)).toEqual([]);
    expect(await h.slot(b, a)).toBe(null);
  });
});

test("Q4: writes from a rejected peer are not applied", async ({ browser }) => {
  await withRoom(browser, async (h) => {
    const { a, b } = await h.pair();
    await h.admit(b, a);
    await h.set(a, "accepted");
    await expect.poll(() => h.appliedValues(b), POLL).toEqual(["accepted"]);
    await h.reject(b, a);
    await h.reset(b);
    await h.set(a, "rejected");
    await h.expectSlot(b, a, "rejected");
    expect(await h.appliedValues(b)).toEqual([]);
  });
});

test("Q5: reconnect clears the old slot; the new endpoint's name waits for admission", async ({
  browser,
}) => {
  await withRoom(browser, async (h) => {
    const { a, b } = await h.pair();
    await h.admit(b, a);
    await h.set(a, "Alpha");
    await expect.poll(() => h.appliedValues(b), POLL).toEqual(["Alpha"]);

    await a.page.evaluate(() => window.proof.leave());
    await expect
      .poll(() => b.page.evaluate((id) => Boolean(window.proof.peers()[id]), a.peerId), POLL)
      .toBe(false);
    await expect.poll(() => h.slot(b, a), POLL).toBe(null);

    const again = await h.open();
    expect(again.userId).not.toBe(a.userId);
    await h.waitPeer(b, again);
    await h.reset(b);
    await h.set(again, "Returned");
    await h.expectSlot(b, again, "Returned");
    expect(await h.appliedValues(b)).toEqual([]);
    await h.admit(b, again);
    expect(await h.appliedValues(b)).toEqual(["Returned"]);
  });
});
