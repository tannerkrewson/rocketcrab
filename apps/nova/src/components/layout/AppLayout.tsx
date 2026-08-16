import { Outlet } from "@tanstack/react-router";
import { StarfieldBackground } from "./StarfieldBackground";
import { ThemeSelector } from "./ThemeSelector";

/**
 * App-wide shell (7.34/7.36, footer removed 7.47, navbar removed 11.1):
 * NO navbar, no header, no wordmark bar — just a single consistent page
 * column plus one floating theme/color control pinned to the BOTTOM-RIGHT
 * corner of the screen (safe-area aware), reachable from every page.
 * Every route provides its own way back (back buttons / home links); the
 * party routes (/join, /party) keep their own classic shell chrome, and the
 * full-screen play shell renders its own copy of the floating control above
 * the game so the theme picker is always available (11.1).
 */
export function AppLayout() {
  return (
    // `isolate` gives the shell its own stacking context so the homepage
    // starfield's -z-10 sits behind the page content but above the shell's
    // background (rocketcrab-5cl.4).
    <div className="isolate flex min-h-screen flex-col bg-base-200 text-base-content">
      {/* Starfield: always mounted across the whole app so the site
          consistently has stars — hidden only while a party is actively
          playing a game (rocketcrab-22n; no more homepage-only fade). */}
      <StarfieldBackground />
      {/* 5cl.15: max-w-7xl lets the editor (and other pages) use the
          widescreen space instead of leaving blank gutters on both sides. */}
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 pb-12 pt-6">
        <Outlet />
      </main>

      {/* The one theme control, always floating bottom-right (11.1). The
          full-screen play shell (fixed, z-40) covers this copy while a game
          is live, so PartyPlayShell renders its own above the game. */}
      <div
        className="fixed bottom-[max(0.75rem,env(safe-area-inset-bottom))] right-3 z-30 rounded-box border-2 border-base-300 bg-base-100 p-1 shadow-md"
        data-testid="floating-theme-control"
      >
        <ThemeSelector />
      </div>
    </div>
  );
}
