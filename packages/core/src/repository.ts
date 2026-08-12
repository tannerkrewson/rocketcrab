import type { GameMode } from "@rocketcrab/protocol";

/**
 * A saved user-created game, persisted in IndexedDB on Nova's main origin
 * (ADR-0005). This interface is authoritative for U2 (issue rocketcrab-9fv.2.2)
 * and must stay in sync with the issue's data model:
 * id, title, description?, html, sourceHash, apiVersion?, mode?, createdAt,
 * updatedAt, lastTestedAt?, lastTestSucceeded?, sourceBytes.
 */
export interface SavedGame {
  id: string;
  title: string;
  description?: string;
  html: string;
  /** SHA-256 digest of `html` as 64 lowercase hex characters. */
  sourceHash: string;
  /** Nova runtime bridge API version the game was built against. */
  apiVersion?: number;
  /** Default execution mode (ADR-0006 state / simulation / raw). */
  mode?: GameMode;
  /** Epoch-millisecond timestamp of creation. */
  createdAt: number;
  /** Epoch-millisecond timestamp of the last edit (not of test runs). */
  updatedAt: number;
  /** Epoch-millisecond timestamp of the latest test run (U6 arena). */
  lastTestedAt?: number;
  /** Outcome of the latest test run. */
  lastTestSucceeded?: boolean;
  /** UTF-8 byte length of `html`, matching protocol byte-limit semantics. */
  sourceBytes: number;
}

/** Failure modes surfaced by {@link GameRepository} implementations. */
export type GameRepositoryErrorCode =
  | "not_found" // the record does not exist
  | "quota_exceeded" // the browser refused a write; the prior version is intact
  | "storage_unavailable" // IndexedDB cannot be used (private mode, closed db)
  | "validation" // the caller supplied an invalid input
  | "unknown"; // anything else

/**
 * Structured error from repository operations. Carries a `code` so callers
 * can react to storage failures (e.g. surface quota pressure) without
 * inspecting raw IndexedDB/Dexie exceptions, and a `cause` for diagnostics.
 */
export class GameRepositoryError extends Error {
  readonly code: GameRepositoryErrorCode;
  override readonly cause?: unknown;

  constructor(code: GameRepositoryErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "GameRepositoryError";
    this.code = code;
    if (options?.cause !== undefined) {
      this.cause = options.cause;
    }
  }
}

/** Type guard over {@link GameRepositoryError}. */
export function isGameRepositoryError(error: unknown): error is GameRepositoryError {
  return error instanceof GameRepositoryError;
}

/** Fields required to create a saved game; the repository derives the rest. */
export interface CreateSavedGameInput {
  title: string;
  description?: string;
  html: string;
  apiVersion?: number;
  mode?: GameMode;
}

/**
 * Partial update fields. A field left `undefined` keeps its current value;
 * `description: ""` clears the description; supplying `html` re-hashes the
 * source.
 */
export interface UpdateSavedGameInput {
  title?: string;
  description?: string;
  html?: string;
  apiVersion?: number;
  mode?: GameMode;
}

/** Options for duplicating a saved game. */
export interface DuplicateSavedGameInput {
  /** Override title for the copy; defaults to "<title> (copy)". */
  title?: string;
}

/** Outcome of a test run, recorded on a saved game (U6 test arena). */
export interface TestResultsInput {
  /** Epoch-millisecond timestamp of the test run. */
  lastTestedAt: number;
  lastTestSucceeded: boolean;
}

/**
 * Browser-local game repository (ADR-0005). Persistence lives in IndexedDB on
 * the main origin; implementations must never upload game source anywhere and
 * must never destroy the prior saved version on a failed write.
 */
export interface GameRepository {
  /** Create and persist a new game; returns the stored record. */
  create(input: CreateSavedGameInput): Promise<SavedGame>;
  /** Read one game by id; throws {@link GameRepositoryError} with code "not_found". */
  read(id: string): Promise<SavedGame>;
  /** Apply a partial update; re-hashes the source when `html` changes. */
  update(id: string, input: UpdateSavedGameInput): Promise<SavedGame>;
  /** Delete one game; deleting a missing id is a no-op. */
  delete(id: string): Promise<void>;
  /**
   * Create a copy sharing the source (and its hash) with fresh timestamps,
   * id, and no test history. Two games with identical source can coexist.
   */
  duplicate(id: string, input?: DuplicateSavedGameInput): Promise<SavedGame>;
  /** All games, most recently updated first. */
  list(): Promise<SavedGame[]>;
  /** Case-insensitive title/description search; an empty query returns all. */
  search(query: string): Promise<SavedGame[]>;
  /** Record the outcome of the latest test run without touching `updatedAt`. */
  recordTestResults(id: string, results: TestResultsInput): Promise<SavedGame>;
}

/**
 * Case-insensitive substring match over a game's title and description.
 * Shared by repository `search` implementations and in-memory list filters
 * so search semantics never drift. An empty/whitespace query matches all.
 */
export function gameMatchesQuery(
  game: Pick<SavedGame, "title" | "description">,
  query: string,
): boolean {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  return (
    game.title.toLowerCase().includes(normalized) ||
    (game.description ?? "").toLowerCase().includes(normalized)
  );
}
