import { afterEach, describe, expect, it, vi } from "vitest";
import { RELAY_ENDPOINT_KEYS } from "../../apps/nova/src/lib/classic/relay";
import { RELAY_ENDPOINTS } from "./relay";
import { MINT_TTL_SECONDS, dropPort53, isPort53IceUrl } from "./turn";
import edge, { type EdgeEnv, parseAllowlist } from "./worker";

const ORIGIN = "https://rocketcrab.com";
const BASE_ENV: EdgeEnv = { ORIGIN_ALLOWLIST: `${ORIGIN},http://localhost:5173` };
const TURN_ENV: EdgeEnv = { ...BASE_ENV, TURN_KEY_ID: "key-id", TURN_KEY_API_TOKEN: "secret" };

function call(path: string, init: RequestInit & { origin?: string | null } = {}, env = BASE_ENV) {
  const headers = new Headers(init.headers);
  if (init.origin !== null) headers.set("Origin", init.origin ?? ORIGIN);
  headers.set("CF-Connecting-IP", "203.0.113.7");
  return edge.fetch(
    new Request(`https://edge.example${path}`, { method: "POST", ...init, headers }),
    env,
  );
}

function relay(body: unknown, env = BASE_ENV) {
  return call("/", { body: JSON.stringify(body) }, env);
}

async function errorCode(response: Response) {
  return ((await response.json()) as { error: { code: string } }).error.code;
}

