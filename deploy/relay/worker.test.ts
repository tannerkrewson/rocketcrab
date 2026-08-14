import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_ORIGIN_ALLOWLIST,
  DEFAULT_RATE_LIMIT_PER_MIN,
  RATE_LIMIT_WINDOW_MS,
  RateLimiter,
  clientIp,
  corsHeaders,
  handleRelayRequest,
  normalizeOrigin,
  originAllowed,
  parseAllowlist,
  parseRateLimit,
  resetRateLimiter,
  type RelayEnv,
} from "./worker";

/**
 * Scoped CORS relay worker tests (rocketcrab-9fv.7.7.5 + hardening
 * rocketcrab-9fv.3.5). The worker (deploy/relay/worker.ts) forwards
 * classic room-creation requests to the allowlisted endpoints and returns
 * the upstream JSON with CORS headers echoing the allowlisted origin.
 * Hardening: origin allowlist (403 before forwarding) + per-IP rate
 * limiting (429 + Retry-After), mirroring deploy/turn-creds/worker.ts.
 */

const ALLOWED_ORIGIN = "https://rocketcrab.com";

function makeEnv(overrides: Partial<RelayEnv> = {}): RelayEnv {
  return {
    ORIGIN_ALLOWLIST: ALLOWED_ORIGIN,
    RATE_LIMIT_PER_MIN: "1000",
    ...overrides,
  };
}

/** Build a relay request with an optional Origin header. */
function relayRequest(origin: string | null, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  if (origin !== null) headers.set("Origin", origin);
  return new Request("https://relay.example.net/", {
    ...init,
    method: init.method ?? "POST",
    headers,
  });
}

/** Capture the error object from a structured { error: { code, message } } body. */
async function errorBody(res: Response): Promise<{ code?: string; message?: string }> {
  const data = (await res.json()) as { error?: { code?: string; message?: string } };
  return data.error ?? {};
}

/** True when the upstream fetch was called at least once. */
function upstreamCalled(fetchMock: ReturnType<typeof vi.fn>): boolean {
  return fetchMock.mock.calls.length > 0;
}

describe("parseAllowlist", () => {
  it("defaults to the production origin plus localhost dev origins when unset", () => {
    expect(parseAllowlist(undefined)).toEqual(DEFAULT_ORIGIN_ALLOWLIST);
  });

  it("parses a comma-separated env override, ignoring empties and whitespace", () => {
    expect(parseAllowlist("https://a.example, ,https://b.example,")).toEqual([
      "https://a.example",
      "https://b.example",
    ]);
  });

  it("normalizes config entries (trailing slash, host casing) via URL parsing", () => {
    expect(parseAllowlist("https://Rocketcrab.COM/, https://dev.example:8443/")).toEqual([
      "https://rocketcrab.com",
      "https://dev.example:8443",
    ]);
  });

  it("keeps the trimmed value when an entry is not a parseable URL", () => {
    expect(parseAllowlist("not-a-url")).toEqual(["not-a-url"]);
  });
});

describe("normalizeOrigin / originAllowed / corsHeaders", () => {
  it("returns null for a missing or empty Origin", () => {
    expect(normalizeOrigin(null)).toBeNull();
    expect(normalizeOrigin("  ")).toBeNull();
  });

  it("trims whitespace and tolerates a trailing slash", () => {
    expect(normalizeOrigin(" https://rocketcrab.com/ ")).toBe("https://rocketcrab.com");
  });

  it("matches exact allowlist members only", () => {
    const list = parseAllowlist("https://rocketcrab.com");
    expect(originAllowed("https://rocketcrab.com", list)).toBe(true);
    expect(originAllowed("https://rocketcrab.com.evil.example", list)).toBe(false);
    expect(originAllowed("https://evil-rocketcrab.com", list)).toBe(false);
    expect(originAllowed("http://rocketcrab.com", list)).toBe(false);
  });

  it("echoes the allowlisted origin with Vary: Origin, never a wildcard", () => {
    const headers = corsHeaders(ALLOWED_ORIGIN);
    expect(headers["Access-Control-Allow-Origin"]).toBe(ALLOWED_ORIGIN);
    expect(headers["Access-Control-Allow-Origin"]).not.toBe("*");
    expect(headers["Access-Control-Allow-Methods"]).toBe("POST, OPTIONS");
    expect(headers["Access-Control-Allow-Headers"]).toBe("Content-Type");
    expect(headers["Vary"]).toBe("Origin");
  });
});

