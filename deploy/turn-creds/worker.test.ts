import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_ORIGIN_ALLOWLIST,
  MINT_TTL_SECONDS,
  buildMintRequest,
  filterPort53IceServers,
  handleTurnCredsRequest,
  isPort53IceUrl,
  normalizeOrigin,
  originAllowed,
  parseAllowlist,
  type TurnCredsEnv,
} from "./worker";

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

describe("handleTurnCredsRequest (rocketcrab-23s.1: origin allowlist + CORS)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ iceServers: [], ttl: 600 }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
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
