import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_MINT_DAILY_CAP,
  DEFAULT_MINT_TOTAL_CAP,
  DEFAULT_ORIGIN_ALLOWLIST,
  MINT_TTL_SECONDS,
  RATE_LIMIT_WINDOW_MS,
  RateLimiter,
  buildMintRequest,
  clientIp,
  dailyCounterKey,
  exceededCap,
  filterPort53IceServers,
  handleTurnCredsRequest,
  handleWatchdogRequest,
  isPort53IceUrl,
  nextCounterValue,
  normalizeOrigin,
  originAllowed,
  parseAllowlist,
  parseCap,
  parseRateLimit,
  resetRateLimiter,
  utcDateKey,
  type KvStore,
  type TurnCredsEnv,
} from "./worker";
import { TURN_ANALYTICS_ENDPOINT } from "./watchdog";

/**
 * TURN credential mint worker tests (beads rocketcrab-23s). The worker
 * (deploy/turn-creds/worker.ts) mints short-lived Cloudflare Realtime TURN
 * credentials at party-join time; the upstream Cloudflare API is stubbed
 * with a mocked global fetch. Task 1 (rocketcrab-23s.1): origin allowlist
 * + CORS. Tasks 2 and 3 add port-53 stripping and rate limiting.
 */

const ALLOWED_ORIGIN = "https://rocketcrab.com";
const TEST_KEY_ID = "test-key-id";
const TEST_TOKEN = "test-api-token-super-secret";

function makeEnv(overrides: Partial<TurnCredsEnv> = {}): TurnCredsEnv {
  return {
    ORIGIN_ALLOWLIST: ALLOWED_ORIGIN,
    RATE_LIMIT_PER_MIN: "1000",
    TURN_KEY_ID: TEST_KEY_ID,
    TURN_KEY_API_TOKEN: TEST_TOKEN,
    ...overrides,
  };
}

