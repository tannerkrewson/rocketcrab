import { afterEach, describe, expect, it, vi } from "vitest";
import { relayRequest } from "./relay";

function stubFetch(ok: boolean, status: number, body: unknown) {
  const fetchMock = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => ({
    ok,
    status,
    json: async () => body,
  }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("relayRequest", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("throws a clear error when the build sets no edge origin", async () => {
    await expect(relayRequest("drawphone-new")).rejects.toThrow(/VITE_EDGE_ORIGIN/);
  });

  it("POSTs the endpoint envelope to the edge origin and parses the JSON", async () => {
    vi.stubEnv("VITE_EDGE_ORIGIN", "https://edge.example.net/");
    const fetchMock = stubFetch(true, 200, { gameCode: "ABC123" });

    expect(await relayRequest("drawphone-new")).toEqual({ gameCode: "ABC123" });
    await relayRequest("netgamesio-new", { urlId: "avalon" });
    await relayRequest("ooc-rocketcrab", { body: { game: "story" } });

    expect(fetchMock.mock.calls[0]![0]).toBe("https://edge.example.net/");
    expect(fetchMock.mock.calls.map(([, init]) => JSON.parse(String(init?.body)))).toEqual([
      { endpoint: "drawphone-new" },
      { endpoint: "netgamesio-new", urlId: "avalon" },
      { endpoint: "ooc-rocketcrab", body: { game: "story" } },
    ]);
  });

  it("surfaces the Worker's structured error message", async () => {
    vi.stubEnv("VITE_EDGE_ORIGIN", "https://edge.example.net");
    stubFetch(false, 502, { error: { code: "upstream_error", message: "upstream HTTP 500" } });
    await expect(relayRequest("snakeout-new")).rejects.toThrow(/upstream HTTP 500/);
    stubFetch(false, 503, "not json");
    await expect(relayRequest("snakeout-new")).rejects.toThrow(/HTTP 503/);
  });
});
