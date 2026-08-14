import { Link, Outlet, useLocation } from "@tanstack/react-router";
import { ThemeSelector } from "./ThemeSelector";

/**
 * App-wide shell (7.34/7.36, footer removed in 7.47): a slim sticky top bar
 * (wordmark home link + icon-only theme/color controls) above a single
 * consistent page column. There is no footer and no bottom nav; every
 * non-party page inherits the top bar, so the theme controls and a way
 * home stay reachable from anywhere.
 *
 * Party routes (/join, /party, /play) render their own classic party-shell
 * chrome, so the wordmark bar is skipped there (7.22); they get a compact
 * floating theme control in the top-right corner instead, so the controls
 * stay reachable on every page. The full-screen play shell (fixed, z-40)
 * covers that floating control while a game is live, exactly as it covers
 * all other app chrome.
 */
export function AppLayout() {
  const location = useLocation();
  const isPartyRoute = location.pathname === "/join" || location.pathname === "/party";

  return (
    <div className="flex min-h-screen flex-col bg-base-200 text-base-content">
      {isPartyRoute ? (
        <div
          className="fixed right-3 top-[max(0.75rem,env(safe-area-inset-top))] z-30 rounded-box border-2 border-base-300 bg-base-100 p-1 shadow-md"
          data-testid="party-route-theme-control"
        >
          <ThemeSelector />
        </div>
      ) : (
        <header className="sticky top-0 z-40 border-b-2 border-base-300 bg-base-100">
          <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-4 py-3">
            <Link
              to="/"
              className="flex items-center transition-opacity hover:opacity-70"
              aria-label="Rocketcrab home"
              title="Rocketcrab home"
            >
              <img src="/crab.svg" alt="" className="h-9 w-9" />
            </Link>
            <ThemeSelector />
          </div>
        </header>
      )}

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 pb-12 pt-6">
        <Outlet />
      </main>
    </div>
  );
}
