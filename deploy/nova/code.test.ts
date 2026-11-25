import { afterEach, describe, expect, it, vi } from "vitest";
import { CODE_TTL_MS, PartyCode, codeCandidates as derive } from "./code";
import edge, { type EdgeEnv } from "./worker";

const ORIGIN = "https://rocketcrab.com";
const SECRET_A = "A".repeat(43);
const SECRET_B = "B".repeat(43);
const KEY = "test-key";
const codeCandidates = (secret: string) => derive(secret, KEY);

/** PartyCode objects over in-memory storage, keyed by code like the real namespace. */
function codeNamespace() {
  const objects = new Map<string, PartyCode>();
  const alarms = new Map<string, number>();
  const ids: string[] = [];
  const namespace = {
    idFromName: (name: string) => name,
    get: (name: unknown) => {
      const code = String(name);
      ids.push(code);
      let object = objects.get(code);
      if (!object) {
        const data = new Map<string, unknown>();
        object = new PartyCode({
          storage: {
            get: async <T>(key: string) => data.get(key) as T | undefined,
            put: async (key, value) => void data.set(key, structuredClone(value)),
            deleteAll: async () => data.clear(),
            setAlarm: async (time) => void alarms.set(code, time),
          },
        });
        objects.set(code, object);
      }
      return object;
    },
  };
  return { namespace, objects, alarms, ids };
}

function post(path: string, body: unknown, env: EdgeEnv) {
  return edge.fetch(
    new Request(`${ORIGIN}${path}`, {
      method: "POST",
      headers: { Origin: ORIGIN, "CF-Connecting-IP": "203.0.113.7" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    env,
  );
}

async function claim(secret: string, env: EdgeEnv) {
  const response = await post("/api/code/claim", { secret }, env);
  return { status: response.status, body: (await response.json()) as { code?: string } };
}

async function lookup(code: string, env: EdgeEnv) {
  const response = await post("/api/code/lookup", { code }, env);
  return { status: response.status, body: (await response.json()) as { secret?: string } };
}

afterEach(() => vi.useRealTimers());

describe("codeCandidates", () => {
  it("derives the same distinct four-letter codes for a secret, never i, o or l", async () => {
    const codes = await codeCandidates(SECRET_A);
    expect(codes).toEqual(await codeCandidates(SECRET_A));
    expect(codes).not.toEqual(await codeCandidates(SECRET_B));
    expect(codes.length).toBeGreaterThan(4);
    expect(new Set(codes).size).toBe(codes.length);
    for (const code of codes) expect(code).toMatch(/^[a-hjkmnp-z]{4}$/);
  });

  it("depends on the Worker's key, so codes can't be ground offline", async () => {
    expect(await derive(SECRET_A, "other-key")).not.toEqual(await codeCandidates(SECRET_A));
  });
});

describe("party codes", () => {
  it("gives every member the same code and resolves it to the secret", async () => {
    const { namespace } = codeNamespace();
    const env: EdgeEnv = { PARTY_CODE: namespace, CODE_HMAC_SECRET: KEY };
    const first = await claim(SECRET_A, env);
    expect(first.status).toBe(200);
    expect(first.body.code).toBe((await codeCandidates(SECRET_A))[0]);
    expect((await claim(SECRET_A, env)).body.code).toBe(first.body.code);

    const found = await lookup(first.body.code!.toUpperCase(), env);
    expect(found).toEqual({ status: 200, body: { secret: SECRET_A } });
  });

  it("moves a colliding party to its next code", async () => {
    const { namespace } = codeNamespace();
    const env: EdgeEnv = { PARTY_CODE: namespace, CODE_HMAC_SECRET: KEY };
    const [taken, next] = await codeCandidates(SECRET_A);
    // Another party already holds this party's first code.
    await namespace.get(taken).fetch(new Request("https://x/", { method: "PUT", body: SECRET_B }));
    expect((await claim(SECRET_A, env)).body.code).toBe(next);
    expect((await lookup(taken!, env)).body.secret).toBe(SECRET_B);
  });

  it("expires codes that stop being renewed and frees them by alarm", async () => {
    vi.useFakeTimers();
    const { namespace, objects, alarms } = codeNamespace();
    const env: EdgeEnv = { PARTY_CODE: namespace, CODE_HMAC_SECRET: KEY };
    const { code } = (await claim(SECRET_A, env)).body;
    expect(alarms.get(code!)).toBe(Date.now() + CODE_TTL_MS);

    vi.advanceTimersByTime(CODE_TTL_MS - 1);
    expect((await lookup(code!, env)).status).toBe(200);
    // A renewal pushes the deadline out.
    await claim(SECRET_A, env);
    vi.advanceTimersByTime(CODE_TTL_MS - 1);
    expect((await lookup(code!, env)).status).toBe(200);

    vi.advanceTimersByTime(1);
    expect((await lookup(code!, env)).status).toBe(404);
    await objects.get(code!)!.alarm();
    // An expired code goes to the next party that derives it.
    await namespace.get(code).fetch(new Request("https://x/", { method: "PUT", body: SECRET_B }));
    expect((await lookup(code!, env)).body.secret).toBe(SECRET_B);
  });

  it("rejects malformed input before touching a code object", async () => {
    const { namespace, ids } = codeNamespace();
    const env: EdgeEnv = { PARTY_CODE: namespace, CODE_HMAC_SECRET: KEY };
    expect((await post("/api/code/claim", { secret: "short" }, env)).status).toBe(400);
    expect((await post("/api/code/claim", "not json", env)).status).toBe(400);
    expect((await post("/api/code/lookup", { code: "abc1" }, env)).status).toBe(400);
    expect((await post("/api/code/lookup", { code: "x".repeat(300) }, env)).status).toBe(400);
    // Letters and words codes never use.
    expect((await lookup("ilox", env)).status).toBe(404);
    expect((await lookup("join", env)).status).toBe(404);
    expect(ids).toEqual([]);
    expect((await lookup("zzzz", env)).status).toBe(404);
  });

  it("answers 503 without the binding or key and rate limits claims and lookups separately", async () => {
    expect((await claim(SECRET_A, { CODE_HMAC_SECRET: KEY })).status).toBe(503);
    const { namespace, ids } = codeNamespace();
    expect((await claim(SECRET_A, { PARTY_CODE: namespace, CODE_HMAC_SECRET: " " })).status).toBe(
      503,
    );
    expect(ids).toEqual([]);
    const keys: string[] = [];
    const env: EdgeEnv = {
      RATE_LIMITER: {
        limit: async ({ key }) => {
          keys.push(key);
          return { success: false };
        },
      },
    };
    expect((await claim(SECRET_A, env)).status).toBe(429);
    expect((await lookup("abcd", env)).status).toBe(429);
    expect(keys).toEqual(["code-claim:203.0.113.7", "code-lookup:203.0.113.7"]);
  });

  it("requires a same-origin request", async () => {
    const response = await edge.fetch(
      new Request(`${ORIGIN}/api/code/lookup`, {
        method: "POST",
        headers: { Origin: "https://elsewhere.example" },
        body: JSON.stringify({ code: "abcd" }),
      }),
      {},
    );
    expect(response.status).toBe(403);
  });
});
