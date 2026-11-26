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
  });

  it("POSTs the endpoint envelope to the same-origin room API and parses the JSON", async () => {
    const fetchMock = stubFetch(true, 200, { gameCode: "ABC123" });

    expect(await relayRequest("snakeout-new")).toEqual({ gameCode: "ABC123" });
    await relayRequest("netgamesio-new", { urlId: "avalon" });
    await relayRequest("ooc-rocketcrab", { body: { game: "story" } });

    expect(fetchMock.mock.calls[0]![0]).toBe("/api/relay");
    expect(fetchMock.mock.calls.map(([, init]) => JSON.parse(String(init?.body)))).toEqual([
      { endpoint: "snakeout-new" },
      { endpoint: "netgamesio-new", urlId: "avalon" },
      { endpoint: "ooc-rocketcrab", body: { game: "story" } },
    ]);
  });

  it("surfaces the Worker's structured error message", async () => {
    stubFetch(false, 502, { error: { code: "upstream_error", message: "upstream HTTP 500" } });
    await expect(relayRequest("snakeout-new")).rejects.toThrow(/upstream HTTP 500/);
    stubFetch(false, 503, "not json");
    await expect(relayRequest("snakeout-new")).rejects.toThrow(/HTTP 503/);
  });
});
