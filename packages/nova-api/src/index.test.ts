import { describe, expect, it } from "vitest";
import { packageName } from "./index";

describe("@rocketcrab/nova-api placeholder", () => {
  it("exports its package name", () => {
    expect(packageName).toBe("@rocketcrab/nova-api");
  });
});
