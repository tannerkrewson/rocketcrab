import { describe, expect, it, vi } from "vitest";
import { MAIN_ORIGIN_PORT, RUNTIME_ORIGIN_PORT, mainOriginForRuntimeOrigin } from "./origins";

describe("runtime bootstrap origin", () => {
  it("swaps ports on localhost", () => {
    expect(mainOriginForRuntimeOrigin(`http://localhost:${RUNTIME_ORIGIN_PORT}`)).toBe(
      `http://localhost:${MAIN_ORIGIN_PORT}`,
    );
    expect(mainOriginForRuntimeOrigin(`http://127.0.0.1:${RUNTIME_ORIGIN_PORT}`)).toBe(
      `http://127.0.0.1:${MAIN_ORIGIN_PORT}`,
    );
  });

  it("requires a pin outside localhost", () => {
    expect(() => mainOriginForRuntimeOrigin("https://runtime.example.com")).toThrow(
      "VITE_MAIN_ORIGIN must be set",
    );
  });

  it("honours the VITE_MAIN_ORIGIN build-time pin", () => {
    vi.stubEnv("VITE_MAIN_ORIGIN", "https://nova.example.com");
    try {
      expect(mainOriginForRuntimeOrigin("https://sandbox.example.net")).toBe(
        "https://nova.example.com",
      );
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
