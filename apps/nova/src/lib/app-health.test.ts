import { describe, expect, it } from "vitest";
import { errorName } from "./app-health";

describe("errorName", () => {
  it("keeps error class names and buckets everything else", () => {
    expect(errorName(new TypeError("x is undefined"))).toBe("TypeError");
    class QuotaExceeded extends Error {
      override name = "QuotaExceeded";
    }
    expect(errorName(new QuotaExceeded())).toBe("QuotaExceeded");
    const odd = new Error("boom");
    odd.name = "name with the message: secret";
    expect(errorName(odd)).toBe("Error");
    expect(errorName("a string")).toBe("string");
    expect(errorName(undefined)).toBe("unknown");
  });
});
