import { GamesDatabase } from "./db";
import { DexieGameRepository } from "./repository";

/**
 * The app-wide game repository over the main-origin IndexedDB database
 * (ADR-0005). Constructing the Dexie instance is lazy — the database opens on
 * first use — so importing this module is safe anywhere in the shell.
 * Game source is never sent over the network during save operations.
 */
export const gameRepository = new DexieGameRepository(new GamesDatabase());
