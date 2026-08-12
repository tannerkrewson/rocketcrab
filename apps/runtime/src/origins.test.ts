import { describe, expect, it, vi } from "vitest";
import {
  MAIN_ORIGIN_PORT,
  RUNTIME_ORIGIN_PORT,
  mainOriginForRuntimeOrigin,
  runtimeOriginForMainOrigin,
} from "./origins";

describe("origin derivation (two-origin model)", () => {
  it("swaps ports in dev", () => {
    expect(mainOriginForRuntimeOrigin(`http://localhost:${RUNTIME_ORIGIN_PORT}`)).toBe(
      `http://localhost:${MAIN_ORIGIN_PORT}`,
    );
    expect(runtimeOriginForMainOrigin(`http://localhost:${MAIN_ORIGIN_PORT}`)).toBe(
      `http://localhost:${RUNTIME_ORIGIN_PORT}`,
    );
    expect(mainOriginForRuntimeOrigin(`http://127.0.0.1:${RUNTIME_ORIGIN_PORT}`)).toBe(
      `http://127.0.0.1:${MAIN_ORIGIN_PORT}`,
    );
  });

  it("strips the runtime. hostname prefix in production", () => {
    expect(mainOriginForRuntimeOrigin("https://runtime.nova.example")).toBe("https://nova.example");
    expect(runtimeOriginForMainOrigin("https://nova.example")).toBe("https://runtime.nova.example");
  });

  it("falls back to itself for an unrecognized runtime origin", () => {
    expect(mainOriginForRuntimeOrigin("https://other.example:9999")).toBe(
      "https://other.example:9999",
    );
  });

  it("honours the VITE_MAIN_ORIGIN build-time pin (M2)", () => {
    // Strategies (b)/(c) put the origins on arbitrary hosts, so the
    // `runtime.` prefix derivation cannot apply; the deploy workflow pins
    // the main origin explicitly.
    vi.stubEnv("VITE_MAIN_ORIGIN", "https://nova.example.com");
    try {
      expect(mainOriginForRuntimeOrigin("https://sandbox.example.net")).toBe(
        "https://nova.example.com",
      );
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("honours the VITE_RUNTIME_ORIGIN build-time pin (M2)", () => {
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
