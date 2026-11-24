import { beforeEach, describe, expect, it } from "vitest";
import {
  getSavedPlayerName,
  localPartyIdentity,
  resetPartyIdentityForTests,
  setSavedPlayerName,
  updatePartyDisplayName,
} from "./identity";

describe("party identity", () => {
  beforeEach(() => {
    resetPartyIdentityForTests();
  });

  it("migrates a saved name and removes the legacy identity", () => {
    window.localStorage.setItem(
      "nova:party:identity:v1",
      JSON.stringify({ memberId: "old-id", displayName: "Ada" }),
    );
    expect(getSavedPlayerName()).toBe("Ada");
    expect(window.localStorage.getItem("nova:party:identity:v1")).toBeNull();
    expect(localPartyIdentity()).toMatchObject({ displayName: "Ada" });
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
