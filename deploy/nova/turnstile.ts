/**
 * Turnstile gate for routes a script must not drive in bulk: TURN minting and
 * party-code lookups. Each route checks its own widget action, so a token
 * minted for one can't be spent on the other.
 */
import { jsonError } from "./http";

export interface TurnstileEnv {
  TURNSTILE_SECRET_KEY?: string;
  /** "true" fails closed when the secret is missing (production). */
  TURNSTILE_REQUIRED?: string;
}

async function verify(request: Request, secret: string, action: string): Promise<boolean> {
  const token = request.headers.get("X-Turnstile-Token");
  if (!token || token.length > 2048) return false;
  try {
    const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret, response: token }),
      signal: AbortSignal.timeout(3_000),
    });
    if (!response.ok) {
      console.error({ event: "turnstile_upstream_error", status: response.status });
      return false;
    }
    const result = (await response.json()) as {
      success?: boolean;
      hostname?: string;
      action?: string;
    } | null;
    return (
      result?.success === true &&
      result.hostname === new URL(request.url).hostname &&
      result.action === action
    );
  } catch {
    console.error({ event: "turnstile_upstream_unavailable" });
    return false;
  }
}

/** Null when the request may proceed, else the error response to send. */
export async function checkTurnstile(
  request: Request,
  env: TurnstileEnv,
  action: string,
): Promise<Response | null> {
  const secret = env.TURNSTILE_SECRET_KEY?.trim();
  if (!secret) {
    if (env.TURNSTILE_REQUIRED !== "true") return null;
    console.error({ event: "turnstile_secret_missing" });
    return jsonError(500, "worker_misconfigured", "verification is not configured");
  }
  return (await verify(request, secret, action))
    ? null
    : jsonError(403, "verification_failed", "verification failed");
}
