import Dexie from "dexie";
import { describe, expect, it, vi } from "vitest";
import type { SavedGame } from "@rocketcrab/core";
import { GamesDatabase } from "./db";
import { hashSource } from "./hashing";
import { DexieGameRepository } from "./repository";
import { createTestGameRepository } from "./test-db";

/**
 * Integration tests for the Dexie-backed {@link GameRepository} over
 * fake-indexeddb (U2 acceptance: unit + integration tests, games survive
 * reloads, identical sources coexist, deterministic hashes, failed writes
 * never destroy the prior version).
 */

function utf8Bytes(source: string): number {
  return new TextEncoder().encode(source).byteLength;
}

describe("DexieGameRepository", () => {
  it("creates a game with derived fields and reads it back", async () => {
    const { repository } = createTestGameRepository();
    const game = await repository.create({
      title: "  Rocket Rumble  ",
      description: "  Fight in space  ",
      html: "<html><body>hi</body></html>",
      apiVersion: 1,
      mode: "state",
    });

    expect(game.id).toMatch(/^game_[A-Za-z0-9_-]+$/);
    expect(game.title).toBe("Rocket Rumble");
    expect(game.description).toBe("Fight in space");
    expect(game.sourceHash).toBe(await hashSource(game.html));
    expect(game.sourceBytes).toBe(utf8Bytes(game.html));
    expect(game.apiVersion).toBe(1);
    expect(game.mode).toBe("state");
    expect(game.createdAt).toBeGreaterThan(0);
    expect(game.updatedAt).toBe(game.createdAt);
    expect(game.lastTestedAt).toBeUndefined();
    expect(game.lastTestSucceeded).toBeUndefined();

    const stored = await repository.read(game.id);
    expect(stored).toEqual(game);
  });

  it("keeps two games with identical source as separate records (same hash)", async () => {
    const { repository } = createTestGameRepository();
    const html = "<p>same source</p>";
    const first = await repository.create({ title: "First", html });
    const second = await repository.create({ title: "Second", html });

    expect(first.id).not.toBe(second.id);
    expect(first.sourceHash).toBe(second.sourceHash);
    expect(first.sourceBytes).toBe(second.sourceBytes);
    expect((await repository.list()).map((game) => game.id)).toEqual([second.id, first.id]);
  });

  it("updates fields partially and re-hashes when the html changes", async () => {
    const { repository } = createTestGameRepository();
    const game = await repository.create({ title: "Old", description: "desc", html: "<p>1</p>" });

    const renamed = await repository.update(game.id, { title: "New", description: "" });
    expect(renamed.title).toBe("New");
    expect(renamed.description).toBeUndefined();
    expect(renamed.sourceHash).toBe(game.sourceHash);
    expect(renamed.updatedAt).toBeGreaterThanOrEqual(game.updatedAt);

    const rehashed = await repository.update(game.id, { html: "<p>2</p>" });
    expect(rehashed.sourceHash).not.toBe(game.sourceHash);
    expect(rehashed.sourceHash).toBe(await hashSource("<p>2</p>"));
    expect(rehashed.sourceBytes).toBe(utf8Bytes("<p>2</p>"));
  });

  it("throws structured not_found errors for missing games", async () => {
    const { repository } = createTestGameRepository();
    await expect(repository.read("game_nope")).rejects.toMatchObject({ code: "not_found" });
    await expect(repository.update("game_nope", { title: "x" })).rejects.toMatchObject({
      code: "not_found",
    });
    await expect(repository.duplicate("game_nope")).rejects.toMatchObject({ code: "not_found" });
    await expect(
      repository.recordTestResults("game_nope", { lastTestedAt: 1, lastTestSucceeded: true }),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("rejects invalid inputs with a validation error", async () => {
    const { repository } = createTestGameRepository();
    await expect(repository.create({ title: "   ", html: "<p>x</p>" })).rejects.toMatchObject({
      code: "validation",
    });
    const game = await repository.create({ title: "OK", html: "<p>x</p>" });
    await expect(repository.update(game.id, { title: " " })).rejects.toMatchObject({
      code: "validation",
    });
  });

  it("deletes a game and treats deleting a missing id as a no-op", async () => {
    const { repository } = createTestGameRepository();
    const game = await repository.create({ title: "Doomed", html: "<p>x</p>" });

    await repository.delete(game.id);
    await expect(repository.read(game.id)).rejects.toMatchObject({ code: "not_found" });
    await expect(repository.delete(game.id)).resolves.toBeUndefined();
  });

  it("duplicates a game with fresh identity, timestamps, and no test history", async () => {
    const { repository } = createTestGameRepository();
    const original = await repository.create({
      title: "Rockets",
      description: "desc",
      html: "<p>x</p>",
      mode: "simulation",
    });
    await repository.recordTestResults(original.id, { lastTestedAt: 5, lastTestSucceeded: true });

    const copy = await repository.duplicate(original.id);
    expect(copy.id).not.toBe(original.id);
    expect(copy.title).toBe("Rockets (copy)");
    expect(copy.description).toBe("desc");
    expect(copy.html).toBe(original.html);
    expect(copy.sourceHash).toBe(original.sourceHash);
    expect(copy.sourceBytes).toBe(original.sourceBytes);
    expect(copy.mode).toBe("simulation");
    expect(copy.lastTestedAt).toBeUndefined();
    expect(copy.lastTestSucceeded).toBeUndefined();
    expect(copy.createdAt).toBeGreaterThanOrEqual(original.createdAt);

    const renamed = await repository.duplicate(original.id, { title: "Renamed" });
    expect(renamed.title).toBe("Renamed");

    expect((await repository.list()).length).toBe(3);
    expect(await repository.read(original.id)).toMatchObject({ title: "Rockets" });
  });

  it("lists games most recently updated first", async () => {
    const { repository } = createTestGameRepository();
    const first = await repository.create({ title: "First", html: "<p>1</p>" });
    const second = await repository.create({ title: "Second", html: "<p>2</p>" });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const edited = await repository.update(first.id, { title: "First edited" });

    const list = await repository.list();
    expect(list.map((game) => game.id)).toEqual([edited.id, second.id]);
  });

  it("searches titles and descriptions case-insensitively", async () => {
    const { repository } = createTestGameRepository();
    const rocket = await repository.create({
      title: "Rocket Rumble",
      description: "space fight",
      html: "<p>1</p>",
    });
    const cards = await repository.create({
      title: "Card Sharks",
      description: "table game",
      html: "<p>2</p>",
    });

    expect((await repository.search("rocket")).map((game) => game.id)).toEqual([rocket.id]);
    expect((await repository.search("TABLE")).map((game) => game.id)).toEqual([cards.id]);
    expect((await repository.search("space")).map((game) => game.id)).toEqual([rocket.id]);
    expect(await repository.search("zzz")).toEqual([]);
    expect((await repository.search("   ")).length).toBe(2);
  });

  it("records test results without touching updatedAt", async () => {
    const { repository } = createTestGameRepository();
    const game = await repository.create({ title: "Test me", html: "<p>x</p>" });

    const recorded = await repository.recordTestResults(game.id, {
      lastTestedAt: 1234,
      lastTestSucceeded: false,
    });
    expect(recorded.lastTestedAt).toBe(1234);
    expect(recorded.lastTestSucceeded).toBe(false);
    expect(recorded.updatedAt).toBe(game.updatedAt);
    expect(await repository.read(game.id)).toEqual(recorded);
  });

  it("preserves the prior saved version when a write fails (quota)", async () => {
    const { repository, db } = createTestGameRepository();
    const game = await repository.create({ title: "Precious", html: "<p>v1</p>" });

    const spy = vi
      .spyOn(db.games, "put")
      .mockRejectedValueOnce(new Dexie.QuotaExceededError("full"));
    await expect(repository.update(game.id, { title: "Changed" })).rejects.toMatchObject({
      code: "quota_exceeded",
    });
    spy.mockRestore();

    const stored = await repository.read(game.id);
    expect(stored.title).toBe("Precious");
    expect(stored.html).toBe("<p>v1</p>");
  });

  it("surfaces storage-unavailable errors when the database is closed", async () => {
    const { repository, db } = createTestGameRepository();
    await repository.create({ title: "T", html: "<p>x</p>" });
    db.close();

    await expect(repository.list()).rejects.toMatchObject({ code: "storage_unavailable" });
  });

  it("keeps games across a reload (new connection over the same database)", async () => {
    const name = `nova-games-reload-${Date.now()}`;
    const { repository, db } = createTestGameRepository(name);
    const game = await repository.create({ title: "Persistent", html: "<p>x</p>" });
    db.close();

    // Simulate a page reload: a brand-new repository over the same database.
    const reopened = new DexieGameRepository(new GamesDatabase(name));
    const stored: SavedGame = await reopened.read(game.id);
    expect(stored.title).toBe("Persistent");
    expect(stored.sourceHash).toBe(game.sourceHash);
  });
});