/** Build a mint request with an optional Origin header. */
function mintRequest(origin: string | null, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  if (origin !== null) headers.set("Origin", origin);
  return new Request(`https://turn-creds.example.net/`, {
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

/**
 * In-memory KV stub matching the KvStore surface the worker uses (a
 * structural subset of Cloudflare's KVNamespace). Kept deliberately dumb:
 * get/put on a Map; entries() exposes state for assertions.
 */
class MemoryKv implements KvStore {
  private readonly store = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }

  async put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void> {
    void options;
    this.store.set(key, value);
  }

  entries(): Map<string, string> {
    return this.store;
  }
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

describe("normalizeOrigin / originAllowed", () => {
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
});

describe("buildMintRequest", () => {
  it("targets the Cloudflare Realtime credentials API with the TURN key id", () => {
    const req = buildMintRequest(makeEnv());
    expect(req).not.toBeNull();
    expect(req!.url).toBe(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${TEST_KEY_ID}/credentials/generate-ice-servers`,
    );
  });

  it("always requests the short 600s TTL and sends the bearer token", () => {
    const req = buildMintRequest(makeEnv());
    const init = req!.init;
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ Authorization: `Bearer ${TEST_TOKEN}` });
    expect(JSON.parse(String(init.body))).toEqual({ ttl: MINT_TTL_SECONDS });
  });

  it("returns null (misconfigured) when either TURN secret is missing", () => {
    expect(buildMintRequest(makeEnv({ TURN_KEY_ID: "" }))).toBeNull();
    expect(buildMintRequest(makeEnv({ TURN_KEY_API_TOKEN: undefined }))).toBeNull();
  });
});

describe("isPort53IceUrl / filterPort53IceServers (rocketcrab-23s.2)", () => {
  it("flags only URLs whose port list includes exactly 53", () => {
    expect(isPort53IceUrl("stun:turn.cloudflare.com:53?transport=udp")).toBe(true);
    expect(isPort53IceUrl("turn:turn.cloudflare.com:53?transport=udp")).toBe(true);
    expect(isPort53IceUrl("turns:turn.cloudflare.com:53?transport=tcp")).toBe(true);
    // The documented primary set must survive: never match inside :5349.
    expect(isPort53IceUrl("turns:turn.cloudflare.com:5349|443?transport=tcp")).toBe(false);
    expect(isPort53IceUrl("turn:turn.cloudflare.com:3478?transport=udp")).toBe(false);
    expect(isPort53IceUrl("turn:turn.cloudflare.com:3478?transport=tcp")).toBe(false);
    expect(isPort53IceUrl("stun:turn.cloudflare.com:3478?transport=udp")).toBe(false);
  });

  it("drops port-53 URLs from a minted response and keeps the documented primary set", () => {
    const body = {
      iceServers: [
        {
          urls: [
            "stun:turn.cloudflare.com:3478?transport=udp",
            "turn:turn.cloudflare.com:3478?transport=udp",
            "turn:turn.cloudflare.com:3478?transport=tcp",
            "turns:turn.cloudflare.com:5349|443?transport=tcp",
            "turn:turn.cloudflare.com:53?transport=udp",
            "turns:turn.cloudflare.com:53?transport=tcp",
            "stun:turn.cloudflare.com:53?transport=udp",
          ],
          username: "u1",
          credential: "c1",
        },
      ],
      ttl: 600,
    };
    const filtered = filterPort53IceServers(body);
    expect(filtered).toEqual({
      iceServers: [
        {
          urls: [
            "stun:turn.cloudflare.com:3478?transport=udp",
            "turn:turn.cloudflare.com:3478?transport=udp",
            "turn:turn.cloudflare.com:3478?transport=tcp",
            "turns:turn.cloudflare.com:5349|443?transport=tcp",
          ],
          username: "u1",
          credential: "c1",
        },
      ],
      ttl: 600,
    });
    expect(
      filtered.iceServers?.flatMap((s) => (Array.isArray(s.urls) ? s.urls : [s.urls])),
    ).not.toEqual(expect.arrayContaining([expect.stringContaining(":53?")]));
  });

  it("keeps entries whose urls is a single non-53 string and drops 53 ones", () => {
    const filtered = filterPort53IceServers({
      iceServers: [
        { urls: "turn:turn.cloudflare.com:3478?transport=udp", username: "a", credential: "b" },
        { urls: "stun:turn.cloudflare.com:53?transport=udp", username: "c", credential: "d" },
      ],
    });
    expect(filtered.iceServers).toEqual([
      { urls: "turn:turn.cloudflare.com:3478?transport=udp", username: "a", credential: "b" },
    ]);
  });

  it("removes an entry entirely when all of its urls are port-53", () => {
    const filtered = filterPort53IceServers({
      iceServers: [
        { urls: ["turn:turn.cloudflare.com:53?transport=udp"], username: "x", credential: "y" },
        { urls: ["turn:turn.cloudflare.com:3478?transport=udp"], username: "z", credential: "w" },
      ],
    });
    expect(filtered.iceServers).toEqual([
      { urls: ["turn:turn.cloudflare.com:3478?transport=udp"], username: "z", credential: "w" },
    ]);
  });
});

describe("parseRateLimit / clientIp / RateLimiter (rocketcrab-23s.3)", () => {
  it("defaults RATE_LIMIT_PER_MIN to 10 and parses positive integers", () => {
    expect(parseRateLimit(undefined)).toBe(10);
    expect(parseRateLimit("25")).toBe(25);
    expect(parseRateLimit("  3 ")).toBe(3);
  });

  it("falls back to the default for invalid or non-positive values", () => {
    expect(parseRateLimit("abc")).toBe(10);
    expect(parseRateLimit("")).toBe(10);
    expect(parseRateLimit("0")).toBe(10);
    expect(parseRateLimit("-5")).toBe(10);
  });

  it("reads the client IP from CF-Connecting-IP (edge-set, not spoofable)", () => {
    const req = new Request("https://x.example/", {
      headers: { "CF-Connecting-IP": "203.0.113.9" },
    });
    expect(clientIp(req)).toBe("203.0.113.9");
    expect(clientIp(new Request("https://x.example/"))).toBe("unknown");
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

describe("handleTurnCredsRequest (rocketcrab-23s.1: origin allowlist + CORS)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    resetRateLimiter();
    fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ iceServers: [], ttl: 600 }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    resetRateLimiter();
  });

  it("rejects a non-allowlisted Origin with 403 and never calls upstream", async () => {
    const res = await handleTurnCredsRequest(mintRequest("https://evil.example.com"), makeEnv());
    expect(res.status).toBe(403);
    expect(await errorBody(res)).toMatchObject({ code: "origin_not_allowed" });
    expect(upstreamCalled(fetchMock)).toBe(false);
  });

  it("rejects a missing Origin (curl, non-browser clients) with 403", async () => {
    const res = await handleTurnCredsRequest(mintRequest(null), makeEnv());
    expect(res.status).toBe(403);
    expect(await errorBody(res)).toMatchObject({ code: "origin_not_allowed" });
    expect(upstreamCalled(fetchMock)).toBe(false);
  });

  it("rejects a hostile origin that merely contains an allowlisted one", async () => {
    const res = await handleTurnCredsRequest(
      mintRequest("https://rocketcrab.com.evil.example"),
      makeEnv(),
    );
    expect(res.status).toBe(403);
  });

  it("answers OPTIONS preflights with 204 + correct CORS headers, no upstream call", async () => {
    const res = await handleTurnCredsRequest(
      mintRequest(ALLOWED_ORIGIN, { method: "OPTIONS" }),
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
    const res = await handleTurnCredsRequest(
      mintRequest("https://evil.example.com", { method: "OPTIONS" }),
      makeEnv(),
    );
    expect(res.status).toBe(403);
  });

  it("rejects non-POST methods with 405", async () => {
    const res = await handleTurnCredsRequest(
      mintRequest(ALLOWED_ORIGIN, { method: "GET" }),
      makeEnv(),
    );
    expect(res.status).toBe(405);
    expect(await errorBody(res)).toMatchObject({ code: "method_not_allowed" });
    expect(upstreamCalled(fetchMock)).toBe(false);
  });

  it("mints successfully for an allowlisted origin: forwards ttl=600, returns the body with CORS", async () => {
    const upstreamBody = {
      iceServers: [
        { urls: ["turn:turn.cloudflare.com:3478?transport=udp"], username: "u1", credential: "c1" },
      ],
      ttl: 600,
    };
    fetchMock.mockImplementation(
      async () => new Response(JSON.stringify(upstreamBody), { status: 200 }),
    );

    const res = await handleTurnCredsRequest(mintRequest(ALLOWED_ORIGIN), makeEnv());
    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(ALLOWED_ORIGIN);
    expect(await res.json()).toEqual(upstreamBody);

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${TEST_KEY_ID}/credentials/generate-ice-servers`,
    );
    expect(JSON.parse(String(init?.body))).toEqual({ ttl: MINT_TTL_SECONDS });
  });

  it("strips port-53 URLs end to end while keeping the primary set and shape", async () => {
    fetchMock.mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            iceServers: [
              {
                urls: [
                  "turn:turn.cloudflare.com:3478?transport=udp",
                  "turns:turn.cloudflare.com:5349|443?transport=tcp",
                  "turn:turn.cloudflare.com:53?transport=udp",
                ],
                username: "u1",
                credential: "c1",
              },
            ],
            ttl: 600,
          }),
          { status: 200 },
        ),
    );

    const res = await handleTurnCredsRequest(mintRequest(ALLOWED_ORIGIN), makeEnv());
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      iceServers: Array<{ urls: string[]; username: string; credential: string }>;
    };
    expect(body.iceServers).toEqual([
      {
        urls: [
          "turn:turn.cloudflare.com:3478?transport=udp",
          "turns:turn.cloudflare.com:5349|443?transport=tcp",
        ],
        username: "u1",
        credential: "c1",
      },
    ]);
  });

  it("returns 502 with a structured error when the upstream call throws", async () => {
    fetchMock.mockRejectedValue(new Error("network unreachable"));
    const res = await handleTurnCredsRequest(mintRequest(ALLOWED_ORIGIN), makeEnv());
    expect(res.status).toBe(502);
    expect(await errorBody(res)).toMatchObject({ code: "upstream_unavailable" });
  });

  it("returns 502 when the upstream responds with a non-2xx status", async () => {
    fetchMock.mockImplementation(async () => new Response("boom", { status: 500 }));
    const res = await handleTurnCredsRequest(mintRequest(ALLOWED_ORIGIN), makeEnv());
    expect(res.status).toBe(502);
    expect(await errorBody(res)).toMatchObject({ code: "upstream_error" });
  });

  it("returns 502 when the upstream body is not valid JSON or the wrong shape", async () => {
    fetchMock.mockImplementation(async () => new Response("not json", { status: 200 }));
    let res = await handleTurnCredsRequest(mintRequest(ALLOWED_ORIGIN), makeEnv());
    expect(res.status).toBe(502);

    fetchMock.mockImplementation(
      async () => new Response(JSON.stringify({ nope: 1 }), { status: 200 }),
    );
    res = await handleTurnCredsRequest(mintRequest(ALLOWED_ORIGIN), makeEnv());
    expect(res.status).toBe(502);
    expect(await errorBody(res)).toMatchObject({ code: "upstream_invalid" });
  });

  it("never leaks the TURN API token in error responses", async () => {
    fetchMock.mockRejectedValue(new Error("boom"));
    const res = await handleTurnCredsRequest(mintRequest(ALLOWED_ORIGIN), makeEnv());
    const text = await res.text();
    expect(text).not.toContain(TEST_TOKEN);
    expect(text).not.toContain("Bearer");
  });

  it("returns 500 when the TURN secrets are not configured, without calling upstream", async () => {
    const res = await handleTurnCredsRequest(
      mintRequest(ALLOWED_ORIGIN),
      makeEnv({ TURN_KEY_ID: "", TURN_KEY_API_TOKEN: "" }),
    );
    expect(res.status).toBe(500);
    expect(await errorBody(res)).toMatchObject({ code: "worker_misconfigured" });
    expect(upstreamCalled(fetchMock)).toBe(false);
  });
});

