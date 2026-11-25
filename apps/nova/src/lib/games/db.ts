import Dexie, { type Table } from "dexie";
import type { SavedGame } from "@rocketcrab/core";

/** Name of the main-origin IndexedDB database holding saved games. */
export const GAMES_DB_NAME = "nova-games";

export const GAMES_DB_SCHEMA_VERSION = 3;

/**
 * Main-origin storage only, never runtime-origin. Schema changes
 * bump GAMES_DB_SCHEMA_VERSION and add a .version(n).stores(...) block;
 * Dexie upgrades in place, with migrations covered by db.test.ts.
 */
export class GamesDatabase extends Dexie {
  /** Saved games keyed by `SavedGame.id`. */
  games!: Table<SavedGame, string>;

  constructor(name: string = GAMES_DB_NAME) {
    super(name);
    const legacyStores = {
      games: "id, title, mode, apiVersion, createdAt, updatedAt, lastTestedAt",
    };
    this.version(1).stores(legacyStores);
    this.version(2).stores(legacyStores);
    // Games have one model now, so saved games no longer record a mode.
    this.version(3)
      .stores({ games: "id, title, apiVersion, createdAt, updatedAt, lastTestedAt" })
      .upgrade((tx) =>
        tx
          .table("games")
          .toCollection()
          .modify((game: { mode?: string }) => {
            delete game.mode;
          }),
      );
  }
}
