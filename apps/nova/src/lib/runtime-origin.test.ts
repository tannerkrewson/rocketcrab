import { describe, expect, it, vi } from "vitest";
import { runtimeOriginForMainOrigin } from "./runtime-origin";

describe("runtimeOriginForMainOrigin", () => {
  it("swaps the dev port to the runtime origin", () => {
    expect(runtimeOriginForMainOrigin("http://localhost:5173")).toBe("http://localhost:5174");
    expect(runtimeOriginForMainOrigin("http://127.0.0.1:5173")).toBe("http://127.0.0.1:5174");
  });

  it("requires a pin outside localhost", () => {
    expect(() => runtimeOriginForMainOrigin("https://nova.example.com")).toThrow(
      "VITE_RUNTIME_ORIGIN must be set",
    );
  });

  it("honours the VITE_RUNTIME_ORIGIN build-time pin (M2)", () => {
    // The derivation cannot express arbitrary origin pairs (two-account or
    // alternate-host strategies); the deploy workflow pins the origin.
    vi.stubEnv("VITE_RUNTIME_ORIGIN", "https://sandbox.example.net");
    try {
      expect(runtimeOriginForMainOrigin("https://nova.example.com")).toBe(
        "https://sandbox.example.net",
      );
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
