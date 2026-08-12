// Host application (origin A) for the F4 runtime-sandbox spike.
//
// NOTE: the fixtures are embedded at build time via Vite `?raw` imports
// instead of being fetched — the host dev server does not serve
// /fixtures/* (Vite's SPA fallback would return index.html for those URLs).
//
// Responsibilities (spike scope; U3/F6 formalize the real protocol):
// - embed the runtime iframe on a DIFFERENT origin (port 5274)
// - bootstrap over postMessage with an exact-origin targetOrigin, handing a
//   dedicated MessageChannel to the runtime
// - load/reload/destroy games over that channel
// - keep a heartbeat so a wedged runtime is visible
// - keep an Emergency Stop control OUTSIDE the frame at all times
//
// Origins are derived from location so the same code works on localhost and
// on a LAN IP (physical iPhone testing): the runtime origin is this origin
// with the port swapped to 5274.

const RUNTIME_PORT = 5274;
const RUNTIME_ORIGIN = location.origin.replace(/:\d+$/, `:${RUNTIME_PORT}`);
const PROTOCOL_VERSION = 1;

interface ChannelMsg {
  type: string;
  version: number;
  [k: string]: unknown;
}

const iframe = document.getElementById("runtime-frame") as HTMLIFrameElement;
const statusEl = document.getElementById("status") as HTMLElement;
const logEl = document.getElementById("log") as HTMLElement;
const emergencyStopBtn = document.getElementById("emergency-stop") as HTMLButtonElement;
const reloadBtn = document.getElementById("reload") as HTMLButtonElement;
const restartBtn = document.getElementById("restart") as HTMLButtonElement;
const loadHelloBtn = document.getElementById("load-hello") as HTMLButtonElement;
const loadInfiniteBtn = document.getElementById("load-infinite") as HTMLButtonElement;
const loadMaliciousBtn = document.getElementById("load-malicious") as HTMLButtonElement;

let port: MessagePort | null = null;
let ready = false;
let missedPongs = 0;
let heartbeatTimer: number | undefined;

function log(msg: string): void {
  const line = `[${new Date().toISOString().slice(11, 19)}] ${msg}`;
  logEl.textContent = `${logEl.textContent}\n${line}`.trim();
  logEl.scrollTop = logEl.scrollHeight;
}

function setStatus(text: string): void {
  statusEl.textContent = text;
}

function send(msg: ChannelMsg): void {
  if (port) {
    try {
      port.postMessage(msg);
    } catch (e) {
      log(`send failed: ${String(e)}`);
    }
  }
}

function handleMessage(data: unknown): void {
  if (!data || typeof data !== "object") return;
  const msg = data as ChannelMsg;
  if (msg.version !== PROTOCOL_VERSION) {
    log(`rejected message with unknown version: ${String(msg.version)}`);
    return;
  }
  switch (msg.type) {
    case "nova:ready":
      ready = true;
      setStatus("runtime: ready");
      startHeartbeat();
      break;
    case "nova:pong":
      missedPongs = 0;
      break;
    case "nova:error":
      log(`RUNTIME ERROR: ${JSON.stringify(msg.error ?? {})}`);
      break;
    case "nova:loaded":
      log("game loaded");
      break;
    case "nova:destroyed":
      log("runtime destroyed (cooperative)");
      break;
    default:
      log(`unexpected message type: ${String(msg.type)}`);
  }
}

function startHeartbeat(): void {
  stopHeartbeat();
  missedPongs = 0;
  heartbeatTimer = window.setInterval(() => {
    if (!port || !ready) return;
    missedPongs += 1;
    send({ type: "nova:ping", version: PROTOCOL_VERSION });
    if (missedPongs >= 3) {
      setStatus("runtime: UNRESPONSIVE");
    }
  }, 1000);
}

function stopHeartbeat(): void {
  if (heartbeatTimer !== undefined) {
    window.clearInterval(heartbeatTimer);
    heartbeatTimer = undefined;
  }
}

