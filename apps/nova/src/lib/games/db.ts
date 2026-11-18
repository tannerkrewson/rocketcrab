import Dexie, { type Table } from "dexie";
import type { SavedGame } from "@rocketcrab/core";

/** Name of the main-origin IndexedDB database holding saved games (ADR-0005). */
export const GAMES_DB_NAME = "nova-games";

export const GAMES_DB_SCHEMA_VERSION = 2;

/**
 * Main-origin storage only, never runtime-origin (ADR-0005). Schema changes
 * bump GAMES_DB_SCHEMA_VERSION and add a .version(n).stores(...) block;
 * Dexie upgrades in place, with migrations covered by db.test.ts.
 */
export class GamesDatabase extends Dexie {
  /** Saved games keyed by `SavedGame.id`. */
  games!: Table<SavedGame, string>;

  constructor(name: string = GAMES_DB_NAME) {
    super(name);
    const stores = { games: "id, title, mode, apiVersion, createdAt, updatedAt, lastTestedAt" };
    this.version(1).stores(stores);
    // Simulation mode was removed; ticking games are state mode now.
    this.version(2)
      .stores(stores)
      .upgrade((tx) =>
        tx
          .table("games")
          .toCollection()
          .modify((game: { mode?: string }) => {
            if (game.mode === "simulation") game.mode = "state";
          }),
      );
  }
}
