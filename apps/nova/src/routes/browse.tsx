import { Link, createFileRoute } from "@tanstack/react-router";
import { Library } from "lucide-react";
import { buttonStyles } from "../components/ui/Button";
import { GameBrowser } from "../components/party/GameBrowser";

export const Route = createFileRoute("/browse")({
  component: BrowsePage,
});

/**
 * The prebuilt-game browser (7.7.2 / 7.23): the shared {@link GameBrowser}
 * page with a classic-style heading and a link to the player's own saved
 * games. The same GameBrowser renders in pick mode inside the party lobby
 * and the in-game players page (7.43), so the lobby browses games with the
 * same UI as the rest of the app.
 */
export function BrowsePage() {
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black">Games</h1>
          <p className="text-base-content/70">
            Classic external iframe games and Nova's own games, side by side.
          </p>
        </div>
        <Link to="/library" className={buttonStyles("secondary")}>
          <Library className="h-4 w-4" aria-hidden="true" />
          Your games
        </Link>
      </header>

      <GameBrowser />
    </div>
  );
}
