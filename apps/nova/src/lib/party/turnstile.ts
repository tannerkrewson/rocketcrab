/**
 * Invisible Turnstile challenges. Each action gets its own single-use token:
 * `mint_turn` for `/api/turn` (optional: a party falls back to direct WebRTC
 * or the tunnel without it) and `code_lookup` for `/api/code/lookup`
 * (required: without it a four-letter code can't be resolved).
 */
const SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY?.trim();
const SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
const TOKEN_MAX_AGE_MS = 4 * 60 * 1000;

export type ChallengeAction = "mint_turn" | "code_lookup";

/** Give up on a challenge after this long: TURN has fallbacks, a code lookup doesn't. */
const TIMEOUT_MS: Record<ChallengeAction, number> = { mint_turn: 2_500, code_lookup: 10_000 };

/** True when this build verifies requests; without it the Worker doesn't either. */
export const turnstileEnabled = !!SITE_KEY;

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

let loading: Promise<Turnstile | undefined> | undefined;

/** Load the script once for every challenge; a failed load is retried next time. */
function loadApi(): Promise<Turnstile | undefined> {
  if (api()) return Promise.resolve(api());
  loading ??= new Promise((resolve) => {
    const script = document.createElement("script");
    script.src = SCRIPT_URL;
    script.async = true;
    script.onload = () => resolve(api());
    script.onerror = () => {
      script.remove();
      loading = undefined;
      resolve(undefined);
    };
    document.head.append(script);
  });
  return loading;
}

interface Challenge {
  startedAt: number;
  token: Promise<string | null>;
}

const pending = new Map<ChallengeAction, Challenge>();

function startChallenge(sitekey: string, action: ChallengeAction): Promise<string | null> {
  return new Promise((resolve) => {
    let widget: string | undefined;
    const container = document.createElement("div");
    let done = false;
    const finish = (token: string | null): void => {
      if (done) return;
      done = true;
      window.clearTimeout(timer);
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
    const timer = window.setTimeout(() => finish(null), TIMEOUT_MS[action]);
    void loadApi().then((turnstile) => {
      if (done) return;
      if (!turnstile) return finish(null);
      try {
        document.body.append(container);
        widget = turnstile.render(container, {
          sitekey,
          action,
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
    });
  });
}

/** Start a challenge early, e.g. while the player enters their name or joins. */
export function primeChallenge(action: ChallengeAction): void {
  const challenge = pending.get(action);
  if (!SITE_KEY || (challenge && Date.now() - challenge.startedAt < TOKEN_MAX_AGE_MS)) return;
  pending.set(action, { startedAt: Date.now(), token: startChallenge(SITE_KEY, action) });
}

/** A fresh token for one request, or null when the challenge failed or is off. */
export async function consumeChallengeToken(action: ChallengeAction): Promise<string | null> {
  primeChallenge(action);
  const challenge = pending.get(action);
  if (!challenge) return null;
  const token = await challenge.token;
  // Concurrent callers must never submit the same single-use token twice.
  if (pending.get(action) !== challenge) return null;
  pending.delete(action);
  return token;
}
