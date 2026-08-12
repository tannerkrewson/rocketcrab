import Dexie, { type Table } from "dexie";
import type { SavedGame } from "@rocketcrab/core";

/** Name of the main-origin IndexedDB database holding saved games (ADR-0005). */
export const GAMES_DB_NAME = "nova-games";

/** Current schema version of the games database. */
export const GAMES_DB_SCHEMA_VERSION = 1;

/**
 * IndexedDB database for saved games, on Nova's main origin only (ADR-0005;
 * engineering rule 4 — never runtime-origin storage). Schema changes bump
 * {@link GAMES_DB_SCHEMA_VERSION} and add another `.version(n).stores(...)`
 * block; Dexie runs the upgrade in place. See `db.test.ts` for the migration
 * test that exercises an upgrade from a pre-games schema.
 */
export class GamesDatabase extends Dexie {
  /** Saved games keyed by `SavedGame.id`. */
  games!: Table<SavedGame, string>;

  constructor(name: string = GAMES_DB_NAME) {
    super(name);
    this.version(GAMES_DB_SCHEMA_VERSION).stores({
      games: "id, title, mode, apiVersion, createdAt, updatedAt, lastTestedAt",
    });
  }
}