describe("handleTurnCredsRequest (rocketcrab-23s.3: per-IP rate limiting)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  // Limit 2/min so the third request from one IP trips the limiter.
  const limitedEnv = makeEnv({ RATE_LIMIT_PER_MIN: "2" });

  beforeEach(() => {
    resetRateLimiter();
    fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ iceServers: [], ttl: 600 }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    resetRateLimiter();
  });

  function mintFromIp(ip: string): Promise<Response> {
    return handleTurnCredsRequest(
      new Request("https://turn-creds.example.net/", {
        method: "POST",
        headers: { Origin: ALLOWED_ORIGIN, "CF-Connecting-IP": ip },
      }),
      limitedEnv,
    );
  }

  it("returns 429 with Retry-After once a single IP exceeds the limit, no upstream call", async () => {
    expect((await mintFromIp("203.0.113.9")).status).toBe(200);
    expect((await mintFromIp("203.0.113.9")).status).toBe(200);
    const limited = await mintFromIp("203.0.113.9");
    expect(limited.status).toBe(429);
    expect(await errorBody(limited)).toMatchObject({ code: "rate_limited" });
    expect(limited.headers.get("Retry-After")).not.toBeNull();
    expect(Number(limited.headers.get("Retry-After"))).toBeGreaterThanOrEqual(1);
    // The 429 happens before any upstream call: only 2 fetches total.
    expect(fetchMock.mock.calls).toHaveLength(2);
  });

  it("still serves CORS headers on the 429 so the browser can read the error", async () => {
    await mintFromIp("203.0.113.9");
    await mintFromIp("203.0.113.9");
    const limited = await mintFromIp("203.0.113.9");
    expect(limited.headers.get("Access-Control-Allow-Origin")).toBe(ALLOWED_ORIGIN);
    expect(limited.headers.get("Content-Type")).toContain("application/json");
  });

  it("rate limits per IP, not globally", async () => {
    expect((await mintFromIp("203.0.113.1")).status).toBe(200);
    expect((await mintFromIp("203.0.113.1")).status).toBe(200);
    expect((await mintFromIp("203.0.113.1")).status).toBe(429);
    // A different IP is unaffected.
    expect((await mintFromIp("203.0.113.2")).status).toBe(200);
    expect(fetchMock.mock.calls).toHaveLength(3);
  });

  it("resets a client's window after 60 seconds", async () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    await mintFromIp("203.0.113.9");
    await mintFromIp("203.0.113.9");
    expect((await mintFromIp("203.0.113.9")).status).toBe(429);

    nowSpy.mockReturnValue(1_000_000 + RATE_LIMIT_WINDOW_MS);
    const after = await mintFromIp("203.0.113.9");
    expect(after.status).toBe(200);
  });
});

