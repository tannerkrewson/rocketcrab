import { Outlet } from "@tanstack/react-router";
import { SiteBackground } from "../backgrounds/SiteBackground";

/** Shared page column over the site background; routes own their navigation and party chrome. */
export function AppLayout() {
  return (
    // `isolate` gives the shell its own stacking context. The background is a
    // normal positive layer inside it so the shell color cannot paint over
    // it; the page content and controls sit above that layer.
    <div className="isolate flex min-h-screen flex-col bg-background text-foreground">
      <SiteBackground />
      <main className="relative z-10 mx-auto w-full max-w-7xl flex-1 px-4 pb-12 pt-6">
        <Outlet />
      </main>
    </div>
  );
}
