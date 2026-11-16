import { Outlet } from "@tanstack/react-router";
import { StarfieldBackground } from "./StarfieldBackground";
import { ThemeSelector } from "./ThemeSelector";

/** Shared page column and theme control; routes own their navigation and party chrome. */
export function AppLayout() {
  return (
    // `isolate` gives the shell its own stacking context. The starfield is a
    // normal positive layer inside it so the shell background cannot paint
    // over the stars; the page content and controls sit above that layer.
    <div className="isolate flex min-h-screen flex-col bg-surface-secondary text-foreground">
      <StarfieldBackground />
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
