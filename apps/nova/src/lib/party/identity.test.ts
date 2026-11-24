import { beforeEach, describe, expect, it } from "vitest";
import {
  getSavedPlayerName,
  localPartyIdentity,
  resetPartyIdentityForTests,
  setSavedPlayerName,
  updatePartyDisplayName,
} from "./identity";

/** Persist identity across reloads, separately from the chosen name. */
describe("party identity", () => {
  beforeEach(() => {
    resetPartyIdentityForTests();
  });

  it("generates a stable identity and reuses it across page loads", () => {
    const first = localPartyIdentity();
    expect(first.memberId).toMatch(/^member-[0-9a-f]{8}$/);
    expect(first.displayName.length).toBeGreaterThan(0);
    // The identity is persisted, so a page reload (fresh module state, same
    // localStorage) returns the same member. Simulate: clear the in-module
    // cache, restore the persisted value, and load again.
    const stored = window.localStorage.getItem("nova:party:identity:v1");
    expect(stored).not.toBeNull();
    resetPartyIdentityForTests();
    window.localStorage.setItem("nova:party:identity:v1", stored as string);
    const second = localPartyIdentity();
    expect(second).toEqual(first);
  });

  it("reuses the cached identity within a page", () => {
    const first = localPartyIdentity();
    expect(localPartyIdentity()).toEqual(first);
  });

  it("uses the saved player name as the display name", () => {
    setSavedPlayerName("Ada");
    expect(localPartyIdentity().displayName).toBe("Ada");
    expect(getSavedPlayerName()).toBe("Ada");
  });

  it("generates a fallback name when the player never set one", () => {
    expect(getSavedPlayerName()).toBeNull();
    expect(localPartyIdentity().displayName).toMatch(/^Player [A-F0-9]{4}$/);
  });

  it("updatePartyDisplayName persists the change and updates the identity", () => {
    const before = localPartyIdentity();
    const updated = updatePartyDisplayName("Grace");
    expect(updated).not.toBeNull();
    expect(updated?.memberId).toBe(before.memberId);
    expect(updated?.displayName).toBe("Grace");
    expect(getSavedPlayerName()).toBe("Grace");
    expect(localPartyIdentity().displayName).toBe("Grace");
    expect(updatePartyDisplayName("   ")).toBeNull();
  });
});
