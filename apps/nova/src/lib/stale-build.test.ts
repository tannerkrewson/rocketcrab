import { afterEach, describe, expect, it, vi } from "vitest";
import { reloadForNewBuild } from "./stale-build";

afterEach(() => {
  sessionStorage.clear();
  vi.unstubAllGlobals();
});

describe("reloadForNewBuild", () => {
  it("reloads once, then lets a repeat failure surface instead of looping", () => {
    const reload = vi.fn();
    vi.stubGlobal("location", { ...window.location, reload });
    expect(reloadForNewBuild(100_000)).toBe(true);
    expect(reloadForNewBuild(110_000)).toBe(false);
    expect(reload).toHaveBeenCalledOnce();
    // Much later, another deploy may have happened.
    expect(reloadForNewBuild(200_000)).toBe(true);
    expect(reload).toHaveBeenCalledTimes(2);
  });
});
