import Dexie from "dexie";
import { describe, expect, it } from "vitest";
import { GAMES_DB_SCHEMA_VERSION } from "./db";
import { createTestGameDatabase } from "./test-db";

/**
 * Database schema + migration tests (U2 acceptance: database migrations are
 * tested). Every migration bumps GAMES_DB_SCHEMA_VERSION and adds a
 * `.version(n).stores(...)` block; Dexie upgrades existing databases in
 * place. Here we prove a fresh database reaches the current schema and that
 * an existing database with a pre-games schema upgrades correctly.
 */
describe("GamesDatabase", () => {
  it("opens a fresh database at the current schema version with the games table", async () => {
    const { db } = createTestGameDatabase();
    await db.open();

    expect(db.verno).toBe(GAMES_DB_SCHEMA_VERSION);
    expect(db.tables.map((table) => table.name)).toEqual(["games"]);

    const game = {
      id: "game_1",
      title: "Rocket Rumble",
      html: "<p>hi</p>",
      sourceHash: "a".repeat(64),
      sourceBytes: 8,
      createdAt: 1,
      updatedAt: 1,
    };
    await db.games.add(game);
    expect(await db.games.get("game_1")).toMatchObject({ id: "game_1", title: "Rocket Rumble" });
  });

  it("upgrades an existing database with a pre-games schema in place", async () => {
    const legacy = new Dexie(`nova-games-migration-${Date.now()}`);
    legacy.version(0.1).stores({}); // pre-games schema: no stores at all
    await legacy.open();
    legacy.close();

    const { db } = createTestGameDatabase(legacy.name);
    await db.open();

    expect(db.verno).toBe(GAMES_DB_SCHEMA_VERSION);
    expect(db.tables.map((table) => table.name)).toEqual(["games"]);

    // The upgraded database is fully usable.
    await db.games.add({
      id: "game_upgraded",
      title: "Survivor",
      html: "<p>upgraded</p>",
      sourceHash: "b".repeat(64),
      sourceBytes: 12,
      createdAt: 2,
      updatedAt: 2,
    });
    expect(await db.games.count()).toBe(1);
  });
});
