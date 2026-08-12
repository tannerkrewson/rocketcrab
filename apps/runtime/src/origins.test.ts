import { describe, expect, it } from "vitest";
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
});
