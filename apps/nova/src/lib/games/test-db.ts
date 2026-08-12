import { afterEach } from "vitest";
import { GamesDatabase } from "./db";
import { DexieGameRepository } from "./repository";

/**
 * Test-database helpers backed by fake-indexeddb (ADR-0013 stack). Each call
 * creates a uniquely named in-memory database; every database created through
 * these helpers is deleted after its test so tests never leak or collide.
 */

let sequence = 0;

const createdDatabases: GamesDatabase[] = [];

afterEach(async () => {
  const databases = createdDatabases.splice(0);
  await Promise.all(databases.map((db) => db.delete().catch(() => undefined)));
});

function uniqueDatabaseName(): string {
  sequence += 1;
  return `nova-games-test-${Date.now()}-${sequence}`;
}

/** Create a fresh {@link GamesDatabase} over fake-indexeddb for one test. */
export function createTestGameDatabase(name: string = uniqueDatabaseName()): {
  db: GamesDatabase;
} {
  const db = new GamesDatabase(name);
  createdDatabases.push(db);
  return { db };
}

/** Create a fresh repository over fake-indexeddb for one test. */
export function createTestGameRepository(name?: string): {
  repository: DexieGameRepository;
  db: GamesDatabase;
} {
  const { db } = createTestGameDatabase(name);
  return { repository: new DexieGameRepository(db), db };
}
