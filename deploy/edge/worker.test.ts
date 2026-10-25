import { describe, expect, it } from "vitest";
import edgeWorker from "./worker";

const ORIGIN = "https://rocketcrab.com";

function request(path: string, init: RequestInit = {}): Request {
  return new Request(`https://edge.example${path}`, {
    ...init,
    headers: { Origin: ORIGIN, "Content-Type": "application/json", ...init.headers },
  });
}

describe("edge Worker dispatch", () => {
  it("routes /turn to the TURN mint (misconfigured without secrets)", async () => {
    const response = await edgeWorker.fetch(request("/turn", { method: "POST", body: "{}" }), {});
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ error: { code: "worker_misconfigured" } });
    expect(response.headers.get("access-control-allow-origin")).toBe(ORIGIN);
  });

  it("accepts a trailing slash on the TURN path", async () => {
    const response = await edgeWorker.fetch(request("/turn/", { method: "POST", body: "{}" }), {});
    expect(response.status).toBe(500);
  });

  it("answers TURN CORS preflight without touching upstream", async () => {
    const response = await edgeWorker.fetch(request("/turn", { method: "OPTIONS" }), {});
    expect(response.status).toBe(204);
  });

  it("routes every other path to the scoped relay", async () => {
    const invalidJson = await edgeWorker.fetch(
      request("/", { method: "POST", body: "not json" }),
      {},
    );
    expect(invalidJson.status).toBe(400);
    expect(await invalidJson.json()).toMatchObject({ error: { code: "invalid_json" } });

    const unknown = await edgeWorker.fetch(
      request("/", { method: "POST", body: JSON.stringify({ endpoint: "nope" }) }),
      {},
    );
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toMatchObject({ error: { code: "unknown_endpoint" } });
  });

  it("uses independent rate-limit counters for TURN and the Classic relay", async () => {
    const keys: string[] = [];
    const env = {
      RATE_LIMITER: {
        limit: async ({ key }: { key: string }) => {
          keys.push(key);
          return { success: true };
        },
      },
    };
    const req = (path: string, body: string) =>
      new Request(`https://edge.example${path}`, {
        method: "POST",
        headers: {
          Origin: ORIGIN,
          "Content-Type": "application/json",
          "CF-Connecting-IP": "203.0.113.7",
        },
        body,
      });

    await edgeWorker.fetch(req("/turn", "{}"), env);
    await edgeWorker.fetch(req("/", "not json"), env);

    // Different keys in the same binding => independent counters. A TURN
    // join burst cannot consume the Classic relay's per-IP budget.
    expect(keys).toEqual(["turn:203.0.113.7", "relay:203.0.113.7"]);
  });

  it("returns 404 for unknown paths instead of routing them to the relay", async () => {
    for (const path of ["/turn/extra", "/anything"]) {
      const response = await edgeWorker.fetch(
        request(path, { method: "POST", body: JSON.stringify({ endpoint: "drawphone-new" }) }),
        {},
      );
      expect(response.status).toBe(404);
      expect(await response.json()).toMatchObject({ error: { code: "not_found" } });
    }
  });

  it("rejects a missing Origin on both endpoints before any work", async () => {
    for (const path of ["/", "/turn"]) {
      const response = await edgeWorker.fetch(
        new Request(`https://edge.example${path}`, { method: "POST", body: "{}" }),
        {},
      );
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ error: { code: "origin_not_allowed" } });
    }
  });
});
