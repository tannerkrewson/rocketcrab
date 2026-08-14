import { Outlet } from "@tanstack/react-router";
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
    <div className="flex min-h-screen flex-col bg-base-200 text-base-content">
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 pb-12 pt-6">
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
