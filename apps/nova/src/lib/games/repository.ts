import Dexie from "dexie";
import { nanoid } from "nanoid";
import {
  GameRepositoryError,
  gameMatchesQuery,
  type CreateSavedGameInput,
  type DuplicateSavedGameInput,
  type GameRepository,
  type SavedGame,
  type TestResultsInput,
  type UpdateSavedGameInput,
} from "@rocketcrab/core";
import type { GamesDatabase } from "./db";
import { hashSource, sourceByteLength } from "./hashing";

/** Prefix for locally generated game ids (nanoid, non-cryptographic). */
export const GAME_ID_PREFIX = "game_";

/** Sort helper: most recently updated first, ties by creation time. */
function byRecentFirst(a: SavedGame, b: SavedGame): number {
  return b.updatedAt - a.updatedAt || b.createdAt - a.createdAt;
}

function isNamedError(error: unknown, name: string): boolean {
  return error instanceof Error && error.name === name;
}

/**
 * Map a raw IndexedDB/Dexie failure onto {@link GameRepositoryError} so
 * callers never see implementation-specific exceptions. A failed write
 * (e.g. quota) must surface as `quota_exceeded`: the database transaction is
 * atomic, so the prior saved version is always preserved.
 */
function toRepositoryError(error: unknown, operation: string): GameRepositoryError {
  if (error instanceof GameRepositoryError) return error;
  if (error instanceof Dexie.QuotaExceededError || isNamedError(error, "QuotaExceededError")) {
    return new GameRepositoryError(
      "quota_exceeded",
      "Could not save the game — your browser's local storage is full. The previous version was kept.",
      { cause: error },
    );
  }
  if (
    error instanceof Dexie.OpenFailedError ||
    error instanceof Dexie.DatabaseClosedError ||
    isNamedError(error, "OpenFailedError") ||
    isNamedError(error, "DatabaseClosedError")
  ) {
    return new GameRepositoryError(
      "storage_unavailable",
      `Could not access local game storage while ${operation}. Games live only in this browser.`,
      { cause: error },
    );
  }
  return new GameRepositoryError("unknown", `Game storage failed while ${operation}.`, {
    cause: error,
  });
}

/**
 * Dexie-backed {@link GameRepository} over the main-origin IndexedDB database
 * (ADR-0005). Games are never uploaded anywhere: this class only ever talks
 * to the browser's local database.
 */
export class DexieGameRepository implements GameRepository {
  constructor(private readonly db: GamesDatabase) {}

  async create(input: CreateSavedGameInput): Promise<SavedGame> {
    const title = input.title.trim();
    if (!title) {
      throw new GameRepositoryError("validation", "A saved game needs a title.");
    }
    const now = Date.now();
    const game: SavedGame = {
      id: `${GAME_ID_PREFIX}${nanoid(16)}`,
      title,
      ...(input.description?.trim() ? { description: input.description.trim() } : {}),
      html: input.html,
      sourceHash: await hashSource(input.html),
      sourceBytes: sourceByteLength(input.html),
      ...(input.apiVersion !== undefined ? { apiVersion: input.apiVersion } : {}),
      ...(input.mode !== undefined ? { mode: input.mode } : {}),
      createdAt: now,
      updatedAt: now,
    };
    try {
      await this.db.games.add(game);
    } catch (error) {
      throw toRepositoryError(error, "creating the game");
    }
    return game;
  }

  async read(id: string): Promise<SavedGame> {
    let game: SavedGame | undefined;
    try {
      game = await this.db.games.get(id);
    } catch (error) {
      throw toRepositoryError(error, "reading the game");
    }
    if (!game) {
      throw new GameRepositoryError("not_found", `No saved game with id "${id}".`);
    }
    return game;
  }

  async update(id: string, input: UpdateSavedGameInput): Promise<SavedGame> {
    const existing = await this.read(id);
    const next: SavedGame = { ...existing, updatedAt: Date.now() };
    if (input.title !== undefined) {
      const title = input.title.trim();
      if (!title) {
        throw new GameRepositoryError("validation", "A saved game needs a title.");
      }
      next.title = title;
    }
    if (input.description !== undefined) {
      next.description = input.description.trim() || undefined;
    }
    if (input.html !== undefined) {
      next.html = input.html;
      next.sourceHash = await hashSource(input.html);
      next.sourceBytes = sourceByteLength(input.html);
    }
    if (input.apiVersion !== undefined) {
      next.apiVersion = input.apiVersion;
    }
    if (input.mode !== undefined) {
      next.mode = input.mode;
    }
    try {
      await this.db.games.put(next);
    } catch (error) {
      throw toRepositoryError(error, "updating the game");
    }
    return next;
  }

  async delete(id: string): Promise<void> {
    try {
      await this.db.games.delete(id);
    } catch (error) {
      throw toRepositoryError(error, "deleting the game");
    }
  }

  async duplicate(id: string, input?: DuplicateSavedGameInput): Promise<SavedGame> {
    const existing = await this.read(id);
    const now = Date.now();
    const copy: SavedGame = {
      id: `${GAME_ID_PREFIX}${nanoid(16)}`,
      title: input?.title?.trim() || `${existing.title} (copy)`,
      ...(existing.description ? { description: existing.description } : {}),
      html: existing.html,
      sourceHash: existing.sourceHash,
      sourceBytes: existing.sourceBytes,
      ...(existing.apiVersion !== undefined ? { apiVersion: existing.apiVersion } : {}),
      ...(existing.mode !== undefined ? { mode: existing.mode } : {}),
      createdAt: now,
      updatedAt: now,
    };
    try {
      await this.db.games.add(copy);
    } catch (error) {
      throw toRepositoryError(error, "duplicating the game");
    }
    return copy;
  }

  async list(): Promise<SavedGame[]> {
    try {
      const games = await this.db.games.toArray();
      return games.sort(byRecentFirst);
    } catch (error) {
      throw toRepositoryError(error, "listing games");
    }
  }

  async search(query: string): Promise<SavedGame[]> {
    try {
      const games = await this.db.games.toArray();
      return games.filter((game) => gameMatchesQuery(game, query)).sort(byRecentFirst);
    } catch (error) {
      throw toRepositoryError(error, "searching games");
    }
  }

  async recordTestResults(id: string, results: TestResultsInput): Promise<SavedGame> {
    const existing = await this.read(id);
    const next: SavedGame = {
      ...existing,
      lastTestedAt: results.lastTestedAt,
      lastTestSucceeded: results.lastTestSucceeded,
    };
    try {
      await this.db.games.put(next);
    } catch (error) {
      throw toRepositoryError(error, "recording the test results");
    }
    return next;
  }

  /**
   * Remove every saved game. Impl-only convenience for tests and explicit
   * reset flows; not part of the {@link GameRepository} contract.
   */
  async clear(): Promise<void> {
    try {
      await this.db.games.clear();
    } catch (error) {
      throw toRepositoryError(error, "clearing games");
    }
  }
}
