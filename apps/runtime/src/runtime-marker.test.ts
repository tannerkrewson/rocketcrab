import { describe, expect, it } from "vitest";
import { createRuntimeMarker } from "./runtime-marker";

describe("createRuntimeMarker", () => {
  it("creates the runtime placeholder marker", () => {
    const el = createRuntimeMarker();
    expect(el.id).toBe("nova-runtime");
    expect(el.textContent).toContain("runtime origin placeholder");
  });
});
