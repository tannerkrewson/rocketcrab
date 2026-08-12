/**
 * Runtime origin application (apps/runtime) — the isolated execution origin
 * for game HTML (ADR-0001, ADR-0008; F4 spike shape industrialized by U3).
 *
 * Responsibilities:
 * - accept exactly one bootstrap: a `runtime.bootstrap` message over
 *   postMessage from the exact main origin, transferring a dedicated
 *   MessageChannel (one per runtime instance);
 * - run the game inside a same-origin sandboxed iframe with the injected
 *   Nova API bridge prepended (never sanitizing or rewriting game HTML);
 * - forward validated errors, console entries, lifecycle events, and game
 *   registrations back over the channel;
 * - answer heartbeats and honor parent-controlled reload / destroy;
 * - report page-visibility transitions (pause diagnostic for Mobile Safari
 *   backgrounding, ADR-0012/B6).
 *
 * This page is secret-free by construction: no Nova credentials, no saved
 * game source, no party secrets (ADR-0008, threat model).
 */
import { parseRuntimeMessage } from "@rocketcrab/protocol";
import { mainOriginForRuntimeOrigin } from "./origins";
import { RuntimeInstance, type FrameFactory } from "./runtime-instance";

const MAIN_ORIGIN = mainOriginForRuntimeOrigin(location.origin);

const containerEl = document.getElementById("game-container");
const barEl = document.getElementById("bar");
if (!containerEl || !barEl) {
  throw new Error("runtime page is missing #game-container or #bar");
}
// Narrowed locals: the closures below must not see possibly-null captures.
const container: HTMLElement = containerEl;
const bar: HTMLElement = barEl;

let activeInstance: RuntimeInstance | null = null;

/** Creates the same-origin sandboxed game frame (F4 spike injection shape). */
function createFrameFactory(): FrameFactory {
  return {
    create(source: string, allowTokens: readonly string[]) {
      const frame = document.createElement("iframe");
      // allow-scripts + allow-same-origin keeps the game on the shared
      // runtime origin (remote ESM/CDN/fetch/canvas/audio keep working).
      // No allow-top-navigation: the game must not navigate the Nova tab.
      frame.setAttribute(
        "sandbox",
        "allow-scripts allow-same-origin allow-pointer-lock allow-fullscreen",
      );
      // Permission delegation must be carried at every iframe hop (F4
      // finding): base set + whatever the host delegated in the bootstrap.
      const allow = new Set([
        "camera",
        "microphone",
        "clipboard-read",
        "clipboard-write",
        "fullscreen",
        ...allowTokens,
      ]);
      frame.setAttribute("allow", [...allow].join("; "));
      frame.allowFullscreen = true;
      frame.setAttribute("title", "game sandbox");
      frame.src = "about:blank";
      container.replaceChildren(frame);
      const doc = frame.contentDocument;
      if (doc) {
        doc.open();
        doc.write(source);
        doc.close();
      }
      return {
        window: frame.contentWindow,
        destroy() {
          frame.remove();
        },
      };
    },
  };
}

function handleBootstrap(event: MessageEvent): void {
  if (event.origin !== MAIN_ORIGIN) {
    console.warn(`[runtime] rejected bootstrap from origin ${event.origin}`);
    return;
  }
  const parsed = parseRuntimeMessage(event.data);
  if (!parsed.ok || parsed.value.type !== "runtime.bootstrap") {
    console.warn(
      "[runtime] rejected malformed bootstrap",
      parsed.ok ? parsed.value.type : parsed.error.message,
    );
    return;
  }
  const port = event.ports?.[0];
  if (!port) {
    console.warn("[runtime] bootstrap without a MessagePort");
    return;
  }
  // A fresh bootstrap starts a fresh instance with a fresh channel: tear the
  // previous instance down (old port is closed) before taking the new one.
  activeInstance?.destroy();
  activeInstance = new RuntimeInstance({
    runtimeInstanceId: parsed.value.runtimeInstanceId,
    bootstrap: parsed.value,
    port,
    frameFactory: createFrameFactory(),
  });
  bar.textContent = "runtime origin — bootstrapped by Nova";
}

// Exact-origin bootstrap handshake: only a page on MAIN_ORIGIN may start a
// session, and only with a versioned runtime.bootstrap message.
window.addEventListener("message", handleBootstrap);

// Pause diagnostic: report visibility transitions so the shell can react to
// Mobile Safari backgrounding (ADR-0012, B6). Page-level listeners are
// installed once and outlive instances.
document.addEventListener("visibilitychange", () => {
  activeInstance?.pageVisibilityChanged(document.hidden);
});
window.addEventListener("pagehide", () => {
  activeInstance?.pageVisibilityChanged(true);
});
window.addEventListener("pageshow", () => {
  activeInstance?.pageVisibilityChanged(false);
});

// Observability hook for tests (same-origin only).
(window as unknown as { __runtimeApi: RuntimeTestApi }).__runtimeApi = {
  getGameWindow: () => activeInstance?.getGameWindow() ?? null,
  hasFrame: () => activeInstance?.hasFrame() ?? false,
  activeInstanceCount: () => (activeInstance !== null && !activeInstance.isDestroyed() ? 1 : 0),
  outgoingMessages: () => activeInstance?.outgoingMessages() ?? [],
  mainOrigin: MAIN_ORIGIN,
};

interface RuntimeTestApi {
  getGameWindow: () => Window | null;
  hasFrame: () => boolean;
  activeInstanceCount: () => number;
  outgoingMessages: () => readonly unknown[];
  mainOrigin: string;
}
