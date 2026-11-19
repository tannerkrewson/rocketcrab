/**
 * Diagnostics for the 3-player party specs. When a player never reaches the
 * play view, dump every page's engine state (window.__NOVA_PARTY_DEBUG__, dev
 * and test builds only), so the blocking step is visible in the test output.
 * With PLAY_TRACE_DIR set, each page's console is also saved there.
 */
import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { expect, type BrowserContext, type Page } from "@playwright/test";

const TRACE_DIR = process.env.PLAY_TRACE_DIR;

/**
 * Players must name themselves before starting or joining a party. Seed a
 * saved name (the app's own storage key) so party specs skip that step.
 */
export async function seedPlayerName(context: BrowserContext, name: string): Promise<void> {
  await context.addInitScript((value: string) => {
    if (localStorage.getItem("nova:player:name:v1") === null) {
      localStorage.setItem("nova:player:name:v1", value);
    }
  }, name);
}

/**
 * Record the invite each page copies, instead of reading the clipboard:
 * Firefox and WebKit do not grant clipboard permissions in Playwright. A page
 * reads its last copied text from `window.__copied`.
 */
export async function recordCopiedInvites(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    const win = window as unknown as { __copied: string[] };
    win.__copied = [];
    try {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: (text: string) => {
            win.__copied.push(String(text));
            return Promise.resolve();
          },
          readText: () => Promise.resolve(win.__copied.at(-1) ?? ""),
        },
      });
    } catch {
      // Keep the page's own clipboard if it cannot be replaced.
    }
  });
}

/** Save every console line of a page to PLAY_TRACE_DIR (when set). */
export function recordConsole(page: Page, label: string): void {
  if (TRACE_DIR === undefined) return;
  mkdirSync(TRACE_DIR, { recursive: true });
  const file = path.join(TRACE_DIR, `${label}.log`);
  page.on("console", (message) => appendFileSync(file, `${message.text()}\n`));
}

/** The page's party engine snapshot, as JSON text. */
export async function partyStateOf(page: Page): Promise<string> {
  return page
    .evaluate(() => {
      const debug = (window as { __NOVA_PARTY_DEBUG__?: () => unknown }).__NOVA_PARTY_DEBUG__;
      return debug ? JSON.stringify(debug(), null, 2) : "no __NOVA_PARTY_DEBUG__ hook";
    })
    .catch((error: unknown) => `snapshot failed: ${String(error)}`);
}

/** Print every page's state; save it under PLAY_TRACE_DIR when set. */
export async function dumpPartyStates(
  pages: ReadonlyArray<{ page: Page; label: string }>,
): Promise<void> {
  for (const { page, label } of pages) {
    const state = await partyStateOf(page);
    console.log(`PARTY_STATE ${label}\n${state}`);
    if (TRACE_DIR !== undefined) {
      mkdirSync(TRACE_DIR, { recursive: true });
      appendFileSync(path.join(TRACE_DIR, `${label}.state.json`), `${state}\n`);
    }
  }
}

/**
 * Every player reaches the play view. On a failure, dump all pages' state
 * first, then rethrow the assertion.
 */
export async function expectPlayViewOnAll(
  pages: ReadonlyArray<{ page: Page; label: string }>,
  timeout = 120_000,
): Promise<void> {
  try {
    for (const { page } of pages) {
      await expect(page.getByTestId("party-play-view")).toBeVisible({ timeout });
    }
  } catch (error) {
    await dumpPartyStates(pages);
    throw error;
  }
}
