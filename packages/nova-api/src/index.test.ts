/**
 * Package surface checks (S1): the exported API matches the documented
 * manifest, the game-facing object exposes exactly the documented surface,
 * and the surface carries no game-hosting, deployment, authority, or
 * transport concepts (S1 acceptance: the API has no game-hosting or
 * deployment concept; no Trystero terminology; no authority roles). The
 * docs markdown itself is written from these source types (see docs/api/),
 * and the runtime bridge parity test asserts the injected `window.nova`
 * script exposes the same surface manifest.
 */
import { describe, expect, it } from "vitest";
import { createNovaClient, type NovaClientBackend, type NovaSessionEvent } from "./client";
import { NOVA_API_SURFACE, isForbiddenSurfaceName } from "./constants";
import { NOVA_ERROR_CODES } from "./errors";
import { NOVA_API_VERSION, SUPPORTED_API_VERSIONS } from "./version";

function fakeBackend(): NovaClientBackend {
  const listeners = new Set<(event: NovaSessionEvent) => void>();
  return {
    apiVersion: NOVA_API_VERSION,
    self: null,
    register() {},
    ready() {},
    dispatch() {
      return Promise.resolve();
    },
    createRawChannel() {},
    closeRawChannel() {},
    sendRaw() {},
    registerSimulation() {},
    sendSimulationInput() {},
    onEvent(handler) {
      listeners.add(handler);
      return () => {
        listeners.delete(handler);
      };
    },
  };
}

describe("nova-api package surface", () => {
  it("exports the documented public API", async () => {
    const api = await import("./index");
    const expected = [
      "NOVA_API_VERSION",
      "SUPPORTED_API_VERSIONS",
      "isSupportedApiVersion",
      "NovaError",
      "NOVA_ERROR_CODES",
      "NOVA_PROTOCOL_CHANNEL",
      "NOVA_API_SURFACE",
      "createNovaClient",
      "createNovaSession",
      "NovaSession",
      "NovaStateEngine",
      "LocalGameExecutor",
      "MINIMAL_GAME_EXAMPLE",
      "STATE_MODE_EXAMPLE",
      "SIMULATION_MODE_EXAMPLE",
      "RAW_MODE_EXAMPLE",
    ];
    for (const name of expected) {
      expect(api[name as keyof typeof api], `missing export ${name}`).toBeDefined();
    }
  });

  it("exposes exactly the documented surface on the game-facing object", () => {
    const client = createNovaClient(fakeBackend());
    const keys = Object.keys(client).sort();
    expect(keys).toEqual([...NOVA_API_SURFACE, "dispose"].sort());
  });

  it("has no game-hosting, deployment, authority, or transport concepts", () => {
    expect(NOVA_API_SURFACE.length).toBeGreaterThan(0);
    for (const name of NOVA_API_SURFACE) {
      expect(isForbiddenSurfaceName(name), `surface member "${name}"`).toBe(false);
    }
    // No authority or hosting vocabulary anywhere in the surface names.
    for (const name of NOVA_API_SURFACE) {
      expect(name).not.toMatch(/authority|host|deploy|server|trystero/i);
    }
  });

  it("documents stable error codes", () => {
    expect(NOVA_ERROR_CODES.not_started).toBe("not_started");
    expect(NOVA_ERROR_CODES.unsupported_api_version).toBe("unsupported_api_version");
    expect(NOVA_ERROR_CODES.unknown_method).toBe("unknown_method");
    expect(Object.keys(NOVA_ERROR_CODES).length).toBeGreaterThanOrEqual(14);
  });

  it("documents a single supported API version", () => {
    expect(NOVA_API_VERSION).toBe(1);
    expect(SUPPORTED_API_VERSIONS).toEqual([1]);
  });
});
