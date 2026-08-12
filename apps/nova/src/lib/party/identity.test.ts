import { beforeEach, describe, expect, it } from "vitest";
import {
  getSavedPlayerName,
  localPartyIdentity,
  resetPartyIdentityForTests,
  setSavedPlayerName,
  updatePartyDisplayName,
} from "./identity";

/**
 * Party identity tests (P4/M1): the member identity is generated once and
 * persisted locally so a reloaded Mobile Safari tab rejoins the party as
 * the same member (ADR-0007, ADR-0012). The player's chosen name (7.5) is
 * stored separately and preferred over the generated name.
 */
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

  it("uses the saved player name as the display name (7.5)", () => {
    setSavedPlayerName("Ada");
    expect(localPartyIdentity().displayName).toBe("Ada");
    expect(getSavedPlayerName()).toBe("Ada");
  });

  it("generates a fallback name when the player never set one (7.5)", () => {
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
    // Blank names are rejected.
    expect(updatePartyDisplayName("   ")).toBeNull();
  });
});