describe("budget kill-switch pure functions (rocketcrab-23s.4)", () => {
  it("parses cap env vars with the documented defaults", () => {
    expect(parseCap(undefined, DEFAULT_MINT_DAILY_CAP)).toBe(DEFAULT_MINT_DAILY_CAP);
    expect(parseCap(undefined, DEFAULT_MINT_TOTAL_CAP)).toBe(DEFAULT_MINT_TOTAL_CAP);
    expect(parseCap("100", 5000)).toBe(100);
    expect(parseCap("  7 ", 5000)).toBe(7);
  });

  it("falls back to the default for invalid or non-positive caps", () => {
    expect(parseCap("abc", 5000)).toBe(5000);
    expect(parseCap("", 5000)).toBe(5000);
    expect(parseCap("0", 5000)).toBe(5000);
    expect(parseCap("-5", 5000)).toBe(5000);
  });

  it("derives the daily counter key from the UTC calendar date", () => {
    expect(utcDateKey(Date.UTC(2026, 7, 13, 23, 59, 59))).toBe("2026-08-13");
    expect(dailyCounterKey(Date.UTC(2026, 7, 13))).toBe("mints:2026-08-13");
  });

  it("nextCounterValue parses the stored string and counts from zero", () => {
    expect(nextCounterValue(null)).toBe(1);
    expect(nextCounterValue("0")).toBe(1);
    expect(nextCounterValue("41")).toBe(42);
    expect(nextCounterValue("garbage")).toBe(1);
  });

  it("exceededCap names the offending cap, daily first", () => {
    expect(exceededCap(4999, 0, 5000, 50000)).toBeNull();
    expect(exceededCap(5000, 100, 5000, 50000)).toEqual({ cap: "daily" });
    expect(exceededCap(10, 50000, 5000, 50000)).toEqual({ cap: "total" });
    expect(exceededCap(5000, 50000, 5000, 50000)).toEqual({ cap: "daily" });
  });
});

