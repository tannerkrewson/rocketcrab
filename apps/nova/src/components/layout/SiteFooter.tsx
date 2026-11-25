import type { PartyEngine } from "../../lib/party/engine";
import { usePartyEngine } from "../../lib/party/use-party";
import { SessionReplaySettings } from "./SessionReplaySettings";

export const AUTHOR_URL = "https://tannerkrewson.com";
export const GITHUB_URL = "https://github.com/tannerkrewson/rocketcrab";

const LINK =
  "font-semibold text-foreground/80 underline-offset-4 transition-colors hover:text-foreground hover:underline";

/**
 * Credit line centered at the bottom of every page. Hidden while a game is
 * playing: the full-screen play view shares the layout's stacking context,
 * so the footer would otherwise paint over the game. The injected engine is
 * a test seam, as in SiteBackground.
 */
export function SiteFooter({ engine }: { engine?: PartyEngine }) {
  const { state } = usePartyEngine(engine);
  if (state.phase === "playing") return null;
  return (
    <footer className="relative z-10 flex flex-col items-center gap-1 px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-4 text-center text-sm text-foreground/55">
      <SessionReplaySettings />
      <p>
        rocketcrab by{" "}
        <a href={AUTHOR_URL} target="_blank" rel="noopener noreferrer" className={LINK}>
          Tanner Krewson
        </a>
      </p>
      <p>
        <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" className={LINK}>
          View on GitHub
        </a>
      </p>
    </footer>
  );
}
