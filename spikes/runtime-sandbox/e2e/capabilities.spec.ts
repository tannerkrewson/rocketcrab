import { expect, test } from "@playwright/test";
import {
  fixture,
  gameState,
  gotoHost,
  loadGame,
  RUNTIME_ORIGIN,
  findRuntimeFrame,
} from "./helpers";

// Automated rows of the F4 capability matrix. Rows that require a physical
// device (real camera/mic capture, real sensor data, real iOS backgrounding)
// are covered by the human checklist; here we verify what a desktop browser
// can prove (with fake media devices where noted).

test.describe("runtime sandbox capabilities", () => {
  test("inline scripts, remote ESM (jsDelivr), remote fetch, remote image, canvas 2d, WebGL", async ({
    page,
  }) => {
    await gotoHost(page);
    await loadGame(page, fixture("hello.html"));
    await expect.poll(() => gameState(page).then((s) => s?.moduleReady)).toBe(true);
    const r = (await gameState(page))?.results as Record<string, unknown>;
    const st = await gameState(page);
    console.log("hello results:", JSON.stringify(r, null, 2));
    expect(st?.inlineClassic).toBe(true);
    expect(r.inlineModule).toBe(true);
    expect(r.esmJsdelivr).toBe(true);
    expect(r.fetchRemote).toBe(true);
    expect(r.remoteImage).toBe(true);
    expect(r.canvas2d).toBe(true);
    expect(r.webgl).toBe(true);
  });

  test("web audio resumes after a user gesture", async ({ page }) => {
    await gotoHost(page);
    await loadGame(page, fixture("hello.html"));
    await expect.poll(() => gameState(page).then((s) => s?.moduleReady)).toBe(true);
    const initial = (await gameState(page))?.results as Record<string, unknown>;
    console.log("audio initial state:", initial.audioInitialState);
    const game = page
      .frameLocator(`iframe[src^="${RUNTIME_ORIGIN}"]`)
      .frameLocator('iframe[title="game sandbox"]');
    await game.locator("#clickme").click();
    await expect
      .poll(async () => (await gameState(page))?.results?.audioAfterGesture)
      .toBe("running");
  });

  test("websocket connects to the local wss echo server", async ({ page }) => {
    test.setTimeout(60_000);
    await gotoHost(page);
    await loadGame(page, fixture("ws.html"));
    await expect
      .poll(async () => (await gameState(page))?.wsResult, { timeout: 30_000 })
      .toBe("echo-ok");
  });

  test("file input reads a local file", async ({ page }) => {
    await gotoHost(page);
    await loadGame(page, fixture("hello.html"));
    await expect.poll(() => gameState(page).then((s) => s?.moduleReady)).toBe(true);
    const game = page
      .frameLocator(`iframe[src^="${RUNTIME_ORIGIN}"]`)
      .frameLocator('iframe[title="game sandbox"]');
    await game.locator("#file").setInputFiles({
      name: "note.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("HELLO-FROM-SPIKE"),
    });
    await expect.poll(async () => (await gameState(page))?.results?.fileInput).toBe(true);
  });

  test("clipboard write works after a user gesture with granted permission", async ({
    browser,
  }) => {
    const context = await browser.newContext({
      ignoreHTTPSErrors: true,
      permissions: ["clipboard-read", "clipboard-write"],
    });
    const page = await context.newPage();
    await gotoHost(page);
    await loadGame(page, fixture("hello.html"));
    await expect.poll(() => gameState(page).then((s) => s?.moduleReady)).toBe(true);
    const game = page
      .frameLocator(`iframe[src^="${RUNTIME_ORIGIN}"]`)
      .frameLocator('iframe[title="game sandbox"]');
    await game.locator("#clickme").click();
    await expect.poll(async () => (await gameState(page))?.results?.clipboardWrite).toBe(true);
    await context.close();
  });

  test("getUserMedia resolves with fake devices when permission is granted", async ({
    browser,
  }) => {
    const context = await browser.newContext({
      ignoreHTTPSErrors: true,
      permissions: ["camera", "microphone"],
    });
    const page = await context.newPage();
    await gotoHost(page);
    await loadGame(page, fixture("hello.html"));
    await expect.poll(async () => (await gameState(page))?.results?.media).toBeTruthy();
    const m = (await gameState(page))?.results?.media as { video: boolean; audio: boolean };
    expect(m).toEqual({ video: true, audio: true });
    await context.close();
  });

  test("device orientation listener fires on a synthetic event", async ({ page }) => {
    await gotoHost(page);
    await loadGame(page, fixture("hello.html"));
    await expect.poll(() => gameState(page).then((s) => s?.moduleReady)).toBe(true);
    const runtime = findRuntimeFrame(page)!;
    const gameFrame = runtime.childFrames()[0];
    await gameFrame.evaluate(() => {
      window.dispatchEvent(
        new DeviceOrientationEvent("deviceorientation", { alpha: 12, beta: 34, gamma: 56 }),
      );
    });
    await expect
      .poll(async () => (await gameState(page))?.orientationSeen)
      .toEqual({ alpha: 12, beta: 34, gamma: 56 });
  });

  test("fullscreen and pointer lock (informational on headless)", async ({ page }) => {
    await gotoHost(page);
    await loadGame(page, fixture("hello.html"));
    await expect.poll(() => gameState(page).then((s) => s?.moduleReady)).toBe(true);
    const game = page
      .frameLocator(`iframe[src^="${RUNTIME_ORIGIN}"]`)
      .frameLocator('iframe[title="game sandbox"]');
    await game.locator("#clickme").click();
    await expect
      .poll(async () => (await gameState(page))?.results?.fullscreen !== undefined)
      .toBe(true);
    const r = (await gameState(page))?.results as Record<string, unknown>;
    console.log("fullscreen:", r.fullscreen, "| pointerLock:", r.pointerLock);
    // Headless support varies; record the real value rather than force a
    // pass. The matrix and physical checklist capture the truth.
    test.info().annotations.push({
      type: "capability",
      description: `fullscreen=${String(r.fullscreen)} pointerLock=${String(r.pointerLock)} (headless)`,
    });
    expect(r.fullscreen).toBeDefined();
    expect(r.pointerLock).toBeDefined();
  });

  test("page visibility change is observable by the game", async ({ page }) => {
    await gotoHost(page);
    await loadGame(page, fixture("hello.html"));
    await expect.poll(() => gameState(page).then((s) => s?.moduleReady)).toBe(true);
    const runtime = findRuntimeFrame(page)!;
    const gameFrame = runtime.childFrames()[0];
    await gameFrame.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await expect.poll(async () => (await gameState(page))?.visibilityChanges).toBeGreaterThan(0);
  });

  test("reload produces a clean frame; destroy removes it", async ({ page }) => {
    await gotoHost(page);
    await loadGame(page, fixture("hello.html"));
    await expect.poll(() => gameState(page).then((s) => s?.moduleReady)).toBe(true);
    // stamp state in the game window
    const runtime = findRuntimeFrame(page)!;
    await runtime.childFrames()[0].evaluate(() => {
      (window as any).__counter = 7;
    });
    expect((await gameState(page))?.counter).toBe(7);
    // soft reload must recreate a clean frame
    await page.evaluate(() => (window as any).__host.reload());
    await expect(page.locator("#log")).toContainText("game loaded");
    await expect.poll(() => gameState(page).then((s) => s?.moduleReady)).toBe(true);
    expect((await gameState(page))?.counter).toBeNull();
    // destroy must remove the game frame entirely
    await page.evaluate(() => (window as any).__host.destroy());
    await expect(page.locator("#status")).toContainText("destroyed");
    expect(findRuntimeFrame(page)).toBeUndefined();
  });
});
