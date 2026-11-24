import { describe, expect, it } from "vitest";
import { formatPlayerRange, playerLimitNotice, playerLimitsOf } from "./player-limits";

describe("playerLimitNotice", () => {
  it("is silent inside the range or without limits", () => {
    expect(playerLimitNotice(3, {})).toBeNull();
    expect(playerLimitNotice(3, { minPlayers: 2, maxPlayers: 4 })).toBeNull();
    expect(playerLimitNotice(4, { minPlayers: 4, maxPlayers: 4 })).toBeNull();
  });

  it("asks for more players below the minimum", () => {
    expect(playerLimitNotice(1, { minPlayers: 3 })).toBe(
      "This game needs at least 3 players. Invite 2 more.",
    );
  });

  it("says when the party is over the maximum", () => {
    expect(playerLimitNotice(9, { maxPlayers: 8 })).toBe(
      "This game supports at most 8 players. The party has 9.",
    );
  });

  it("ignores an infinite or invalid maximum", () => {
    expect(playerLimitNotice(500, { maxPlayers: Number.POSITIVE_INFINITY })).toBeNull();
    expect(playerLimitsOf({ minPlayers: 0, maxPlayers: 2.5 })).toEqual({});
  });
});

describe("formatPlayerRange", () => {
  it("formats each combination", () => {
    expect(formatPlayerRange({ minPlayers: 2, maxPlayers: 8 })).toBe("2–8");
    expect(formatPlayerRange({ minPlayers: 4, maxPlayers: 4 })).toBe("4");
    expect(formatPlayerRange({ minPlayers: 3 })).toBe("3+");
    expect(formatPlayerRange({ minPlayers: 1, maxPlayers: Infinity })).toBe("1+");
    expect(formatPlayerRange({ maxPlayers: 6 })).toBe("Up to 6");
    expect(formatPlayerRange({})).toBeUndefined();
  });
});
