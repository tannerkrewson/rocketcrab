/**
 * Secret-free game execution origin (ADR-0001, ADR-0008). Accept bootstrap
 * only from the embedding main-origin page and use its dedicated channel,
 * and run HTML in a same-origin sandboxed frame with the Nova bridge.
 * Forward validated reports and honor parent-controlled reload/destroy.
 * Visibility events support Mobile Safari recovery (ADR-0012).
 */
import { parseRuntimeMessage } from "@rocketcrab/protocol";
import { mainOriginForRuntimeOrigin } from "./origins";
import { RuntimeInstance, type FrameFactory } from "./runtime-instance";

const MAIN_ORIGIN = mainOriginForRuntimeOrigin(location.origin);

// Remove leftover service workers so they cannot retain network control
// over game traffic; the runtime must not register its own (ADR-0008).
if ("serviceWorker" in navigator) {
  void navigator.serviceWorker.getRegistrations().then((registrations) => {
    for (const registration of registrations) {
      void registration.unregister();
    }
  });
}

const containerEl = document.getElementById("game-container");
if (!containerEl) {
  throw new Error("runtime page is missing #game-container");
}
// Narrowed local: the closures below must not see a possibly-null capture.
const container: HTMLElement = containerEl;

let activeInstance: RuntimeInstance | null = null;

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
      // Permissions must be delegated at every iframe hop: use the base set
      // plus whatever the host delegated in the bootstrap.
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
  // The embedding page is the only window that may start a session; another
  // window on the main origin is not the host and must not take the channel.
  if (event.source !== window.parent) {
    console.warn("[runtime] rejected bootstrap from a window other than the embedding page");
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
  activeInstance?.destroy();
  activeInstance = new RuntimeInstance({
    runtimeInstanceId: parsed.value.runtimeInstanceId,
    bootstrap: parsed.value,
    port,
    frameFactory: createFrameFactory(),
  });
}

window.addEventListener("message", handleBootstrap);

// Page-level visibility listeners outlive instances and support Safari recovery (ADR-0012).
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
