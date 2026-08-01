import { expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dirname = path.dirname(fileURLToPath(import.meta.url));

export const HOST_URL = "https://localhost:5273/";
export const RUNTIME_ORIGIN = "https://localhost:5274";
export const EVIL_URL = "https://localhost:5275/";

export function fixture(name: string): string {
  return readFileSync(path.join(dirname, "..", "fixtures", name), "utf8");
}

/** Load the host page and wait for the runtime bootstrap to complete. */
export async function gotoHost(page: Page): Promise<void> {
  await page.goto(HOST_URL);
  await expect(page.locator("#status")).toContainText("ready", { timeout: 20_000 });
}

/** Send a game to the runtime and wait for the host to confirm it loaded. */
export async function loadGame(page: Page, html: string): Promise<void> {
  await page.evaluate((h) => (window as any).__host.load(h), html);
  await expect(page.locator("#log")).toContainText("game loaded", { timeout: 20_000 });
}

/** The runtime-origin frame hosted inside the host page, if present. */
export function findRuntimeFrame(page: Page): ReturnType<Page["frames"]>[number] | undefined {
  return page.frames().find((f) => f.url().startsWith(RUNTIME_ORIGIN));
}

/** Snapshot of observable state from inside the game frame (same-origin). */
export async function gameState(page: Page): Promise<Record<string, unknown> | null> {
  const runtime = findRuntimeFrame(page);
  if (!runtime) return null;
  return runtime.evaluate(() => {
    const api = (window as any).__runtimeApi;
    const w = api?.getGame?.();
    if (!w) return null;
    return {
      results: w.__results ?? null,
      moduleReady: w.__moduleReady ?? null,
      inlineClassic: w.__inlineClassic ?? null,
      maliciousResult: w.__maliciousResult ?? null,
      wsResult: w.__wsResult ?? null,
      infiniteStarted: w.__infiniteStarted ?? null,
      burstStarted: w.__burstStarted ?? null,
      burstDone: w.__burstDone ?? null,
      orientationSeen: w.__orientationSeen ?? null,
      visibilityChanges: w.__visibilityChanges ?? null,
      counter: w.__counter ?? null,
      errors: w.__novaBridge?.errors ?? [],
    };
  });
}
