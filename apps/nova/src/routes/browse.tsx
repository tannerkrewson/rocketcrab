import { createFileRoute } from "@tanstack/react-router";
import { BrandHeader } from "../components/layout/BrandHeader";
import { GameBrowser } from "../components/party/GameBrowser";

export const Route = createFileRoute("/browse")({
  // Preserve the category and search query when returning from game details.
  validateSearch: (search: Record<string, unknown>): { view?: string; q?: string } => ({
    view: typeof search.view === "string" ? search.view : undefined,
    q: typeof search.q === "string" ? search.q : undefined,
  }),
  component: BrowsePage,
});

export function BrowsePage() {
  const { view, q } = Route.useSearch();
  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-6">
      <BrandHeader />
      <header>
        <h1 className="text-3xl font-black">Games</h1>
      </header>

      <GameBrowser initialView={view} initialQuery={q} />
    </div>
  );
}
