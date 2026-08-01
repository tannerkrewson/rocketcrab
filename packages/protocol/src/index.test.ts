import { describe, expect, it } from "vitest";
import { packageName } from "./index";

describe("@rocketcrab/protocol placeholder", () => {
  it("exports its package name", () => {
    expect(packageName).toBe("@rocketcrab/protocol");
  });
});
