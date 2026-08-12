import { afterEach, describe, expect, it, vi } from "vitest";
import { RELAY_ENDPOINTS, handleRelayRequest } from "../../../../../deploy/relay/worker";
import { RELAY_ENDPOINT_KEYS } from "./relay";

/**
 * Scoped CORS relay worker tests (rocketcrab-9fv.7.7.5): the relay is a
 * self-contained fetch handler (deploy/relay/worker.ts) that forwards
 * room-creation requests to the allowlisted classic endpoints and returns
 * the upstream JSON with CORS headers. It must stay locked to the known
 * endpoints — never an open proxy.
 */

describe("allowlist sync with the client", () => {
  it("keeps the worker allowlist and the client endpoint keys identical", () => {
    expect(Object.keys(RELAY_ENDPOINTS).sort()).toEqual([...RELAY_ENDPOINT_KEYS].sort());
  });

  it("covers every CORS-blocked classic game (16 games, 8 endpoints)", () => {
    const endpoints = Object.values(RELAY_ENDPOINTS);
    // drawphone + drawphone-kids, 7 netgames.io, 3 outofcontext, secret
    // hitler, snakeout, spyfall, werewolf = 16 games.
    expect(endpoints).toHaveLength(8);
    expect(endpoints.every((entry) => entry.method === "POST" || entry.method === "GET")).toBe(
      true,
    );
    expect(endpoints.every((entry) => entry.shape === "json" || entry.shape === "redirect")).toBe(
      true,
    );
    expect(endpoints.every((entry) => entry.url.startsWith("https://"))).toBe(true);
  });
});

describe("handleRelayRequest", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("answers browser preflights with CORS headers", async () => {
    const res = await handleRelayRequest(
      new Request("https://relay.example.net", { method: "OPTIONS" }),
    );
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(res.headers.get("Access-Control-Allow-Methods")).toContain("POST");
  });

  it("rejects non-POST methods", async () => {
    const res = await handleRelayRequest(
      new Request("https://relay.example.net", { method: "GET" }),
    );
    expect(res.status).toBe(405);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  it("rejects a malformed body", async () => {
    const res = await handleRelayRequest(
      new Request("https://relay.example.net", { method: "POST", body: "not json" }),
    );
    expect(res.status).toBe(400);
  });

  it("rejects requests without an endpoint", async () => {
    const res = await handleRelayRequest(
      new Request("https://relay.example.net", {
        method: "POST",
        body: JSON.stringify({ body: {} }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("rejects unknown endpoints (never an open proxy)", async () => {
    const res = await handleRelayRequest(
      new Request("https://relay.example.net", {
        method: "POST",
        body: JSON.stringify({ endpoint: "https://evil.example.com/new" }),
      }),
    );
    expect(res.status).toBe(404);
  });

  it("rejects path params outside the strict charset", async () => {
    const res = await handleRelayRequest(
      new Request("https://relay.example.net", {
        method: "POST",
        body: JSON.stringify({ endpoint: "netgamesio-new", urlId: "avalon/../etc" }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("forwards POST JSON to the allowlisted endpoint and passes through the JSON", async () => {
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ gameCode: "ABC123" }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const res = await handleRelayRequest(
      new Request("https://relay.example.net", {
        method: "POST",
        body: JSON.stringify({ endpoint: "drawphone-new", body: {} }),
      }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(await res.json()).toEqual({ gameCode: "ABC123" });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://drawphone.tannerkrewson.com/new");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toMatchObject({ "Content-Type": "application/json" });
    expect(String(init?.body)).toBe("{}");
  });

  it("forwards the ooc payload body verbatim", async () => {
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ code: "RC42" }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    await handleRelayRequest(
      new Request("https://relay.example.net", {
        method: "POST",
        body: JSON.stringify({ endpoint: "ooc-rocketcrab", body: { game: "story", version: 1 } }),
      }),
    );
    const [, init] = fetchMock.mock.calls[0]!;
    expect(JSON.parse(String(init?.body))).toEqual({ game: "story", version: 1 });
  });

  it("follows GET redirects and returns the final room URL (netgames.io)", async () => {
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => ({
      ok: true,
      status: 200,
      url: "https://netgames.io/games/avalon/ROOM-1",
      text: async () => "",
    }));
    vi.stubGlobal("fetch", fetchMock);

    const res = await handleRelayRequest(
      new Request("https://relay.example.net", {
        method: "POST",
        body: JSON.stringify({ endpoint: "netgamesio-new", urlId: "avalon" }),
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ url: "https://netgames.io/games/avalon/ROOM-1" });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://netgames.io/games/avalon/new");
    expect(init?.method).toBeUndefined();
    expect(init).toMatchObject({ redirect: "follow" });
  });

  it("maps upstream failures to 502 with the upstream status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => ({
        ok: false,
        status: 500,
        text: async () => "",
      })),
    );
    const res = await handleRelayRequest(
      new Request("https://relay.example.net", {
        method: "POST",
        body: JSON.stringify({ endpoint: "werewolf-newroom" }),
      }),
    );
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "upstream HTTP 500" });
  });
});