function mockFetch(response: Response | Error) {
  const fetchMock = vi.fn(() =>
    response instanceof Error ? Promise.reject(response) : Promise.resolve(response),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

describe("gate", () => {
  it("rejects missing and unlisted origins without CORS headers", async () => {
    for (const origin of [null, "https://evil.example"]) {
      const response = await call("/turn", { origin }, TURN_ENV);
      expect(response.status).toBe(403);
      expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
    }
  });

  it("rejects everything when the allowlist is unset", async () => {
    expect((await call("/", {}, {})).status).toBe(403);
  });

  it("normalizes allowlist entries and tolerates a trailing slash on Origin", async () => {
    expect(parseAllowlist(" https://a.example/ ,, https://b.example")).toEqual([
      "https://a.example",
      "https://b.example",
    ]);
    const response = await call("/", { origin: `${ORIGIN}/`, body: "{}" });
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);
  });

  it("answers preflight with CORS headers echoing the origin", async () => {
    const response = await call("/turn", { method: "OPTIONS" });
    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);
    expect(response.headers.get("Vary")).toBe("Origin");
  });

  it("allows only POST and known paths", async () => {
    expect((await call("/", { method: "GET" })).status).toBe(405);
    expect((await call("/nope")).status).toBe(404);
    expect((await call("/turn/")).status).toBe(500);
  });

  it("rate limits per route and IP with Retry-After", async () => {
    const keys: string[] = [];
    const env: EdgeEnv = {
      ...BASE_ENV,
      RATE_LIMITER: {
        limit: ({ key }) => {
          keys.push(key);
          return Promise.resolve({ success: false });
        },
      },
    };
    const fetchMock = mockFetch(new Response("{}"));
    const turn = await call("/turn", {}, { ...TURN_ENV, RATE_LIMITER: env.RATE_LIMITER });
    const classic = await relay({ endpoint: "spyfall-new" }, env);
    for (const response of [turn, classic]) {
      expect(response.status).toBe(429);
      expect(response.headers.get("Retry-After")).toBe("60");
      expect(response.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);
    }
    expect(keys).toEqual(["turn:203.0.113.7", "relay:203.0.113.7"]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("charges signal, tunnel and log to the bulk budget, never the strict one", async () => {
    const strict = vi.fn(async () => ({ success: false }));
    const bulk = vi.fn(async (_options: { key: string }) => ({ success: true }));
    const forward = {
      idFromName: (name: string) => name,
      get: () => ({ fetch: async () => new Response("ok") }),
    };
    const env: EdgeEnv = {
      ...BASE_ENV,
      RATE_LIMITER: { limit: strict },
      BULK_RATE_LIMITER: { limit: bulk },
      SIGNAL_HUB: forward,
      TUNNEL_PAIR: forward,
    };
    const upgrade = { method: "GET", headers: { Upgrade: "websocket" } };
    expect((await call(`/signal/${"a".repeat(32)}`, upgrade, env)).status).toBe(200);
    expect((await call(`/tunnel/${"b".repeat(64)}`, upgrade, env)).status).toBe(200);
    expect((await call("/log", { body: "{}" }, env)).status).not.toBe(429);
    expect(strict).not.toHaveBeenCalled();
    expect(bulk.mock.calls.map(([arg]) => arg.key)).toEqual([
      "signal:203.0.113.7",
      "tunnel:203.0.113.7",
      "log:203.0.113.7",
    ]);
  });

  it("fails open when the rate limiter itself fails", async () => {
    mockFetch(Response.json({ gameCode: "ABCD" }));
    const env: EdgeEnv = {
      ...BASE_ENV,
      RATE_LIMITER: { limit: () => Promise.reject(new Error("down")) },
    };
    expect((await relay({ endpoint: "spyfall-new" }, env)).status).toBe(200);
  });
});

describe("Classic relay", () => {
  it("matches the client's endpoint list", () => {
    expect(Object.keys(RELAY_ENDPOINTS).sort()).toEqual([...RELAY_ENDPOINT_KEYS].sort());
  });

  it("forwards POST bodies to the fixed endpoint and passes JSON through", async () => {
    const fetchMock = mockFetch(Response.json({ gameCode: "ABCD" }));
    const response = await relay({ endpoint: "ooc-rocketcrab", body: { game: "x" } });
    expect(await response.json()).toEqual({ gameCode: "ABCD" });
    expect(fetchMock).toHaveBeenCalledWith("https://outofcontext.party/api/v1/rocketcrab", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: '{"game":"x"}',
    });
  });

  it("wraps non-JSON upstream bodies", async () => {
    mockFetch(new Response("ROOM"));
    expect(await (await relay({ endpoint: "spyfall-new" })).json()).toEqual({ raw: "ROOM" });
  });

  it("follows netgames.io redirects and validates the game id", async () => {
    const upstream = new Response("");
    Object.defineProperty(upstream, "url", { value: "https://netgames.io/games/x/ROOM" });
    const fetchMock = mockFetch(upstream);
    const response = await relay({ endpoint: "netgamesio-new", urlId: "werewolf" });
    expect(await response.json()).toEqual({ url: "https://netgames.io/games/x/ROOM" });
    expect(fetchMock).toHaveBeenCalledWith("https://netgames.io/games/werewolf/new", {
      redirect: "follow",
    });

    for (const urlId of [undefined, "../admin", "a/b"]) {
      expect(await errorCode(await relay({ endpoint: "netgamesio-new", urlId }))).toBe(
        "invalid_params",
      );
    }
  });

  it("rejects bad envelopes and unknown endpoints without fetching", async () => {
    const fetchMock = mockFetch(new Response("{}"));
    expect(await errorCode(await call("/", { body: "nope" }))).toBe("invalid_json");
    expect(await errorCode(await relay([1]))).toBe("invalid_body");
    expect(await errorCode(await relay({ endpoint: "https://evil.example" }))).toBe(
      "unknown_endpoint",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps upstream failures to 502", async () => {
    mockFetch(new Response("", { status: 500 }));
    expect(await errorCode(await relay({ endpoint: "spyfall-new" }))).toBe("upstream_error");
    mockFetch(new Error("offline"));
    expect(await errorCode(await relay({ endpoint: "spyfall-new" }))).toBe("upstream_unavailable");
  });
});

describe("TURN mint", () => {
  const ICE = {
    iceServers: [
      { urls: ["stun:stun.cloudflare.com:3478", "stun:stun.cloudflare.com:53"] },
      {
        urls: ["turn:turn.cloudflare.com:3478?transport=udp", "turn:turn.cloudflare.com:53"],
        username: "u",
        credential: "c",
      },
      { urls: "turns:turn.cloudflare.com:5349|443?transport=tcp", username: "u", credential: "c" },
    ],
  };

  it("fails loudly without secrets", async () => {
    expect(await errorCode(await call("/turn"))).toBe("worker_misconfigured");
  });

  it("mints a 24 h credential with the secret only in the auth header", async () => {
    const fetchMock = mockFetch(Response.json(ICE));
    const response = await call("/turn", { body: '{"ttl":999999}' }, TURN_ENV);
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).not.toContain("secret");
    expect(JSON.parse(body)).toEqual({
      iceServers: [
        { urls: ["stun:stun.cloudflare.com:3478"] },
        { urls: ["turn:turn.cloudflare.com:3478?transport=udp"], username: "u", credential: "c" },
        {
          urls: ["turns:turn.cloudflare.com:5349|443?transport=tcp"],
          username: "u",
          credential: "c",
        },
      ],
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://rtc.live.cloudflare.com/v1/turn/keys/key-id/credentials/generate-ice-servers",
      {
        method: "POST",
        headers: { Authorization: "Bearer secret", "Content-Type": "application/json" },
        body: JSON.stringify({ ttl: MINT_TTL_SECONDS }),
      },
    );
  });

  it("maps upstream failures to 502", async () => {
    mockFetch(new Error("offline"));
    expect(await errorCode(await call("/turn", {}, TURN_ENV))).toBe("upstream_unavailable");
    mockFetch(new Response("", { status: 401 }));
    expect(await errorCode(await call("/turn", {}, TURN_ENV))).toBe("upstream_error");
    mockFetch(Response.json({ nope: true }));
    expect(await errorCode(await call("/turn", {}, TURN_ENV))).toBe("upstream_invalid");
  });

  it("compares ports exactly when dropping port 53", () => {
    expect(isPort53IceUrl("turn:h:53?transport=udp")).toBe(true);
    expect(isPort53IceUrl("turns:h:5349|53?transport=tcp")).toBe(true);
    expect(isPort53IceUrl("turns:h:5349|443")).toBe(false);
    expect(dropPort53([{ urls: "stun:h:53" }])).toEqual([]);
  });
});

describe("tunnel route", () => {
  const PAIR = "b".repeat(64);
  const UPGRADE = { method: "GET", headers: { Upgrade: "websocket" } };

  function tunnelEnv(overrides: Partial<EdgeEnv> = {}) {
    const idFromName = vi.fn((name: string) => name);
    const fetch = vi.fn(async () => new Response("forwarded"));
    const limit = vi.fn(async () => ({ success: true }));
    const env: EdgeEnv = {
      ...BASE_ENV,
      TUNNEL_PAIR: { idFromName, get: () => ({ fetch }) },
      BULK_RATE_LIMITER: { limit },
      ...overrides,
    };
    return { env, idFromName, fetch, limit };
  }

  it("rejects pair IDs that are not 64 lowercase hex characters", async () => {
    const { env, fetch } = tunnelEnv();
    for (const id of ["a".repeat(63), "a".repeat(65), "A".repeat(64), "g".repeat(64)]) {
      expect((await call(`/tunnel/${id}`, UPGRADE, env)).status).toBe(404);
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects non-GET and non-upgrade requests before reaching the object", async () => {
    const { env, fetch } = tunnelEnv();
    expect((await call(`/tunnel/${PAIR}`, { ...UPGRADE, method: "POST" }, env)).status).toBe(405);
    expect((await call(`/tunnel/${PAIR}`, { method: "GET" }, env)).status).toBe(426);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("requires an allowlisted Origin, and a missing Origin is refused too", async () => {
    const { env, fetch } = tunnelEnv();
    const response = await call(
      `/tunnel/${PAIR}`,
      { ...UPGRADE, origin: "https://evil.example" },
      env,
    );
    expect(response.status).toBe(403);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect((await call(`/tunnel/${PAIR}`, { ...UPGRADE, origin: null }, env)).status).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rate limits per IP with the tunnel key and forwards the rest to the pair object", async () => {
    const { env, idFromName, fetch, limit } = tunnelEnv();
    expect(await (await call(`/tunnel/${PAIR}`, UPGRADE, env)).text()).toBe("forwarded");
    expect(idFromName).toHaveBeenCalledWith(PAIR);
    expect(limit).toHaveBeenCalledWith({ key: "tunnel:203.0.113.7" });

    limit.mockResolvedValueOnce({ success: false });
    const limited = await call(`/tunnel/${PAIR}`, UPGRADE, env);
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toBe("60");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("returns 503 when the Durable Object binding is missing", async () => {
    const { env } = tunnelEnv({ TUNNEL_PAIR: undefined });
    const response = await call(`/tunnel/${PAIR}`, UPGRADE, env);
    expect(response.status).toBe(503);
    expect(await errorCode(response)).toBe("unavailable");
  });
});