describe("budget kill-switch via KV counters (rocketcrab-23s.4)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    resetRateLimiter();
    fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ iceServers: [], ttl: 600 }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    resetRateLimiter();
  });

  it("a successful mint increments both counters (daily key + total)", async () => {
    const kv = new MemoryKv();
    const res = await handleTurnCredsRequest(
      mintRequest(ALLOWED_ORIGIN),
      makeEnv({ TURN_BUDGET: kv }),
    );
    expect(res.status).toBe(200);
    const today = new Date().toISOString().slice(0, 10);
    expect(kv.entries().get(`mints:${today}`)).toBe("1");
    expect(kv.entries().get("mints:total")).toBe("1");
  });

  it("counters accumulate across mints; the daily counter rolls over at UTC midnight", async () => {
    const kv = new MemoryKv();
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(Date.UTC(2026, 7, 13, 12, 0, 0));
    const env = makeEnv({ TURN_BUDGET: kv });

    await handleTurnCredsRequest(mintRequest(ALLOWED_ORIGIN), env);
    await handleTurnCredsRequest(mintRequest(ALLOWED_ORIGIN), env);
    expect(kv.entries().get("mints:2026-08-13")).toBe("2");
    expect(kv.entries().get("mints:total")).toBe("2");

    // Next UTC day: fresh daily counter, total keeps counting.
    nowSpy.mockReturnValue(Date.UTC(2026, 7, 14, 0, 0, 1));
    await handleTurnCredsRequest(mintRequest(ALLOWED_ORIGIN), env);
    expect(kv.entries().get("mints:2026-08-14")).toBe("1");
    expect(kv.entries().get("mints:total")).toBe("3");
  });

  it("a failed mint (upstream error) does not increment counters", async () => {
    const kv = new MemoryKv();
    fetchMock.mockImplementation(async () => new Response("boom", { status: 500 }));
    const res = await handleTurnCredsRequest(
      mintRequest(ALLOWED_ORIGIN),
      makeEnv({ TURN_BUDGET: kv }),
    );
    expect(res.status).toBe(502);
    expect(kv.entries().size).toBe(0);
  });

  it("rejects with 429 budget_exceeded once the daily cap is reached, before any upstream call", async () => {
    const kv = new MemoryKv();
    // Counter at the cap: the NEXT mint is refused (kill-switch semantics).
    kv.entries().set("mints:2026-08-13", String(DEFAULT_MINT_DAILY_CAP));
    vi.spyOn(Date, "now").mockReturnValue(Date.UTC(2026, 7, 13, 12, 0, 0));

    const res = await handleTurnCredsRequest(
      mintRequest(ALLOWED_ORIGIN),
      makeEnv({ TURN_BUDGET: kv }),
    );
    expect(res.status).toBe(429);
    const data = (await res.json()) as {
      error?: { code?: string; message?: string; cap?: string; limit?: number };
    };
    expect(data.error?.code).toBe("budget_exceeded");
    expect(data.error?.message).toContain("daily");
    expect(data.error?.cap).toBe("daily");
    expect(data.error?.limit).toBe(DEFAULT_MINT_DAILY_CAP);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(ALLOWED_ORIGIN);
    expect(upstreamCalled(fetchMock)).toBe(false);
  });

  it("rejects with 429 budget_exceeded once the total cap is reached", async () => {
    const kv = new MemoryKv();
    kv.entries().set("mints:total", String(DEFAULT_MINT_TOTAL_CAP));

    const res = await handleTurnCredsRequest(
      mintRequest(ALLOWED_ORIGIN),
      makeEnv({ TURN_BUDGET: kv }),
    );
    expect(res.status).toBe(429);
    const data = (await res.json()) as {
      error?: { code?: string; message?: string; cap?: string };
    };
    expect(data.error?.code).toBe("budget_exceeded");
    expect(data.error?.message).toContain("total");
    expect(data.error?.cap).toBe("total");
    expect(upstreamCalled(fetchMock)).toBe(false);
  });

  it("enforces custom caps from env (MINT_DAILY_CAP), allowing exactly the cap's worth of mints", async () => {
    const kv = new MemoryKv();
    const env = makeEnv({ TURN_BUDGET: kv, MINT_DAILY_CAP: "2" });
    expect((await handleTurnCredsRequest(mintRequest(ALLOWED_ORIGIN), env)).status).toBe(200);
    expect((await handleTurnCredsRequest(mintRequest(ALLOWED_ORIGIN), env)).status).toBe(200);
    expect((await handleTurnCredsRequest(mintRequest(ALLOWED_ORIGIN), env)).status).toBe(429);
    expect(kv.entries().get("mints:total")).toBe("2");
    expect(fetchMock.mock.calls).toHaveLength(2);
  });

  it("fails open when the KV binding is missing (dev): mint still succeeds", async () => {
    const res = await handleTurnCredsRequest(mintRequest(ALLOWED_ORIGIN), makeEnv());
    expect(res.status).toBe(200);
    expect(upstreamCalled(fetchMock)).toBe(true);
  });

  it("fails open when KV reads or writes throw: mint still succeeds", async () => {
    const kv = new MemoryKv();
    vi.spyOn(kv, "get").mockRejectedValue(new Error("kv down"));
    const res = await handleTurnCredsRequest(
      mintRequest(ALLOWED_ORIGIN),
      makeEnv({ TURN_BUDGET: kv }),
    );
    expect(res.status).toBe(200);
    expect(upstreamCalled(fetchMock)).toBe(true);

    // Writes failing after a successful read must not lose the response either.
    const kv2 = new MemoryKv();
    vi.spyOn(kv2, "put").mockRejectedValue(new Error("kv write down"));
    const res2 = await handleTurnCredsRequest(
      mintRequest(ALLOWED_ORIGIN),
      makeEnv({ TURN_BUDGET: kv2 }),
    );
    expect(res2.status).toBe(200);
  });

  it("GET /__watchdog runs one watchdog pass and returns its summary (manual cron trigger)", async () => {
    fetchMock.mockImplementation(async (url: string | URL) => {
      if (String(url) === TURN_ANALYTICS_ENDPOINT) {
        return new Response(
          JSON.stringify({
            data: {
              viewer: {
                accounts: [{ callsTurnUsageAdaptiveGroups: [{ sum: { egressBytes: 1000 } }] }],
              },
            },
          }),
          { status: 200 },
        );
      }
      return new Response("unexpected fetch", { status: 500 });
    });

    const res = await handleWatchdogRequest(
      new Request("https://turn-creds.example.net/__watchdog"),
      { CLOUDFLARE_ACCOUNT_ID: "test-account", CLOUDFLARE_API_TOKEN: "test-token" },
    );
    expect(res.status).toBe(200);
    const summary = (await res.json()) as { ok: boolean; egressBytes: number; error?: string };
    expect(summary.ok).toBe(true);
    expect(summary.egressBytes).toBe(1000);
  });
});
