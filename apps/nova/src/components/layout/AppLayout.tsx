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
 * full-screen play shell keeps the theme picker available in its Menu above
 * the game (11.1).
 */
export function AppLayout() {
  return (
    // `isolate` gives the shell its own stacking context. The starfield is a
    // normal positive layer inside it so the shell background cannot paint
    // over the stars; the page content and controls sit above that layer.
    <div className="isolate flex min-h-screen flex-col bg-surface-secondary text-foreground">
      {/* Starfield: always mounted across the whole app so the site
          consistently has stars — hidden only while a party is actively
          playing a game (rocketcrab-22n; no more homepage-only fade). */}
      <StarfieldBackground />
      {/* 5cl.15: max-w-7xl lets the editor (and other pages) use the
          widescreen space instead of leaving blank gutters on both sides. */}
      <main className="relative z-10 mx-auto w-full max-w-7xl flex-1 px-4 pb-12 pt-6">
        <Outlet />

        {/* Keep this control in the same shell stacking context as the play
            view so the play shell's z-40 chrome remains above it. */}
        <div
          className="fixed bottom-[max(0.75rem,env(safe-area-inset-bottom))] right-3 z-30 rounded-2xl border-2 border-border bg-surface p-1 shadow-md"
          data-testid="floating-theme-control"
        >
          <ThemeSelector />
        </div>
      </main>
    </div>
  );
}