describe("parseRateLimit / clientIp / RateLimiter", () => {
  it("defaults RATE_LIMIT_PER_MIN to 20 and parses positive integers", () => {
    expect(DEFAULT_RATE_LIMIT_PER_MIN).toBe(20);
    expect(parseRateLimit(undefined)).toBe(20);
    expect(parseRateLimit("25")).toBe(25);
    expect(parseRateLimit("  3 ")).toBe(3);
  });

  it("falls back to the default for invalid or non-positive values", () => {
    expect(parseRateLimit("abc")).toBe(20);
    expect(parseRateLimit("")).toBe(20);
    expect(parseRateLimit("0")).toBe(20);
    expect(parseRateLimit("-5")).toBe(20);
  });

  it("reads the client IP from CF-Connecting-IP (edge-set, not spoofable)", () => {
    const req = new Request("https://relay.example.net/", {
      headers: { "CF-Connecting-IP": "203.0.113.9" },
    });
    expect(clientIp(req)).toBe("203.0.113.9");
    expect(clientIp(new Request("https://relay.example.net/"))).toBe("unknown");
  });

  it("allows up to the limit per fixed 60s window, then denies with Retry-After", () => {
    const limiter = new RateLimiter();
    const now = 1_000_000;
    expect(limiter.check("1.2.3.4", 2, now)).toEqual({ allowed: true, retryAfterSeconds: 0 });
    expect(limiter.check("1.2.3.4", 2, now + 1_000)).toEqual({
      allowed: true,
      retryAfterSeconds: 0,
    });
    const denied = limiter.check("1.2.3.4", 2, now + 2_000);
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterSeconds).toBeGreaterThanOrEqual(1);
    expect(denied.retryAfterSeconds).toBeLessThanOrEqual(60);
  });

  it("keys windows per client IP", () => {
    const limiter = new RateLimiter();
    const now = 1_000_000;
    expect(limiter.check("1.1.1.1", 1, now).allowed).toBe(true);
    expect(limiter.check("2.2.2.2", 1, now).allowed).toBe(true);
    expect(limiter.check("1.1.1.1", 1, now).allowed).toBe(false);
  });

  it("resets the window after 60s", () => {
    const limiter = new RateLimiter();
    const start = 1_000_000;
    limiter.check("1.2.3.4", 1, start);
    expect(limiter.check("1.2.3.4", 1, start + 5_000).allowed).toBe(false);
    expect(limiter.check("1.2.3.4", 1, start + RATE_LIMIT_WINDOW_MS).allowed).toBe(true);
  });
});

