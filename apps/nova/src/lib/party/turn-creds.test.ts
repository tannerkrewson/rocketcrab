import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchTurnCredentials,
  turnCredsBaseUrl,
  turnCredsConfigured,
  type TurnCredentialsResult,
} from "./turn-creds";

/**
 * TURN credential mint client tests (beads rocketcrab-23s, P0). The client
 * (apps/nova/src/lib/party/turn-creds.ts) fetches short-lived credentials
 * from the mint at party-join time; the fetch is mocked (relay.test.ts
 * pattern). The mint origin comes from the VITE_TURN_CREDS_ORIGIN build-time
 * env (same pattern as VITE_CLASSIC_RELAY_ORIGIN) and is empty when the
 * build pins no origin — then no fetch happens at all.
 */

const MINT_ORIGIN = "https://turn-creds.example.workers.dev";

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
  ttl: 600,
};

function responseMock(status: number, body: unknown) {
  return vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }));
}

describe("turnCredsBaseUrl / turnCredsConfigured", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("defaults to unconfigured (no VITE_TURN_CREDS_ORIGIN)", () => {
    expect(turnCredsBaseUrl()).toBe("");
    expect(turnCredsConfigured()).toBe(false);
  });

  it("honours the VITE_TURN_CREDS_ORIGIN build-time pin", () => {
    vi.stubEnv("VITE_TURN_CREDS_ORIGIN", MINT_ORIGIN);
    expect(turnCredsBaseUrl()).toBe(MINT_ORIGIN);
    expect(turnCredsConfigured()).toBe(true);
  });

  it("trims whitespace from the pinned origin", () => {
    vi.stubEnv("VITE_TURN_CREDS_ORIGIN", `  ${MINT_ORIGIN}  `);
    expect(turnCredsBaseUrl()).toBe(MINT_ORIGIN);
  });
});

describe("fetchTurnCredentials", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("never fetches when the build pins no mint origin", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const result = await fetchTurnCredentials();
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) {
      expect(result.reason).toMatch(/VITE_TURN_CREDS_ORIGIN/);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("POSTs to the mint origin root and returns only credential-bearing entries as turnConfig", async () => {
    vi.stubEnv("VITE_TURN_CREDS_ORIGIN", MINT_ORIGIN);
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
    expect(url).toBe(`${MINT_ORIGIN}/`);
    expect(init?.method).toBe("POST");
  });

  it("passes through entries whose urls is a single string", async () => {
    vi.stubEnv("VITE_TURN_CREDS_ORIGIN", MINT_ORIGIN);
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

  it("returns ok with an empty turnConfig when every entry is STUN-only", async () => {
    vi.stubEnv("VITE_TURN_CREDS_ORIGIN", MINT_ORIGIN);
    vi.stubGlobal(
      "fetch",
      responseMock(200, { iceServers: [{ urls: "stun:stun.example.com:19302" }] }),
    );
    const result = await fetchTurnCredentials();
    expect(result).toEqual({ ok: true, turnConfig: [] });
  });

  it("degrades on a non-2xx response (403 origin / 5xx mint outage)", async () => {
    vi.stubEnv("VITE_TURN_CREDS_ORIGIN", MINT_ORIGIN);
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
    vi.stubEnv("VITE_TURN_CREDS_ORIGIN", MINT_ORIGIN);
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
    vi.stubEnv("VITE_TURN_CREDS_ORIGIN", MINT_ORIGIN);
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
    vi.stubEnv("VITE_TURN_CREDS_ORIGIN", MINT_ORIGIN);
    vi.stubGlobal("fetch", responseMock(200, { nope: 1 }));
    const result = await fetchTurnCredentials();
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) {
      expect(result.reason).toMatch(/unexpected response shape/);
    }
  });

  it("degrades on timeout (aborts the fetch and never throws)", async () => {
    vi.stubEnv("VITE_TURN_CREDS_ORIGIN", MINT_ORIGIN);
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
    vi.stubEnv("VITE_TURN_CREDS_ORIGIN", MINT_ORIGIN);
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
