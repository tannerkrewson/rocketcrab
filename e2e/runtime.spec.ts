/** Exercise the runtime through a Nova-origin host: execution, reporting, lifecycle, and isolation. */
import { expect, test } from "@playwright/test";
import {
  NOVA_ORIGIN,
  RUNTIME_ORIGIN,
  clearHarnessEvents,
  fixture,
  gameState,
  harnessEvents,
  installHarness,
  loadGame,
  runtimeInternals,
} from "./runtime-helpers";

test.describe("runtime bootstrap and game execution", () => {
  test("a complete pasted HTML document starts and registers via nova.defineGame", async ({
    page,
  }) => {
    await installHarness(page);
    await loadGame(page, {
      gameId: "game-hello",
      gameSource: fixture("hello.html"),
      gameTitle: "Host Title",
    });

    const state = await gameState(page);
    expect(state?.inlineClassic).toBe(true);
    expect(state?.moduleRan).toBe(true);
    expect(state?.registered).toBe(true);
    expect(state?.novaVersion).toBe(1);
    expect(state?.bridgeVersion).toBe(1);

    const events = await harnessEvents(page);
    const registration = events.find((e) => e.type === "game.registration");
    expect(registration?.title).toBe("Hello Game");
    expect(registration?.gameVersion).toBe("1.0.0");
    expect(registration?.gameId).toBe("game-hello");
  });

  test("remote dependencies run without rewriting", async ({ page }) => {
    test.setTimeout(90_000);
    await installHarness(page);
    await loadGame(page, {
      gameId: "game-remote",
      gameSource: fixture("remote.html"),
    });
    await expect
      .poll(async () => (await gameState(page))?.remoteDep, { timeout: 60_000 })
      .toMatch(/^[0-9a-f-]{36}$/);
  });
});

test.describe("runtime diagnostics", () => {
  test("runtime errors, rejections, and console entries appear in Nova", async ({ page }) => {
    await installHarness(page);
    await loadGame(page, {
      gameId: "game-errors",
      gameSource: fixture("errors.html"),
    });

    // Error and rejection events arrive independently; wait for both rather
    // than assuming the first error means all diagnostics have arrived.
    await expect
      .poll(async () => {
        const events = await harnessEvents(page);
        return (
          events.some(
            (e) => e.type === "runtime.error" && String(e.message).includes("game exploded"),
          ) &&
          events.some(
            (e) => e.type === "runtime.error" && String(e.message).includes("Unhandled rejection"),
          ) &&
          events.some(
            (e) =>
              e.type === "runtime.console" && String(e.message).includes("hello from the game"),
          )
        );
      })
      .toBe(true);
    const events = await harnessEvents(page);
    const messages = events
      .filter((e) => e.type === "runtime.error")
      .map((e) => String(e.message ?? ""));
    expect(messages.some((m) => m.includes("game exploded"))).toBe(true);
    expect(messages.some((m) => m.includes("Unhandled rejection"))).toBe(true);

    const consoleEvents = events.filter((e) => e.type === "runtime.console");
    expect(consoleEvents.length).toBeGreaterThan(0);
    expect(consoleEvents[0]?.message).toContain("hello from the game");
  });
});

test.describe("runtime lifecycle controls", () => {
  test("reload creates a clean frame", async ({ page }) => {
    await installHarness(page);
    await loadGame(page, {
      gameId: "game-hello",
      gameSource: fixture("hello.html"),
    });
    await expect.poll(async () => (await gameState(page))?.bootCount).toBe(1);

    await page.evaluate(() =>
      (window as unknown as { __harness: { reload(): void } }).__harness.reload(),
    );
    await expect
      .poll(async () =>
        (await harnessEvents(page)).some(
          (e) => e.type === "game.lifecycle" && e.event === "reloaded",
        ),
      )
      .toBe(true);
    const state = await gameState(page);
    expect(state?.bootCount).toBe(1);
    expect(state?.moduleRan).toBe(true);
  });

  test("destroy removes the frame and all listeners", async ({ page }) => {
    await installHarness(page);
    await loadGame(page, {
      gameId: "game-hello",
      gameSource: fixture("hello.html"),
    });
    await page.evaluate(() =>
      (window as unknown as { __harness: { destroy(): void } }).__harness.destroy(),
    );
    await expect
      .poll(async () =>
        (await harnessEvents(page)).some(
          (e) => e.type === "game.lifecycle" && e.event === "destroyed",
        ),
      )
      .toBe(true);
    const internals = await runtimeInternals(page);
    expect(internals.hasFrame).toBe(false);
    expect(internals.activeInstanceCount).toBe(0);
    const runtime = page.frames().find((f) => f.url().startsWith(RUNTIME_ORIGIN));
    const hookGone = await runtime!.evaluate(
      () => (window as unknown as { __novaRuntime?: unknown }).__novaRuntime === undefined,
    );
    expect(hookGone).toBe(true);
  });

  test("ten consecutive restart cycles do not leak active message handlers", async ({ page }) => {
    await installHarness(page);
    for (let cycle = 0; cycle < 10; cycle += 1) {
      await loadGame(page, {
        gameId: `game-cycle-${cycle}`,
        gameSource: fixture("hello.html"),
      });
      await page.evaluate(() =>
        (window as unknown as { __harness: { destroy(): void } }).__harness.destroy(),
      );
      await expect.poll(async () => (await runtimeInternals(page)).activeInstanceCount).toBe(0);
    }

    await loadGame(page, {
      gameId: "game-final",
      gameSource: fixture("hello.html"),
    });
    await clearHarnessEvents(page);
    await page.evaluate(() =>
      (window as unknown as { __harness: { ping(): void } }).__harness.ping(),
    );
    await expect
      .poll(async () => (await harnessEvents(page)).filter((e) => e.type === "pong").length)
      .toBe(1);

    const internals = await runtimeInternals(page);
    expect(internals.activeInstanceCount).toBe(1);
    expect((internals.outgoingTypes as string[]).filter((t) => t === "runtime.ready")).toHaveLength(
      1,
    );
    expect((internals.outgoingTypes as string[]).filter((t) => t === "runtime.error")).toHaveLength(
      0,
    );
  });

  test("heartbeat keeps the shell informed of a live runtime", async ({ page }) => {
    await installHarness(page);
    await loadGame(page, {
      gameId: "game-hello",
      gameSource: fixture("hello.html"),
    });
    await page.evaluate(() =>
      (window as unknown as { __harness: { ping(): void } }).__harness.ping(),
    );
    await expect
      .poll(async () => (await harnessEvents(page)).some((e) => e.type === "pong"))
      .toBe(true);
    expect((await harnessEvents(page)).some((e) => e.type === "runtime.ready")).toBe(true);
  });
});

