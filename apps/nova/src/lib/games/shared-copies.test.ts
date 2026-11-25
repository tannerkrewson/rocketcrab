import type { SavedGame } from "@rocketcrab/core";
import { beforeEach, describe, expect, it } from "vitest";
import { gameRepository } from "./instance";
import { saveSharedGame, sharedGameStatus } from "./shared-copies";
import type { SharedPartyGameSource } from "../party/engine";

function saved(partial: Partial<SavedGame> & Pick<SavedGame, "id" | "sourceHash">): SavedGame {
  return {
    title: "Game",
    html: "<!doctype html>",
    sourceBytes: 15,
    createdAt: 1,
    updatedAt: 1,
    ...partial,
  };
}

const shared = { gameId: "game_theirs", sourceSha256: "b".repeat(64) };

describe("sharedGameStatus", () => {
  it("is own for the player's own game id", () => {
    const mine = saved({ id: "game_theirs", sourceHash: "a".repeat(64) });
    expect(sharedGameStatus([mine], shared)).toEqual({ kind: "own", game: mine });
  });

  it("is saved when any game has exactly this source", () => {
    const same = saved({ id: "game_x", sourceHash: shared.sourceSha256 });
    expect(sharedGameStatus([same], shared).kind).toBe("saved");
  });

  it("offers an update for an unedited copy of an older version", () => {
    const old = "c".repeat(64);
    const copy = saved({
      id: "game_copy",
      sourceHash: old,
      copiedFrom: { gameId: "game_theirs", sourceHash: old },
    });
    expect(sharedGameStatus([copy], shared)).toEqual({ kind: "update", game: copy });
  });

  it("never offers to overwrite a copy the player edited", () => {
    const copy = saved({
      id: "game_copy",
      sourceHash: "d".repeat(64),
      copiedFrom: { gameId: "game_theirs", sourceHash: "c".repeat(64) },
    });
    expect(sharedGameStatus([copy], shared).kind).toBe("edited");
  });

  it("is new when the player has nothing related", () => {
    expect(sharedGameStatus([saved({ id: "game_y", sourceHash: "e".repeat(64) })], shared)).toEqual(
      { kind: "new" },
    );
  });
});

describe("saveSharedGame", () => {
  beforeEach(async () => {
    for (const game of await gameRepository.list()) await gameRepository.delete(game.id);
  });

  const source = (html: string, sourceSha256: string): SharedPartyGameSource => ({
    gameId: "game_theirs",
    title: "Their Game",
    apiVersion: 1,
    source: html,
    sourceSha256,
    sharedBy: "Ada",
    sharedBySelf: false,
    saveable: true,
  });

  it("creates a copy that remembers where it came from", async () => {
    const game = await saveSharedGame(source("<p>v1</p>", "1".repeat(64)), { kind: "new" });
    expect(game).toMatchObject({
      title: "Their Game",
      html: "<p>v1</p>",
      copiedFrom: { gameId: "game_theirs", sourceHash: "1".repeat(64), sharedBy: "Ada" },
    });
  });

  it("updates an unedited copy in place, and adds a separate copy beside an edited one", async () => {
    const v1 = await saveSharedGame(source("<p>v1</p>", "1".repeat(64)), { kind: "new" });
    const updated = await saveSharedGame(source("<p>v2</p>", "2".repeat(64)), {
      kind: "update",
      game: v1,
    });
    expect(updated.id).toBe(v1.id);
    expect(updated.html).toBe("<p>v2</p>");
    expect(updated.copiedFrom?.sourceHash).toBe("2".repeat(64));

    const edited = await gameRepository.update(v1.id, { html: "<p>mine</p>" });
    const another = await saveSharedGame(source("<p>v3</p>", "3".repeat(64)), {
      kind: "edited",
      game: edited,
    });
    expect(another.id).not.toBe(v1.id);
    expect((await gameRepository.read(v1.id)).html).toBe("<p>mine</p>");
    expect(await gameRepository.list()).toHaveLength(2);
  });
});
