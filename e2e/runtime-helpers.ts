/**
 * E2E helpers for the runtime-origin tests (U3).
 *
 * The runtime's real host is the Nova shell (apps/nova); until U4 wires it
 * into the UI, the e2e tests act as the host: they install a small harness
 * on the Nova origin (http://localhost:5173), embed the runtime iframe
 * (http://localhost:5174), and perform the exact-origin postMessage
 * bootstrap with a dedicated MessageChannel — the same handshake the host
 * bridge (apps/nova/src/lib/runtime-host.ts) performs.
 */
import { expect, type Frame, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dirname = path.dirname(fileURLToPath(import.meta.url));

export const NOVA_ORIGIN = "http://localhost:5173";
export const RUNTIME_ORIGIN = "http://localhost:5174";

export function fixture(name: string): string {
  return readFileSync(path.join(dirname, "..", "apps", "runtime", "fixtures", name), "utf8");
}

export interface GameInput {
  gameId: string;
  gameMode: "state" | "simulation" | "raw";
  gameSource: string;
  gameTitle?: string;
  memberId?: string;
  displayName?: string;
}

/** Install the host harness on the Nova origin page. */
export async function installHarness(page: Page): Promise<void> {
  await page.goto(NOVA_ORIGIN + "/");
  await page.evaluate(() => {
    const RUNTIME_ORIGIN = "http://localhost:5174";
    const container = document.createElement("div");
    container.id = "runtime-host";
    document.body.appendChild(container);

    const events: Array<Record<string, unknown>> = [];
    const state: Record<string, unknown> = { ready: false, unresponsive: false, missedPongs: 0 };
    let iframe: HTMLIFrameElement | null = null;
    let port: MessagePort | null = null;

    function handle(data: unknown): void {
      const msg = (data ?? {}) as { type?: string };
      if (!msg.type) return;
      if (msg.type === "runtime.pong") {
        state.missedPongs = 0;
        events.push({ type: "pong" });
        return;
      }
      events.push({ ...msg });
      if (msg.type === "runtime.ready") {
        state.ready = true;
      }
    }

    function waitForReady(timeoutMs: number): Promise<void> {
      return new Promise((resolve, reject) => {
        const deadline = setTimeout(() => reject(new Error("bootstrap timeout")), timeoutMs);
        const poll = setInterval(() => {
          if (state.ready) {
            clearInterval(poll);
            clearTimeout(deadline);
            resolve();
          }
        }, 25);
      });
    }

    async function bootstrap(game: GameInput): Promise<void> {
      if (!iframe) {
        iframe = document.createElement("iframe");
        iframe.setAttribute("sandbox", "allow-scripts allow-same-origin");
        iframe.setAttribute(
          "allow",
          "camera; microphone; clipboard-read; clipboard-write; fullscreen",
        );
        iframe.allowFullscreen = true;
        iframe.style.cssText = "width:100%;height:600px;border:0";
        container.appendChild(iframe);
        iframe.src = `${RUNTIME_ORIGIN}/`;
        await new Promise<void>((resolve) => {
          iframe!.addEventListener("load", () => resolve(), { once: true });
        });
      }
      if (port) {
        port.onmessage = null;
        port.close();
      }
      const channel = new MessageChannel();
      port = channel.port1;
      port.onmessage = (event: MessageEvent) => handle(event.data);
      state.ready = false;
      iframe.contentWindow?.postMessage(
        {
          version: 1,
          runtimeInstanceId: crypto.randomUUID(),
          messageId: crypto.randomUUID(),
          sentAt: Date.now(),
          type: "runtime.bootstrap",
          gameId: game.gameId,
          ...(game.gameTitle !== undefined ? { gameTitle: game.gameTitle } : {}),
          gameMode: game.gameMode,
          gameSource: game.gameSource,
          player: {
            memberId: game.memberId ?? "member-1",
            displayName: game.displayName ?? "Alex",
          },
        },
        RUNTIME_ORIGIN,
        [channel.port2],
      );
      await waitForReady(15_000);
    }

    function reload(): void {
      port?.postMessage({
        version: 1,
        runtimeInstanceId: "runtime",
        messageId: crypto.randomUUID(),
        sentAt: Date.now(),
        type: "runtime.reload",
      });
    }

    function destroy(reason = "user_exit"): void {
      port?.postMessage({
        version: 1,
        runtimeInstanceId: "runtime",
        messageId: crypto.randomUUID(),
        sentAt: Date.now(),
        type: "game.end",
        reason,
      });
    }

    function ping(): void {
      port?.postMessage({
        version: 1,
        runtimeInstanceId: "runtime",
        messageId: crypto.randomUUID(),
        sentAt: Date.now(),
        type: "runtime.ping",
      });
    }

    (window as unknown as { __harness: unknown }).__harness = {
      events,
      state,
      bootstrap,
      reload,
      destroy,
      ping,
      getEvents: () => events,
      clearEvents: () => events.splice(0, events.length),
      getState: () => ({ ...state }),
    };
  });
}

/** The runtime-origin frame embedded inside the harness, if present. */
export function findRuntimeFrame(page: Page): Frame | undefined {
  return page.frames().find((frame) => frame.url().startsWith(RUNTIME_ORIGIN));
}

/** Send a game to the runtime and wait for the runtime to be ready. */
export async function loadGame(
  page: Page,
  game: Omit<GameInput, "memberId" | "displayName">,
): Promise<void> {
  await page.evaluate(
    (g) =>
      (
        window as unknown as { __harness: { bootstrap(g: GameInput): Promise<void> } }
      ).__harness.bootstrap(g),
    { ...game, memberId: "member-1", displayName: "Alex" },
  );
}

/** Events the host harness observed from the runtime. */
export async function harnessEvents(page: Page): Promise<Array<Record<string, unknown>>> {
  return page.evaluate(() =>
    (
      window as unknown as { __harness: { getEvents(): Array<Record<string, unknown>> } }
    ).__harness.getEvents(),
  );
}

export async function clearHarnessEvents(page: Page): Promise<void> {
  await page.evaluate(() =>
    (window as unknown as { __harness: { clearEvents(): void } }).__harness.clearEvents(),
  );
}

/** Snapshot of observable state from inside the game frame (same-origin). */
export async function gameState(page: Page): Promise<Record<string, unknown> | null> {
  const runtime = findRuntimeFrame(page);
  if (!runtime) return null;
  return runtime.evaluate(() => {
    const api = (window as unknown as { __runtimeApi?: { getGameWindow(): Window | null } })
      .__runtimeApi;
    const game = api?.getGameWindow?.();
    if (!game) return null;
    return {
      inlineClassic: (game as unknown as Record<string, unknown>).__inlineClassic ?? null,
      moduleRan: (game as unknown as Record<string, unknown>).__moduleRan ?? null,
      registered: (game as unknown as Record<string, unknown>).__registered ?? null,
      novaVersion: (game as unknown as Record<string, unknown>).__novaVersion ?? null,
      bootCount: (game as unknown as Record<string, unknown>).__bootCount ?? null,
      remoteDep: (game as unknown as Record<string, unknown>).__remoteDep ?? null,
      malicious: (game as unknown as Record<string, unknown>).__malicious ?? null,
      bridgeVersion: (game as unknown as Record<string, unknown>).__novaGameBridge?.version ?? null,
    };
  });
}

/** Runtime-page internals (active instances, outgoing messages, frame count). */
export async function runtimeInternals(page: Page): Promise<Record<string, unknown>> {
  const runtime = findRuntimeFrame(page);
  if (!runtime) {
    throw new Error("runtime frame not found");
  }
  return runtime.evaluate(() => {
    const api = (
      window as unknown as {
        __runtimeApi: {
          hasFrame(): boolean;
          activeInstanceCount(): number;
          outgoingMessages(): Array<{ type: string }>;
          mainOrigin: string;
        };
      }
    ).__runtimeApi;
    return {
      hasFrame: api.hasFrame(),
      activeInstanceCount: api.activeInstanceCount(),
      outgoingTypes: api.outgoingMessages().map((m) => m.type),
      mainOrigin: api.mainOrigin,
    };
  });
}

/** Assertions shared across runtime specs. */
export async function expectRuntimeReady(page: Page): Promise<void> {
  await expect
    .poll(() =>
      harnessEvents(page).then((events) => events.some((e) => e.type === "runtime.ready")),
    )
    .toBe(true);
}
