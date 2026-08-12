import { describe, expect, it } from "vitest";
import { normalizeBasePath } from "./basepath";

describe("normalizeBasePath", () => {
  it("keeps the root base", () => {
    expect(normalizeBasePath("/")).toBe("/");
    expect(normalizeBasePath("")).toBe("/");
  });

  it("strips the trailing slash for project-site bases", () => {
    expect(normalizeBasePath("/nova/")).toBe("/nova");
    expect(normalizeBasePath("nova")).toBe("/nova");
    expect(normalizeBasePath("/play/")).toBe("/play");
  });
});