describe("handleRelayRequest (origin allowlist + CORS)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    resetRateLimiter();
    fetchMock = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ gameCode: "ABC123" }),
    }));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    resetRateLimiter();
  });

  it("rejects a non-allowlisted Origin with 403 and never forwards", async () => {
    const res = await handleRelayRequest(relayRequest("https://evil.example.com"), makeEnv());
    expect(res.status).toBe(403);
    expect(await errorBody(res)).toMatchObject({ code: "origin_not_allowed" });
    expect(upstreamCalled(fetchMock)).toBe(false);
  });

  it("rejects a missing Origin (curl, non-browser clients) with 403", async () => {
    const res = await handleRelayRequest(relayRequest(null), makeEnv());
    expect(res.status).toBe(403);
    expect(await errorBody(res)).toMatchObject({ code: "origin_not_allowed" });
    expect(upstreamCalled(fetchMock)).toBe(false);
  });

  it("rejects a hostile origin that merely contains an allowlisted one", async () => {
    const res = await handleRelayRequest(
      relayRequest("https://rocketcrab.com.evil.example"),
      makeEnv(),
    );
    expect(res.status).toBe(403);
  });

  it("does not send CORS headers on the 403 (a disallowed origin must not read it)", async () => {
    const res = await handleRelayRequest(relayRequest("https://evil.example.com"), makeEnv());
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("answers OPTIONS preflights with 204 + CORS echoing the allowlisted origin, no forwarding", async () => {
    const res = await handleRelayRequest(
      relayRequest(ALLOWED_ORIGIN, { method: "OPTIONS" }),
      makeEnv(),
    );
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(ALLOWED_ORIGIN);
    expect(res.headers.get("Access-Control-Allow-Methods")).toBe("POST, OPTIONS");
    expect(res.headers.get("Access-Control-Allow-Headers")).toBe("Content-Type");
    expect(res.headers.get("Vary")).toBe("Origin");
    expect(upstreamCalled(fetchMock)).toBe(false);
  });

  it("rejects preflights from non-allowlisted origins too", async () => {
    const res = await handleRelayRequest(
      relayRequest("https://evil.example.com", { method: "OPTIONS" }),
      makeEnv(),
    );
    expect(res.status).toBe(403);
  });

  it("rejects non-POST methods with 405", async () => {
    const res = await handleRelayRequest(
      relayRequest(ALLOWED_ORIGIN, { method: "GET" }),
      makeEnv(),
    );
    expect(res.status).toBe(405);
    expect(await errorBody(res)).toMatchObject({ code: "method_not_allowed" });
    expect(upstreamCalled(fetchMock)).toBe(false);
  });

  it("forwards POST JSON to the allowlisted endpoint and passes through the JSON with CORS", async () => {
    const res = await handleRelayRequest(
      relayRequest(ALLOWED_ORIGIN, {
        body: JSON.stringify({ endpoint: "drawphone-new", body: {} }),
      }),
      makeEnv(),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(ALLOWED_ORIGIN);
    expect(res.headers.get("Vary")).toBe("Origin");
    expect(await res.json()).toEqual({ gameCode: "ABC123" });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://drawphone.tannerkrewson.com/new");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toMatchObject({ "Content-Type": "application/json" });
    expect(String(init?.body)).toBe("{}");
  });

  it("forwards the ooc payload body verbatim", async () => {
    await handleRelayRequest(
      relayRequest(ALLOWED_ORIGIN, {
        body: JSON.stringify({ endpoint: "ooc-rocketcrab", body: { game: "story", version: 1 } }),
      }),
      makeEnv(),
    );
    const [, init] = fetchMock.mock.calls[0]!;
    expect(JSON.parse(String(init?.body))).toEqual({ game: "story", version: 1 });
  });

  it("follows GET redirects and returns the final room URL (netgames.io)", async () => {
    fetchMock.mockImplementation(async (_url: RequestInfo | URL, _init?: RequestInit) => ({
      ok: true,
      status: 200,
      url: "https://netgames.io/games/avalon/ROOM-1",
      text: async () => "",
    }));

    const res = await handleRelayRequest(
      relayRequest(ALLOWED_ORIGIN, {
        body: JSON.stringify({ endpoint: "netgamesio-new", urlId: "avalon" }),
      }),
      makeEnv(),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ url: "https://netgames.io/games/avalon/ROOM-1" });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://netgames.io/games/avalon/new");
    expect(init?.method).toBeUndefined();
    expect(init).toMatchObject({ redirect: "follow" });
  });

  it("rejects a malformed body with 400", async () => {
    const res = await handleRelayRequest(
      relayRequest(ALLOWED_ORIGIN, { body: "not json" }),
      makeEnv(),
    );
    expect(res.status).toBe(400);
    expect(await errorBody(res)).toMatchObject({ code: "invalid_json" });
    expect(upstreamCalled(fetchMock)).toBe(false);
  });

  it("rejects a non-object body with 400", async () => {
    const res = await handleRelayRequest(
      relayRequest(ALLOWED_ORIGIN, { body: JSON.stringify([1, 2]) }),
      makeEnv(),
    );
    expect(res.status).toBe(400);
    expect(await errorBody(res)).toMatchObject({ code: "invalid_body" });
  });

  it("rejects requests without an endpoint with 400", async () => {
    const res = await handleRelayRequest(
      relayRequest(ALLOWED_ORIGIN, { body: JSON.stringify({ body: {} }) }),
      makeEnv(),
    );
    expect(res.status).toBe(400);
    expect(await errorBody(res)).toMatchObject({ code: "missing_endpoint" });
  });

  it("rejects unknown endpoints with 404 (never an open proxy)", async () => {
    const res = await handleRelayRequest(
      relayRequest(ALLOWED_ORIGIN, {
        body: JSON.stringify({ endpoint: "https://evil.example.com/new" }),
      }),
      makeEnv(),
    );
    expect(res.status).toBe(404);
    expect(await errorBody(res)).toMatchObject({ code: "unknown_endpoint" });
    expect(upstreamCalled(fetchMock)).toBe(false);
  });

  it("rejects path params outside the strict charset with 400", async () => {
    const res = await handleRelayRequest(
      relayRequest(ALLOWED_ORIGIN, {
        body: JSON.stringify({ endpoint: "netgamesio-new", urlId: "avalon/../etc" }),
      }),
      makeEnv(),
    );
    expect(res.status).toBe(400);
    expect(await errorBody(res)).toMatchObject({ code: "invalid_params" });
  });

  it("maps upstream non-2xx responses to a structured 502", async () => {
    fetchMock.mockImplementation(async (_url: RequestInfo | URL, _init?: RequestInit) => ({
      ok: false,
      status: 500,
      text: async () => "",
    }));
    const res = await handleRelayRequest(
      relayRequest(ALLOWED_ORIGIN, {
        body: JSON.stringify({ endpoint: "werewolf-newroom" }),
      }),
      makeEnv(),
    );
    expect(res.status).toBe(502);
    expect(await errorBody(res)).toMatchObject({
      code: "upstream_error",
      message: "upstream HTTP 500",
    });
  });

  it("maps a throwing upstream fetch to a structured 502", async () => {
    fetchMock.mockRejectedValue(new Error("network unreachable"));
    const res = await handleRelayRequest(
      relayRequest(ALLOWED_ORIGIN, {
        body: JSON.stringify({ endpoint: "spyfall-new" }),
      }),
      makeEnv(),
    );
    expect(res.status).toBe(502);
    expect(await errorBody(res)).toMatchObject({ code: "upstream_unavailable" });
  });

  it("uses the default allowlist + default rate limit when env is omitted", async () => {
    const res = await handleRelayRequest(
      relayRequest("https://rocketcrab.com", {
        body: JSON.stringify({ endpoint: "snakeout-new" }),
      }),
    );
    expect(res.status).toBe(200);
    expect(upstreamCalled(fetchMock)).toBe(true);
  });
});