/** Set up the runtime iframe and perform the exact-origin bootstrap. */
function init(): Promise<void> {
  if (ready) return Promise.resolve();
  return new Promise((resolve, reject) => {
    iframe.onload = () => {
      try {
        const channel = new MessageChannel();
        port = channel.port1;
        port.onmessage = (ev: MessageEvent) => handleMessage(ev.data);
        iframe.contentWindow!.postMessage(
          { type: "nova:bootstrap", version: PROTOCOL_VERSION },
          RUNTIME_ORIGIN,
          [channel.port2],
        );
        resolve();
      } catch (e) {
        reject(e);
      }
    };
    iframe.src = `${RUNTIME_ORIGIN}/`;
  });
}

/** Hard teardown: nuke the frame regardless of runtime cooperation. */
function destroy(): void {
  iframe.onload = null;
  iframe.removeAttribute("src");
  iframe.src = "about:blank";
  port = null;
  ready = false;
  stopHeartbeat();
  setStatus("runtime: destroyed (hard)");
}

/** Hard teardown then a fresh bootstrap (recovery path). */
async function restart(): Promise<void> {
  destroy();
  await init();
}

// Full capability probe (rows 1-11 of the physical-device checklist) and
// the CPU-exhaustion fixture (row 15), embedded so the phone UI can load
// them (iPhone Safari has no JS console).
import helloProbeHtml from "../fixtures/hello.html?raw";
import infiniteHtml from "../fixtures/infinite.html?raw";

const DEMO_MALICIOUS = `<!doctype html>
<html lang="en">
<body>
<script>
  const out = {}
  try { out.topNav = (window.top.location.href = 'https://evil.example/') } catch (e) { out.topNav = 'blocked:' + e.name }
  try { window.top.document.getElementById('emergency-stop').remove(); out.disableStop = 'removed' } catch (e) { out.disableStop = 'blocked:' + e.name }
  window.__demoMalicious = out
</script>
</body>
</html>`;

const hostApi = {
  init,
  load(html: string): void {
    send({ type: "nova:load-game", version: PROTOCOL_VERSION, html });
  },
  reload(): void {
    send({ type: "nova:reload", version: PROTOCOL_VERSION });
  },
  destroy,
  restart,
  ping(): void {
    send({ type: "nova:ping", version: PROTOCOL_VERSION });
  },
  /** Send a raw (possibly malformed) message over the channel — tests only. */
  rawSend(msg: unknown): void {
    if (port) port.postMessage(msg as Transferable);
  },
  setSecret(v: string): void {
    localStorage.setItem("nova_secret", v);
  },
  getStatus() {
    return {
      ready,
      missedPongs,
      href: location.href,
      runtimeOrigin: RUNTIME_ORIGIN,
      secret: localStorage.getItem("nova_secret"),
    };
  },
  getLogs(): string {
    return logEl.textContent ?? "";
  },
};
(window as unknown as { __host: typeof hostApi }).__host = hostApi;

emergencyStopBtn.addEventListener("click", () => {
  destroy();
  log("emergency stop pressed (button lives OUTSIDE the frame)");
});
reloadBtn.addEventListener("click", () => hostApi.reload());
restartBtn.addEventListener("click", () => void hostApi.restart());
loadHelloBtn.addEventListener("click", () => {
  hostApi.load(helloProbeHtml);
  log("loaded hello.html capability probe");
});
// Physical-device pass needs the CPU-exhaustion fixture loadable from the
// phone UI (no JS console on iPhone Safari).
loadInfiniteBtn.addEventListener("click", () => {
  hostApi.load(infiniteHtml);
  log("loaded infinite.html (wedges after ~4s)");
});
loadMaliciousBtn.addEventListener("click", () => hostApi.load(DEMO_MALICIOUS));

log(`runtime origin: ${RUNTIME_ORIGIN}`);
void init();
