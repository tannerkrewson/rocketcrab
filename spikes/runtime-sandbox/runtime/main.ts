// Runtime origin application (origin B) for the F4 spike.
//
// Receives game HTML from the host over a dedicated MessageChannel, runs the
// game inside a same-origin sandboxed iframe ON THE RUNTIME ORIGIN, forwards
// errors to the host, and supports load / reload / destroy.
//
// SPIKE scope notes:
// - The game iframe is same-origin with this runtime page. That is the
//   documented shared-runtime-origin model (ADR-0008 / B5): the isolation
//   that matters is between the game and the NOVA app (cross-origin), not
//   between games on the shared runtime origin. This page must never hold
//   Nova secrets.
// - The bootstrap validates the SENDER's exact origin and a versioned schema.
// - A tiny bootstrap script is prepended to capture early errors; U3 will
//   formalize this with versioned schemas (F6).

const HOST_PORT = 5273;
const HOST_ORIGIN = location.origin.replace(/:\d+$/, `:${HOST_PORT}`);
const PROTOCOL_VERSION = 1;

let port: MessagePort | null = null;
let gameFrame: HTMLIFrameElement | null = null;
let currentHtml = "";

const container = document.getElementById("game-container") as HTMLElement;
const bar = document.getElementById("bar") as HTMLElement;

function post(msg: unknown): void {
  if (port) {
    try {
      port.postMessage(msg);
    } catch {
      // port closed — host is gone
    }
  }
}

function forwardError(err: { message: string; filename?: string; lineno?: number }): void {
  post({ type: "nova:error", version: PROTOCOL_VERSION, error: err });
}

// Injected bootstrap: captures load-time errors before any game code runs.
const INJECTED_BOOTSTRAP =
  "<script>" +
  "window.__novaBridge={errors:[]};" +
  "addEventListener('error',function(e){try{window.__novaBridge.errors.push(String(e.message||e.error));}catch(_){}});" +
  "addEventListener('unhandledrejection',function(e){try{window.__novaBridge.errors.push('unhandledrejection:'+String((e.reason&&e.reason.message)||e.reason));}catch(_){}});" +
  "</script>";

function createGameFrame(html: string): void {
  destroyGameFrame();
  const frame = document.createElement("iframe");
  // allow-scripts + allow-same-origin keeps the game on the shared runtime
  // origin (remote ESM/CDN/fetch/canvas/audio all keep working). No
  // allow-top-navigation: the game must not be able to navigate the top
  // Nova tab.
  frame.setAttribute(
    "sandbox",
    "allow-scripts allow-same-origin allow-pointer-lock allow-fullscreen",
  );
  // Delegate camera/mic/clipboard/fullscreen permission to the game frame
  // (production will do this via the runtime origin's Permissions-Policy /
  // allow attributes on both iframes).
  frame.setAttribute("allow", "camera; microphone; clipboard-read; clipboard-write; fullscreen");
  frame.allowFullscreen = true;
  frame.setAttribute("title", "game sandbox");
  frame.src = "about:blank";
  container.replaceChildren(frame);
  gameFrame = frame;
  const doc = frame.contentDocument;
  if (!doc) return;
  doc.open();
  doc.write(INJECTED_BOOTSTRAP + html);
  doc.close();
  const win = frame.contentWindow;
  if (win) {
    // Forward async errors (same-origin child) to the host.
    win.addEventListener("error", (e) => {
      forwardError({
        message: String(e.message ?? e.error),
        filename: e.filename,
        lineno: e.lineno,
      });
    });
    win.addEventListener("unhandledrejection", (e) => {
      forwardError({
        message: `Unhandled rejection: ${String((e.reason as Error | undefined)?.message ?? e.reason)}`,
      });
    });
  }
}

function destroyGameFrame(): void {
  if (gameFrame) {
    gameFrame.remove();
    gameFrame = null;
  }
  container.replaceChildren();
}

function handlePortMessage(ev: MessageEvent): void {
  const msg = ev.data as { type?: string; version?: number; [k: string]: unknown };
  if (!msg || typeof msg !== "object") return;
  if (msg.version !== PROTOCOL_VERSION) {
    post({
      type: "nova:error",
      version: PROTOCOL_VERSION,
      error: { message: `unsupported protocol version: ${String(msg.version)}` },
    });
    return;
  }
  switch (msg.type) {
    case "nova:ping":
      post({ type: "nova:pong", version: PROTOCOL_VERSION });
      break;
    case "nova:load-game": {
      const html = typeof msg.html === "string" ? msg.html : null;
      if (html === null) {
        post({
          type: "nova:error",
          version: PROTOCOL_VERSION,
          error: { message: "load-game missing html" },
        });
        return;
      }
      currentHtml = html;
      createGameFrame(html);
      post({ type: "nova:loaded", version: PROTOCOL_VERSION });
      break;
    }
    case "nova:reload":
      if (currentHtml) createGameFrame(currentHtml);
      post({ type: "nova:loaded", version: PROTOCOL_VERSION });
      break;
    case "nova:destroy":
      destroyGameFrame();
      post({ type: "nova:destroyed", version: PROTOCOL_VERSION });
      break;
    default:
      post({
        type: "nova:error",
        version: PROTOCOL_VERSION,
        error: { message: `unknown message type: ${String(msg.type)}` },
      });
  }
}

// Exact-origin bootstrap over postMessage. Only a page on HOST_ORIGIN may
// start a session, and only with the versioned bootstrap shape.
window.addEventListener("message", (ev: MessageEvent) => {
  if (ev.origin !== HOST_ORIGIN) {
    console.warn(`[runtime] rejected message from origin ${ev.origin}`);
    return;
  }
  const data = ev.data as { type?: string; version?: number } | undefined;
  if (
    !data ||
    typeof data !== "object" ||
    data.type !== "nova:bootstrap" ||
    data.version !== PROTOCOL_VERSION
  ) {
    console.warn("[runtime] rejected malformed bootstrap", data);
    return;
  }
  const receivedPort = ev.ports?.[0];
  if (!receivedPort) {
    console.warn("[runtime] bootstrap without a MessagePort");
    return;
  }
  bar.textContent = "runtime origin — bootstrapped by host";
  port = receivedPort;
  port.onmessage = handlePortMessage;
  post({ type: "nova:ready", version: PROTOCOL_VERSION });
});

// Test/observability hook: expose the game window (same-origin only).
(
  window as unknown as {
    __runtimeApi: { getGame: () => Window | null; containerChildren: () => number };
  }
).__runtimeApi = {
  getGame: () => gameFrame?.contentWindow ?? null,
  containerChildren: () => container.childElementCount,
};
