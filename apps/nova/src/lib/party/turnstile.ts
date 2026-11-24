const SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY?.trim();
const SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
const TIMEOUT_MS = 2_500;
const TOKEN_MAX_AGE_MS = 4 * 60 * 1000;

interface Turnstile {
  render(
    container: HTMLElement,
    options: {
      sitekey: string;
      action: string;
      "response-field": false;
      retry: "never";
      callback(token: string): void;
      "error-callback"(): void;
      "expired-callback"(): void;
    },
  ): string;
  remove(widgetId: string): void;
}

function api(): Turnstile | undefined {
  return (window as Window & { turnstile?: Turnstile }).turnstile;
}

interface Challenge {
  startedAt: number;
  token: Promise<string | null>;
}

let pending: Challenge | undefined;

function startChallenge(sitekey: string): Promise<string | null> {
  return new Promise((resolve) => {
    let script: HTMLScriptElement | undefined;
    let widget: string | undefined;
    const container = document.createElement("div");
    let done = false;
    const finish = (token: string | null): void => {
      if (done) return;
      done = true;
      window.clearTimeout(timer);
      script?.remove();
      if (widget !== undefined) {
        try {
          api()?.remove(widget);
        } catch {
          // The container still gets removed if the widget was already gone.
        }
      }
      container.remove();
      resolve(token);
    };
    const timer = window.setTimeout(() => finish(null), TIMEOUT_MS);
    const render = (): void => {
      if (done) return;
      try {
        document.body.append(container);
        widget = api()?.render(container, {
          sitekey,
          action: "mint_turn",
          "response-field": false,
          retry: "never",
          callback: (token) => finish(token),
          "error-callback": () => finish(null),
          "expired-callback": () => finish(null),
        });
        if (!widget) finish(null);
      } catch {
        finish(null);
      }
    };
    if (api()) {
      render();
    } else {
      script = document.createElement("script");
      script.src = SCRIPT_URL;
      script.async = true;
      script.onload = render;
      script.onerror = () => finish(null);
      document.head.append(script);
    }
  });
}

/** Start the invisible challenge while the player enters their name or joins. */
export function primeTurnChallenge(): void {
  if (!SITE_KEY || (pending && Date.now() - pending.startedAt < TOKEN_MAX_AGE_MS)) return;
  pending = { startedAt: Date.now(), token: startChallenge(SITE_KEY) };
}

export async function consumeTurnToken(): Promise<string | null> {
  primeTurnChallenge();
  const challenge = pending;
  if (!challenge) return null;
  const token = await challenge.token;
  // Concurrent callers must never submit the same single-use token twice.
  if (pending !== challenge) return null;
  pending = undefined;
  return token;
}
