import { describe, expect, it } from "vitest";
import {
  GameRepositoryError,
  gameMatchesQuery,
  isGameRepositoryError,
  type SavedGame,
} from "./repository";

/**
 * Contract-level tests for the shared repository types (U2). The full
 * behavior of a {@link GameRepository} implementation (create/read/update/
 * delete/duplicate/list/search/recordTestResults) is exercised against the
 * Dexie implementation in apps/nova, which also owns the IndexedDB access.
 */

function makeGame(overrides: Partial<SavedGame> = {}): SavedGame {
  return {
    id: "game_1",
    title: "Rocket Rumble",
    html: "<p>hi</p>",
    sourceHash: "a".repeat(64),
    sourceBytes: 8,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe("GameRepositoryError", () => {
  it("carries its code and keeps the standard Error shape", () => {
    const error = new GameRepositoryError("not_found", 'No saved game with id "game_x".');
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("GameRepositoryError");
    expect(error.code).toBe("not_found");
    expect(error.message).toBe('No saved game with id "game_x".');
  });

  it("preserves the underlying cause for diagnostics", () => {
    const cause = new Error("quota");
    const error = new GameRepositoryError("quota_exceeded", "Storage full.", { cause });
    expect(error.cause).toBe(cause);
  });

  it("is recognized by its type guard", () => {
    const error = new GameRepositoryError("unknown", "boom");
    expect(isGameRepositoryError(error)).toBe(true);
    expect(isGameRepositoryError(new Error("boom"))).toBe(false);
    expect(isGameRepositoryError(undefined)).toBe(false);
  });
});

describe("gameMatchesQuery", () => {
  it("matches title and description case-insensitively", () => {
    const game = makeGame({ title: "Rocket Rumble", description: "Fight in space" });
    expect(gameMatchesQuery(game, "rocket")).toBe(true);
    expect(gameMatchesQuery(game, "SPACE")).toBe(true);
    expect(gameMatchesQuery(game, "cards")).toBe(false);
  });

  it("matches title when there is no description", () => {
    const game = makeGame({ title: "Card Sharks" });
    expect(gameMatchesQuery(game, "sharks")).toBe(true);
    expect(gameMatchesQuery(game, "table")).toBe(false);
  });

  it("treats an empty or whitespace query as match-all", () => {
    const game = makeGame({ title: "Anything" });
    expect(gameMatchesQuery(game, "")).toBe(true);
    expect(gameMatchesQuery(game, "   ")).toBe(true);
  });
});
