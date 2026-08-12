import { describe, expect, it } from "vitest";
import { runtimeOriginForMainOrigin } from "./runtime-origin";

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
});
