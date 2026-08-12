import { describe, expect, it, vi } from "vitest";
import { runtimeBasePath, runtimeOriginForMainOrigin } from "./runtime-origin";

describe("runtimeOriginForMainOrigin", () => {
  it("swaps the dev port to the runtime origin", () => {
    expect(runtimeOriginForMainOrigin("http://localhost:5173")).toBe("http://localhost:5174");
    expect(runtimeOriginForMainOrigin("http://127.0.0.1:5173")).toBe("http://127.0.0.1:5174");
  });

  it("prefixes the hostname in production", () => {
    expect(runtimeOriginForMainOrigin("https://nova.example.com")).toBe(
      "https://runtime.nova.example.com",
    );
    expect(runtimeOriginForMainOrigin("https://play.rocketcrab.app")).toBe(
      "https://runtime.play.rocketcrab.app",
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

describe("runtimeBasePath", () => {
  it("defaults to the site root", () => {
    expect(runtimeBasePath()).toBe("/");
  });

  it("honours the VITE_RUNTIME_BASE build-time pin (project-site layouts)", () => {
    vi.stubEnv("VITE_RUNTIME_BASE", "/runtime/");
    try {
      expect(runtimeBasePath()).toBe("/runtime/");
    } finally {
      vi.unstubAllEnvs();
    }
    vi.stubEnv("VITE_RUNTIME_BASE", "runtime");
    try {
      expect(runtimeBasePath()).toBe("/runtime/");
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
