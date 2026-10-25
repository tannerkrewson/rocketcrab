/**
 * Cloudflare Workers Rate Limiting binding helper.
 *
 * The platform binding is approximate and per-location, but it survives
 * isolate restarts and is shared by all instances in a location — strictly
 * better than the in-memory fallback used for local dev and tests. The
 * binding does not replace a global daily cap; Nova deliberately has none
 * (see deploy/turn-creds/README.md).
 */
export interface RateLimitBinding {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

/**
 * Ask the binding for a decision. Returns null when the binding is absent
 * (local dev/tests) or fails, so callers can fall back to their in-memory
 * limiter without ever failing a join on a rate-limiter outage.
 */
export async function limitWithBinding(
  binding: RateLimitBinding | undefined,
  key: string,
): Promise<boolean | null> {
  if (binding === undefined) return null;
  try {
    return (await binding.limit({ key })).success;
  } catch (error) {
    console.log(`edge: rate-limit binding failed, using in-memory fallback: ${String(error)}`);
    return null;
  }
}
