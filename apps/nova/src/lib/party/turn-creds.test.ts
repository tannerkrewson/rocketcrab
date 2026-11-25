import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchTurnCredentials, TURN_CREDS_TTL_MS, type TurnCredentialsResult } from "./turn-creds";

/** TURN mint client tests use mocked fetches. */

/** A 200 mint response body in Cloudflare's standard shape. */
const MINTED_BODY = {
  iceServers: [
    {
      urls: [
        "stun:turn.cloudflare.com:3478?transport=udp",
        "turn:turn.cloudflare.com:3478?transport=udp",
        "turns:turn.cloudflare.com:5349|443?transport=tcp",
      ],
      username: "u1",
      credential: "c1",
    },
    // Plain STUN entries (no credentials) must be dropped — see the module doc.
    { urls: "stun:stun.example.com:19302" },
  ],
  ttl: 86_400,
};

function responseMock(status: number, body: unknown) {
  return vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }));
}

it("keeps one party credential inside Cloudflare's 48-hour maximum", () => {
  expect(TURN_CREDS_TTL_MS).toBe(14_400_000);
  expect(TURN_CREDS_TTL_MS).toBeLessThanOrEqual(48 * 60 * 60 * 1000);
});

describe("fetchTurnCredentials", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs to the same-origin TURN API and returns only credential-bearing entries as turnConfig", async () => {
    const fetchMock = responseMock(200, MINTED_BODY);
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchTurnCredentials();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.turnConfig).toEqual([
        {
          urls: [
            "stun:turn.cloudflare.com:3478?transport=udp",
            "turn:turn.cloudflare.com:3478?transport=udp",
            "turns:turn.cloudflare.com:5349|443?transport=tcp",
          ],
          username: "u1",
          credential: "c1",
        },
      ]);
    }

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/turn");
    expect(init?.method).toBe("POST");
  });

  it("passes through entries whose urls is a single string", async () => {
    vi.stubGlobal(
      "fetch",
      responseMock(200, {
        iceServers: [
          { urls: "turn:turn.cloudflare.com:3478?transport=udp", username: "u2", credential: "c2" },
        ],
      }),
    );
    const result = await fetchTurnCredentials();
    expect(result).toEqual({
      ok: true,
      turnConfig: [
        { urls: "turn:turn.cloudflare.com:3478?transport=udp", username: "u2", credential: "c2" },
      ],
    });
  });

  it("reports unavailability instead of falsely configured TURN for a STUN-only response", async () => {
    vi.stubGlobal(
      "fetch",
      responseMock(200, { iceServers: [{ urls: "stun:stun.example.com:19302" }] }),
    );
    const result = await fetchTurnCredentials();
    expect(result).toEqual({ ok: false, reason: "the mint returned no usable TURN servers." });
  });

  it.each([null, false, 42, "not-an-object"])(
    "degrades on a primitive JSON body: %j",
    async (body) => {
      vi.stubGlobal("fetch", responseMock(200, body));
      await expect(fetchTurnCredentials()).resolves.toMatchObject({ ok: false });
    },
  );

  it("degrades on a non-2xx response (403 origin / 5xx mint outage)", async () => {
    vi.stubGlobal("fetch", responseMock(403, { error: { code: "origin_not_allowed" } }));
    let result = await fetchTurnCredentials();
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) {
      expect(result.reason).toMatch(/HTTP 403/);
    }

    vi.stubGlobal("fetch", responseMock(502, { error: { code: "upstream_error" } }));
    result = await fetchTurnCredentials();
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) {
      expect(result.reason).toMatch(/HTTP 502/);
    }
  });

  it("degrades on a network error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network unreachable");
      }),
    );
    const result = await fetchTurnCredentials();
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) {
      expect(result.reason).toMatch(/network unreachable/);
    }
  });

  it("degrades when the response is not JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError("Unexpected token");
        },
      })),
    );
    const result = await fetchTurnCredentials();
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) {
      expect(result.reason).toMatch(/non-JSON/);
    }
  });

  it("degrades when the response shape is unexpected (no iceServers array)", async () => {
    vi.stubGlobal("fetch", responseMock(200, { nope: 1 }));
    const result = await fetchTurnCredentials();
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) {
      expect(result.reason).toMatch(/unexpected response shape/);
    }
  });

  it("degrades on timeout (aborts the fetch and never throws)", async () => {
    // A fetch that only settles when the abort signal fires: the real
    // timeout aborts it, exactly like a hung mint in production.
    const hangingFetch = vi.fn(
      (_url: RequestInfo | URL, init?: RequestInit) =>
        new Promise<never>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("Aborted")));
        }),
    );
    vi.stubGlobal("fetch", hangingFetch);
    const result = await fetchTurnCredentials({ timeoutMs: 20 });
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) {
      expect(result.reason).toMatch(/did not respond within 20 ms/);
    }
    expect(hangingFetch).toHaveBeenCalledTimes(1);
  });

  it("drops malformed entries but still succeeds (per-entry degradation)", async () => {
    vi.stubGlobal(
      "fetch",
      responseMock(200, {
        iceServers: [
          { urls: "turn:turn.cloudflare.com:3478?transport=udp", username: "u3", credential: "c3" },
          { urls: 42, username: "x", credential: "y" },
          null,
          { urls: ["turn:turn.cloudflare.com:3478?transport=udp"], username: "u4", credential: "" },
        ],
      }),
    );
    const result: TurnCredentialsResult = await fetchTurnCredentials();
    expect(result).toEqual({
      ok: true,
      turnConfig: [
        { urls: "turn:turn.cloudflare.com:3478?transport=udp", username: "u3", credential: "c3" },
      ],
    });
  });
});