test.describe("cross-origin isolation", () => {
  test("malicious game cannot reach the host origin or disable the stop control", async ({
    page,
  }) => {
    await installHarness(page);
    await loadGame(page, {
      gameId: "game-malicious",
      gameSource: fixture("malicious.html"),
    });
    await expect.poll(async () => (await gameState(page))?.malicious).toBeTruthy();
    const m = (await gameState(page))?.malicious as Record<string, string>;
    expect(m.topDom).toContain("blocked");
    expect(m.topStorage).toContain("blocked");
    expect(m.topNav).toContain("blocked");
    expect(m.disableStop).toContain("blocked");
    expect(m.runtimePageDom).toBe(true); // same-origin with the runtime page (ADR-0008)
    expect(page.url()).toBe(NOVA_ORIGIN + "/");
  });

  test("runtime origin holds no host secrets", async ({ page }) => {
    await installHarness(page);
    await loadGame(page, {
      gameId: "game-hello",
      gameSource: fixture("hello.html"),
    });
    const runtime = page.frames().find((f) => f.url().startsWith(RUNTIME_ORIGIN));
    expect(runtime).toBeDefined();
    const secrets = await runtime!.evaluate(async () => {
      const dbs = "indexedDB" in window ? await indexedDB.databases() : [];
      return {
        localStorageKeys: Object.keys(localStorage),
        cookies: document.cookie,
        indexedDbs: dbs.map((db) => db.name),
        hasServiceWorker: navigator.serviceWorker.controller !== null,
      };
    });
    expect(secrets.localStorageKeys).toEqual([]);
    expect(secrets.cookies).toBe("");
    expect(secrets.indexedDbs).toEqual([]);
    expect(secrets.hasServiceWorker).toBe(false);
  });

  test("a bootstrap from a non-main origin is rejected", async ({ page }) => {
    await page.goto(RUNTIME_ORIGIN + "/");
    // Try the bootstrap from the runtime page itself (origin 2723, not 2722).
    await page.evaluate(() => {
      const channel = new MessageChannel();
      (
        window as unknown as {
          postMessage(message: unknown, origin: string, transfer: Transferable[]): void;
        }
      ).postMessage(
        {
          version: 1,
          runtimeInstanceId: "evil-1",
          messageId: "m",
          sentAt: Date.now(),
          type: "runtime.bootstrap",
          gameId: "evil",
          gameSource: "<html></html>",
          player: { memberId: "m", displayName: "Evil" },
        },
        window.location.origin,
        [channel.port2],
      );
    });
    await page.waitForTimeout(500);
    const internals = await page.evaluate(() => {
      const api = (
        window as unknown as {
          __runtimeApi?: { activeInstanceCount(): number; hasFrame(): boolean };
        }
      ).__runtimeApi;
      return api ? { count: api.activeInstanceCount(), hasFrame: api.hasFrame() } : null;
    });
    expect(internals?.count).toBe(0);
    expect(internals?.hasFrame).toBe(false);
  });

  test("malformed and unsupported bootstrap messages are rejected", async ({ page }) => {
    await page.goto(RUNTIME_ORIGIN + "/");
    await page.evaluate(() => {
      const win = window as unknown as {
        postMessage(message: unknown, origin: string, transfer: Transferable[]): void;
      };
      win.postMessage({ garbage: true }, window.location.origin, []);
      const channel = new MessageChannel();
      win.postMessage({ version: 1, type: "runtime.ping" }, window.location.origin, [
        channel.port2,
      ]);
    });
    await page.waitForTimeout(500);
    const internals = await page.evaluate(() => {
      const api = (window as unknown as { __runtimeApi?: { activeInstanceCount(): number } })
        .__runtimeApi;
      return api ? api.activeInstanceCount() : null;
    });
    expect(internals).toBe(0);
  });
});
