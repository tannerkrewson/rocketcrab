import { afterEach, describe, expect, it, vi } from "vitest";
import { classicRelayBaseUrl, relayConfigured, relayRequest } from "./relay";

/**
 * Scoped CORS relay client tests (rocketcrab-9fv.7.7.5): the relay base URL
 * comes from the VITE_CLASSIC_RELAY_ORIGIN build-time env (same pattern as
 * VITE_RUNTIME_ORIGIN, M2) and is empty when the build pins no origin.
 */

describe("classicRelayBaseUrl / relayConfigured", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("defaults to unconfigured (no VITE_CLASSIC_RELAY_ORIGIN)", () => {
    expect(classicRelayBaseUrl()).toBe("");
    expect(relayConfigured()).toBe(false);
  });

  it("honours the VITE_CLASSIC_RELAY_ORIGIN build-time pin", () => {
    vi.stubEnv("VITE_CLASSIC_RELAY_ORIGIN", "https://relay.example.net");
    expect(classicRelayBaseUrl()).toBe("https://relay.example.net");
    expect(relayConfigured()).toBe(true);
  });
});

describe("relayRequest", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("throws a clear error when the build pins no relay origin", async () => {
    await expect(relayRequest("drawphone-new")).rejects.toThrow(
      /doesn't set VITE_CLASSIC_RELAY_ORIGIN/i,
    );
  });

  it("POSTs the endpoint envelope to the relay origin and parses the JSON", async () => {
    vi.stubEnv("VITE_CLASSIC_RELAY_ORIGIN", "https://relay.example.net");
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => ({
      ok: true,
      status: 200,
      json: async () => ({ gameCode: "ABC123" }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await relayRequest<{ gameCode: string }>("drawphone-new");
    expect(result).toEqual({ gameCode: "ABC123" });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://relay.example.net");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({ endpoint: "drawphone-new" });
  });

  it("forwards the payload body and path params in the envelope", async () => {
    vi.stubEnv("VITE_CLASSIC_RELAY_ORIGIN", "https://relay.example.net");
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => ({
      ok: true,
      status: 200,
      json: async () => ({ url: "https://netgames.io/games/avalon/ROOM-1" }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    await relayRequest("netgamesio-new", { urlId: "avalon" });
    await relayRequest("ooc-rocketcrab", { body: { game: "story", version: 1 } });

    const envelopes = fetchMock.mock.calls.map(([, init]) => JSON.parse(String(init?.body)));
    expect(envelopes[0]).toEqual({ endpoint: "netgamesio-new", urlId: "avalon" });
    expect(envelopes[1]).toEqual({
      endpoint: "ooc-rocketcrab",
      body: { game: "story", version: 1 },
    });
  });

  it("surfaces the relay's error detail on a failed response", async () => {
    vi.stubEnv("VITE_CLASSIC_RELAY_ORIGIN", "https://relay.example.net");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => ({
        ok: false,
        status: 502,
        json: async () => ({ error: "upstream HTTP 500" }),
      })),
    );
    await expect(relayRequest("snakeout-new")).rejects.toThrow(/upstream HTTP 500/);
  });
});
