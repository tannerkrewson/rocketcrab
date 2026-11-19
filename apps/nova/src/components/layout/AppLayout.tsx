import { Outlet, useRouterState } from "@tanstack/react-router";
import { SiteBackground } from "../backgrounds/SiteBackground";
import { SiteFooter } from "./SiteFooter";

/** Shared page column over the site background; routes own their navigation and party chrome. */
export function AppLayout() {
  // Follow the rendered matches (not the pending location), so the page silk
  // only mounts once /build replaces home: both carry the nova-hero
  // view-transition name and must never be on screen together.
  const nova = useRouterState({
    select: (state) => state.matches.some((match) => match.routeId === "/build"),
  });
  return (
    // `isolate` gives the shell its own stacking context. The background is a
    // normal positive layer inside it so the shell color cannot paint over
    // it; the page content and controls sit above that layer.
    <div className="isolate flex min-h-screen flex-col bg-background text-foreground">
      <SiteBackground nova={nova} />
      <main className="relative z-10 mx-auto w-full max-w-7xl flex-1 px-4 pb-8 pt-6">
        <Outlet />
      </main>
      <SiteFooter />
    </div>
  );
}
