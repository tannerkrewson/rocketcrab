/**
 * U3 runtime-origin e2e: the runtime app (apps/runtime, http://localhost:5174)
 * exercised end-to-end from a host harness on the Nova origin
 * (http://localhost:5173) — exact-origin bootstrap, dedicated
 * MessageChannel, game execution (inline + module scripts, remote deps),
 * registration, error/console forwarding, heartbeat, reload/destroy, and
 * cross-origin isolation. Mirrors the F4 spike validation with the F6
 * protocol schemas.
 */
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
      gameMode: "state",
      gameSource: fixture("hello.html"),
      gameTitle: "Host Title",
    });

    const state = await gameState(page);
    expect(state?.inlineClassic).toBe(true); // classic inline script ran
    expect(state?.moduleRan).toBe(true); // inline module ran
    expect(state?.registered).toBe(true); // game called nova.defineGame
    expect(state?.novaVersion).toBe(1); // injected Nova API bootstrap version
    expect(state?.bridgeVersion).toBe(1);

    const events = await harnessEvents(page);
    const registration = events.find((e) => e.type === "game.registration");
    expect(registration?.title).toBe("Hello Game"); // game-declared title
    expect(registration?.gameMode).toBe("state");
    expect(registration?.gameVersion).toBe("1.0.0");
    expect(registration?.gameId).toBe("game-hello");
  });

  test("remote dependencies run without rewriting", async ({ page }) => {
    test.setTimeout(90_000);
    await installHarness(page);
    await loadGame(page, {
      gameId: "game-remote",
      gameMode: "state",
      gameSource: fixture("remote.html"),
    });
    await expect
      .poll(async () => (await gameState(page))?.remoteDep, { timeout: 60_000 })
      .toMatch(/^[0-9a-f-]{36}$/); // uuid v4() result
  });
});

test.describe("runtime diagnostics", () => {
  test("runtime errors, rejections, and console entries appear in Nova", async ({ page }) => {
    await installHarness(page);
    await loadGame(page, {
      gameId: "game-errors",
      gameMode: "state",
      gameSource: fixture("errors.html"),
    });

    await expect
      .poll(async () => (await harnessEvents(page)).map((e) => e.type))
      .toContain("runtime.error");
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

  test("registration timeout reports missing nova.defineGame", async ({ page }) => {
    test.setTimeout(40_000);
    await installHarness(page);
    await loadGame(page, {
      gameId: "game-silent",
      gameMode: "state",
      gameSource: "<!doctype html><html><body><h1>silent</h1></body></html>",
    });
    await expect
      .poll(
        async () =>
          (await harnessEvents(page)).some(
            (e) => e.type === "runtime.error" && e.category === "missing_registration",
          ),
        { timeout: 20_000 },
      )
      .toBe(true);
  });
});

test.describe("runtime lifecycle controls", () => {
  test("reload creates a clean frame", async ({ page }) => {
    await installHarness(page);
    await loadGame(page, {
      gameId: "game-hello",
      gameMode: "state",
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
    // A fresh frame means the counter restarts at 1 and the module re-runs.
    const state = await gameState(page);
    expect(state?.bootCount).toBe(1);
    expect(state?.moduleRan).toBe(true);
  });

  test("destroy removes the frame and all listeners", async ({ page }) => {
    await installHarness(page);
    await loadGame(page, {
      gameId: "game-hello",
      gameMode: "state",
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
    // The per-instance game hook must be gone.
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
        gameMode: "state",
        gameSource: fixture("hello.html"),
      });
      await page.evaluate(() =>
        (window as unknown as { __harness: { destroy(): void } }).__harness.destroy(),
      );
      await expect.poll(async () => (await runtimeInternals(page)).activeInstanceCount).toBe(0);
    }

    // One more session: a single ping must produce exactly one pong and the
    // runtime must not have accumulated security errors or duplicate state.
    await loadGame(page, {
      gameId: "game-final",
      gameMode: "state",
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
    ); // exactly one ready for the current instance
    expect((internals.outgoingTypes as string[]).filter((t) => t === "runtime.error")).toHaveLength(
      0,
    );
  });

  test("heartbeat keeps the shell informed of a live runtime", async ({ page }) => {
    await installHarness(page);
    await loadGame(page, {
      gameId: "game-hello",
      gameMode: "state",
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
      gameMode: "raw",
      gameSource: fixture("malicious.html"),
    });
    await expect.poll(async () => (await gameState(page))?.malicious).toBeTruthy();
    const m = (await gameState(page))?.malicious as Record<string, string>;
    expect(m.topDom).toContain("blocked");
    expect(m.topStorage).toContain("blocked");
    expect(m.topNav).toContain("blocked");
    expect(m.disableStop).toContain("blocked");
    expect(m.runtimePageDom).toBe(true); // same-origin with the runtime page (ADR-0008)
    // The host tab never navigated.
    expect(page.url()).toBe(NOVA_ORIGIN + "/");
  });

  test("runtime origin holds no host secrets", async ({ page }) => {
    await installHarness(page);
    await loadGame(page, {
      gameId: "game-hello",
      gameMode: "state",
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
    // Try the bootstrap from the runtime page itself (origin 5174, not 5173).
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
          gameMode: "state",
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
