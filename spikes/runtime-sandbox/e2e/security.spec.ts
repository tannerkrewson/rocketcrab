import { expect, test } from "@playwright/test";
import {
  EVIL_URL,
  HOST_URL,
  RUNTIME_ORIGIN,
  fixture,
  gameState,
  gotoHost,
  loadGame,
} from "./helpers";

test.describe("runtime sandbox security validation", () => {
  test("malicious game cannot reach the host origin, disable the stop control, or navigate the top", async ({
    page,
  }) => {
    await gotoHost(page);
    await page.evaluate(() => (window as any).__host.setSecret("host-secret-42"));
    await loadGame(page, fixture("malicious.html"));
    // give the delayed anchor-click attempt time to run
    await page.waitForTimeout(1000);
    const m = (await gameState(page))?.maliciousResult as Record<string, string>;
    console.log("malicious result:", JSON.stringify(m, null, 2));
    // The game is same-origin with the RUNTIME page (documented B5); the
    // boundary that must hold is with the HOST (Nova) origin:
    expect(m.topDom).toContain("blocked");
    expect(m.topStorage).toContain("blocked");
    expect(m.topCookies).toContain("blocked");
    expect(m.topNav).toContain("blocked");
    expect(m.disableStop).toContain("blocked");
    expect(m.runtimePageDom).toBeDefined();
    // Host stayed put and keeps its secret:
    expect(page.url()).toBe(HOST_URL);
    const host = await page.evaluate(() => (window as any).__host.getStatus());
    expect(host.secret).toBe("host-secret-42");
    // Emergency stop (outside the frame) still works:
    await page.click("#emergency-stop");
    await expect(page.locator("#status")).toContainText("destroyed");
  });

  test("wrong-origin bootstrap is rejected", async ({ page }) => {
    const warnings: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "warning") warnings.push(msg.text());
    });
    await page.goto(EVIL_URL);
    await page.waitForTimeout(2000);
    const received = await page.evaluate(() => (window as any).__received ?? null);
    expect(received).toBeNull();
    // The runtime frame must not have bootstrapped anyone.
    const runtime = page.frames().find((f) => f.url().startsWith(RUNTIME_ORIGIN));
    expect(runtime).toBeDefined();
    const children = await runtime!.evaluate(() =>
      (window as any).__runtimeApi.containerChildren(),
    );
    expect(children).toBe(0);
    expect(warnings.some((w) => w.includes("rejected message from origin"))).toBe(true);
  });

  test("malformed and unsupported messages are rejected with useful errors", async ({ page }) => {
    await gotoHost(page);
    await page.evaluate(() => {
      const host = (window as any).__host;
      host.rawSend({ type: "garbage", version: 1 });
      host.rawSend({ type: "nova:load-game", version: 1 }); // missing html
      host.rawSend({ type: "nova:load-game", version: 99, html: "<b>x</b>" }); // unsupported version
    });
    await expect(page.locator("#log")).toContainText("unknown message type", { timeout: 10_000 });
    await expect(page.locator("#log")).toContainText("load-game missing html", { timeout: 10_000 });
    await expect(page.locator("#log")).toContainText("unsupported protocol version", {
      timeout: 10_000,
    });
  });

  test("the runtime origin holds no host secrets", async ({ page }) => {
    await gotoHost(page);
    await page.evaluate(() => (window as any).__host.setSecret("host-secret-42"));
    await loadGame(page, fixture("hello.html"));
    await expect.poll(() => gameState(page).then((s) => s?.moduleReady)).toBe(true);
    const runtime = page.frames().find((f) => f.url().startsWith(RUNTIME_ORIGIN))!;
    const runtimeState = await runtime.evaluate(async () => {
      const ls = { ...localStorage };
      const idb: string[] = [];
      try {
        const dbs = await indexedDB.databases();
        idb.push(...dbs.map((d) => d.name ?? ""));
      } catch {
        idb.push("indexedDB.databases() unavailable");
      }
      return { localStorage: ls, cookies: document.cookie, idb };
    });
    console.log("runtime-origin storage:", JSON.stringify(runtimeState));
    expect(runtimeState.localStorage["nova_secret"]).toBeUndefined();
    expect(runtimeState.cookies).toBe("");
    expect(runtimeState.idb).toEqual([]);
  });

  test("a CPU-exhausting game wedges its frame but the app recovers via browser-level teardown", async ({
    page,
    browser,
  }) => {
    test.setTimeout(120_000);
    // Create the recovery page FIRST: browser-level operations can stall
    // while a wedged renderer is being torn down, so the fresh page must
    // already exist.
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    const fresh = await context.newPage();

    // Fixture loads normally, then starts a synchronous infinite loop after 4s.
    await gotoHost(page);
    await loadGame(page, fixture("infinite.html"));
    await expect.poll(async () => (await gameState(page))?.infiniteStarted).toBe(true);
    // Give the loop time to start and wedge the shared renderer. NOTE: in
    // this headless shell the runtime frame shares the host's renderer
    // process (no OOPIF), so the whole page becomes unresponsive. Real
    // browsers isolate cross-origin frames (see findings).
    await page.waitForTimeout(8000);

    // The recovery page must be fully functional.
    await gotoHost(fresh);
    await loadGame(fresh, fixture("hello.html"));
    await expect.poll(() => gameState(fresh).then((s) => s?.moduleReady)).toBe(true);
    await context.close();
  });

  test("a finite heavy CPU burst does not permanently break the runtime session", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await gotoHost(page);
    // The ~6s synchronous burst runs during document.write, so 'game loaded'
    // arrives only after it finishes. The session must then keep working.
    await loadGame(page, fixture("cpu-burst-finite.html"));
    await expect
      .poll(async () => (await gameState(page))?.burstStarted, { timeout: 30_000 })
      .toBe(true);
    await expect
      .poll(async () => (await gameState(page))?.burstDone, { timeout: 30_000 })
      .toBe(true);
    // And the runtime still serves games afterwards. (The cpu-burst fixture
    // sets burstStarted/burstDone, not moduleReady — the burst runs again
    // during the reload write.)
    await page.evaluate(() => (window as any).__host.reload());
    await expect(page.locator("#log")).toContainText("game loaded");
    await expect
      .poll(async () => (await gameState(page))?.burstDone, { timeout: 30_000 })
      .toBe(true);
  });
});
