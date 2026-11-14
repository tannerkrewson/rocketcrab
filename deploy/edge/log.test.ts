import { describe, expect, it, vi } from "vitest";
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

describe("connection events", () => {
  it("writes only the documented fields and no IP", async () => {
    const writeDataPoint = vi.fn();
    const response = await call(JSON.stringify(event), {
      ORIGIN_ALLOWLIST: origin,
      CONNECTION_EVENTS: { writeDataPoint },
    });
    expect(response.status).toBe(204);
    expect(writeDataPoint).toHaveBeenCalledExactlyOnceWith({
      blobs: ["direct", "", "true", "safari-ios", "4g", "1.2.3"],
      doubles: [123],
    });
  });
  it("accepts the unknown outcome with validated connect time and writes it", async () => {
    const writeDataPoint = vi.fn();
    const env = {
      ORIGIN_ALLOWLIST: origin,
      CONNECTION_EVENTS: { writeDataPoint },
    };
    const response = await call(JSON.stringify({ ...event, outcome: "unknown" }), env);
    expect(response.status).toBe(204);
    expect(writeDataPoint).toHaveBeenCalledExactlyOnceWith({
      blobs: ["unknown", "", "true", "safari-ios", "4g", "1.2.3"],
      doubles: [123],
    });
    for (const body of [
      JSON.stringify({ ...event, outcome: "unknown", ms_to_connect: -1 }),
      JSON.stringify({ ...event, outcome: "unknown", ms_to_connect: 1.5 }),
      JSON.stringify({ ...event, outcome: "unknowns" }),
      JSON.stringify({ ...event, outcome: "Unknown" }),
    ]) {
      expect((await call(body, env)).status).toBe(400);
    }
    expect(writeDataPoint).toHaveBeenCalledOnce();
  });
  it("rejects invalid, identifying, missing and oversized data", async () => {
    const writeDataPoint = vi.fn();
    const env = {
      ORIGIN_ALLOWLIST: origin,
      CONNECTION_EVENTS: { writeDataPoint },
    };
    for (const body of [
      "oops",
      "[]",
      JSON.stringify({ ...event, room_id: "secret" }),
      JSON.stringify({ ...event, browser: "203.0.113.7" }),
      JSON.stringify({ ...event, app_version: "1.2.3-secret" }),
      JSON.stringify({ ...event, ms_to_connect: -1 }),
      JSON.stringify({ ...event, signaling_ok: "true" }),
      JSON.stringify({ ...event, outcome: undefined }),
    ]) {
      expect((await call(body, env)).status).toBe(400);
    }
    expect((await call("x".repeat(1025), env)).status).toBe(413);
    expect(writeDataPoint).not.toHaveBeenCalled();
  });
  it("gates origin, rate limits independently and reports missing or broken binding", async () => {
    const limit = vi.fn(async () => ({ success: false }));
    const env = { ORIGIN_ALLOWLIST: origin, RATE_LIMITER: { limit } };
    expect(
      (
        await call(JSON.stringify(event), env, {
          Origin: "https://evil.example",
        })
      ).status,
    ).toBe(403);
    expect((await call(JSON.stringify(event), env)).status).toBe(429);
    expect(limit).toHaveBeenCalledWith({ key: "log:203.0.113.7" });
    expect((await call(JSON.stringify(event), { ORIGIN_ALLOWLIST: origin })).status).toBe(503);
    expect(
      (
        await call(JSON.stringify(event), {
          ORIGIN_ALLOWLIST: origin,
          CONNECTION_EVENTS: {
            writeDataPoint: () => {
              throw new Error();
            },
          },
        })
      ).status,
    ).toBe(503);
  });
});