describe("handleRelayRequest (per-IP rate limiting)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  // Limit 2/min so the third request from one IP trips the limiter.
  const limitedEnv = makeEnv({ RATE_LIMIT_PER_MIN: "2" });

  beforeEach(() => {
    resetRateLimiter();
    fetchMock = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ gameCode: "ABC123" }),
    }));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    resetRateLimiter();
  });

  function relayFromIp(ip: string): Promise<Response> {
    return handleRelayRequest(
      new Request("https://relay.example.net/", {
        method: "POST",
        headers: { Origin: ALLOWED_ORIGIN, "CF-Connecting-IP": ip },
        body: JSON.stringify({ endpoint: "drawphone-new", body: {} }),
      }),
      limitedEnv,
    );
  }

  it("returns 429 with Retry-After once a single IP exceeds the limit, no forwarding", async () => {
    expect((await relayFromIp("203.0.113.9")).status).toBe(200);
    expect((await relayFromIp("203.0.113.9")).status).toBe(200);
    const limited = await relayFromIp("203.0.113.9");
    expect(limited.status).toBe(429);
    expect(await errorBody(limited)).toMatchObject({ code: "rate_limited" });
    expect(limited.headers.get("Retry-After")).not.toBeNull();
    expect(Number(limited.headers.get("Retry-After"))).toBeGreaterThanOrEqual(1);
    // The 429 happens before any forwarding: only 2 fetches total.
    expect(fetchMock.mock.calls).toHaveLength(2);
  });

  it("still serves CORS headers on the 429 so the browser can read the error", async () => {
    await relayFromIp("203.0.113.9");
    await relayFromIp("203.0.113.9");
    const limited = await relayFromIp("203.0.113.9");
    expect(limited.headers.get("Access-Control-Allow-Origin")).toBe(ALLOWED_ORIGIN);
    expect(limited.headers.get("Content-Type")).toContain("application/json");
  });

  it("rate limits per IP, not globally", async () => {
    expect((await relayFromIp("203.0.113.1")).status).toBe(200);
    expect((await relayFromIp("203.0.113.1")).status).toBe(200);
    expect((await relayFromIp("203.0.113.1")).status).toBe(429);
    // A different IP is unaffected.
    expect((await relayFromIp("203.0.113.2")).status).toBe(200);
    expect(fetchMock.mock.calls).toHaveLength(3);
  });

  it("resets a client's window after 60 seconds", async () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    await relayFromIp("203.0.113.9");
    await relayFromIp("203.0.113.9");
    expect((await relayFromIp("203.0.113.9")).status).toBe(429);

    nowSpy.mockReturnValue(1_000_000 + RATE_LIMIT_WINDOW_MS);
    const after = await relayFromIp("203.0.113.9");
    expect(after.status).toBe(200);
  });

  it("exempts OPTIONS preflights from the rate limit", async () => {
    for (let i = 0; i < 3; i += 1) {
      const res = await handleRelayRequest(
        new Request("https://relay.example.net/", {
          method: "OPTIONS",
          headers: { Origin: ALLOWED_ORIGIN, "CF-Connecting-IP": "203.0.113.9" },
        }),
        limitedEnv,
      );
      expect(res.status).toBe(204);
    }
    // The first actual POST still goes through (no POST was rate-limited).
    expect((await relayFromIp("203.0.113.9")).status).toBe(200);
  });
});
