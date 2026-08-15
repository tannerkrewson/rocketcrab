import { createFileRoute } from "@tanstack/react-router";
import { BrandHeader } from "../components/layout/BrandHeader";
import { GameBrowser } from "../components/party/GameBrowser";

export const Route = createFileRoute("/browse")({
  // 5cl.7: the game details page's back button restores the browse
  // position through the URL (?view=<category>&q=<query>). Both params are
  // optional so plain /browse links keep working without a search object.
  validateSearch: (search: Record<string, unknown>): { view?: string; q?: string } => ({
    view: typeof search.view === "string" ? search.view : undefined,
    q: typeof search.q === "string" ? search.q : undefined,
  }),
  component: BrowsePage,
});

/**
 * The prebuilt-game browser (7.7.2 / 7.23 / 2t1.1): the shared
 * {@link GameBrowser} page with a classic-style heading and the compact
 * rocketcrab.com brand row. The same GameBrowser renders in pick mode inside
 * the party lobby and the in-game players page (7.43), so the lobby browses
 * games with the same UI as the rest of the app. Navigation lives INSIDE the
 * browser: one unified "back" button (to home here, to the lobby in a
 * party) — no separate header actions.
 *
 * 5cl.10: the browser is classic-only — Nova's shipped example games were
 * removed, and Nova's own games live under My games (/library). 5cl.7: the
 * ?view=/?q= search params restore the category/search the user came from.
 */
export function BrowsePage() {
  const { view, q } = Route.useSearch();
  return (
    <div className="flex flex-col gap-6">
      <BrandHeader />
      <header className="flex flex-col gap-1">
        <h1 className="text-3xl font-black">Games</h1>
        <p className="text-base-content/70">
          Classic party games, played in an embedded frame. Your own games live under My games.
        </p>
      </header>

      <GameBrowser initialView={view} initialQuery={q} />
    </div>
  );
}
