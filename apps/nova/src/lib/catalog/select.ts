import { PROTOCOL_VERSION } from "@rocketcrab/protocol";
import type { PartyEngine } from "../party/engine";
import { fetchHostedNovaSource } from "./hosted";
import type { CatalogGame, NovaCatalogGame } from "./types";

/** The party source for a hosted Nova game: its listing plus its fetched HTML. */
export async function hostedNovaSourceSpec(game: NovaCatalogGame) {
  return {
    gameId: game.id,
    title: game.name,
    source: await fetchHostedNovaSource(game),
    apiVersion: PROTOCOL_VERSION,
  };
}

/**
 * Pick a listed game for the party (host only). External games create a
 * room; hosted Nova games are fetched here and then shared exactly like a
 * saved game.
 */
export async function selectCatalogGame(
  engine: Pick<PartyEngine, "selectGame">,
  game: CatalogGame,
): Promise<void> {
  if (game.play.kind === "external") {
    await engine.selectGame({ kind: "external", gameId: game.id });
    return;
  }
  await engine.selectGame(await hostedNovaSourceSpec(game as NovaCatalogGame));
}
