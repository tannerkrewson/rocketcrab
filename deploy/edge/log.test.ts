import { afterEach, describe, expect, it, vi } from "vitest";
import edge, { type EdgeEnv } from "./worker";

const event = {
  outcome: "direct",
  error_code: "",
  ms_to_connect: 123,
  signaling_ok: true,
  browser: "safari-ios",
  network: "4g",
  app_version: "1.2.3",
};
const origin = "https://rocketcrab.com";
function call(body: string, env: EdgeEnv, headers: Record<string, string> = {}) {
  return edge.fetch(
    new Request("https://edge.example/log", {
      method: "POST",
      headers: {
        Origin: origin,
        "CF-Connecting-IP": "203.0.113.7",
        ...headers,
      },
      body,
    }),
    env,
  );
}

afterEach(() => vi.restoreAllMocks());

describe("connection events", () => {
  it.each(["direct", "unknown", "lobby-ready", "join-failed", "game-ready"])(
    "logs only documented fields for %s",
    async (outcome) => {
      const log = vi.spyOn(console, "log").mockImplementation(() => {});
      const payload = { ...event, outcome };
      expect((await call(JSON.stringify(payload), { ORIGIN_ALLOWLIST: origin })).status).toBe(204);
      expect(log).toHaveBeenCalledExactlyOnceWith({ event: "nova_connection", ...payload });
    },
  );

  it("rejects invalid, identifying, missing and oversized data", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const env = { ORIGIN_ALLOWLIST: origin };
    for (const body of [
      "oops",
      "[]",
      JSON.stringify({ ...event, room_id: "secret" }),
      JSON.stringify({ ...event, browser: "203.0.113.7" }),
      JSON.stringify({ ...event, app_version: "1.2.3-secret" }),
      JSON.stringify({ ...event, signaling_ok: "true" }),
      JSON.stringify({ ...event, outcome: undefined }),
      JSON.stringify({ ...event, outcome: "Unknown" }),
      JSON.stringify({ ...event, ms_to_connect: -1 }),
      JSON.stringify({ ...event, ms_to_connect: 1.5 }),
    ]) {
      expect((await call(body, env)).status).toBe(400);
    }
    expect((await call("x".repeat(1025), env)).status).toBe(413);
    expect(log).not.toHaveBeenCalled();
  });

  it("gates origin and rate limits independently", async () => {
    const limit = vi.fn(async () => ({ success: false }));
    const env = { ORIGIN_ALLOWLIST: origin, BULK_RATE_LIMITER: { limit } };
    expect(
      (await call(JSON.stringify(event), env, { Origin: "https://evil.example" })).status,
    ).toBe(403);
    expect((await call(JSON.stringify(event), env)).status).toBe(429);
    expect(limit).toHaveBeenCalledWith({ key: "log:203.0.113.7" });
  });
});
