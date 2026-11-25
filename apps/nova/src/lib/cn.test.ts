import { describe, expect, it } from "vitest";
import { cn } from "./cn";

describe("cn", () => {
  it("joins class names", () => {
    expect(cn("a", "b", undefined, null, false, "c")).toBe("a b c");
  });

  it("lets later conflicting classes win", () => {
    expect(cn("p-2", "p-4")).toBe("p-4");
  });
});
