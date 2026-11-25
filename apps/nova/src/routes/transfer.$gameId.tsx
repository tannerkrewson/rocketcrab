import { createFileRoute, redirect } from "@tanstack/react-router";
import { findCatalogGame } from "../lib/catalog";

/**
 * External games' Start party links, kept from the legacy site: start a
 * party with that game picked. Unknown games still get a party.
 */
export const Route = createFileRoute("/transfer/$gameId")({
  beforeLoad: ({ params }) => {
    const game = findCatalogGame(params.gameId);
    throw redirect({
      to: "/party",
      search: game === undefined ? {} : { gameId: game.id, title: game.name },
      replace: true,
    });
  },
});
