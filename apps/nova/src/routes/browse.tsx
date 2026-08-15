import { createFileRoute } from "@tanstack/react-router";
import { BrandHeader } from "../components/layout/BrandHeader";
import { GameBrowser } from "../components/party/GameBrowser";

export const Route = createFileRoute("/browse")({
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
 */
export function BrowsePage() {
  return (
    <div className="flex flex-col gap-6">
      <BrandHeader />
      <header className="flex flex-col gap-1">
        <h1 className="text-3xl font-black">Games</h1>
        <p className="text-base-content/70">
          Classic external iframe games and Nova's own games, side by side.
        </p>
      </header>

      <GameBrowser />
    </div>
  );
}
