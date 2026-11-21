import { Outlet, useRouterState } from "@tanstack/react-router";
import { SiteBackground, type SiteBackgroundVariant } from "../backgrounds/SiteBackground";
import { SiteFooter } from "./SiteFooter";

/** Nova's build and editor pages get blue molten metal; party pages are plain black. */
const NOVA_ROUTES = new Set(["/build", "/editor", "/games/$gameId/edit"]);

function backgroundFor(
  matches: ReadonlyArray<{ routeId: string; search: unknown }>,
): SiteBackgroundVariant {
  if (matches.some((match) => NOVA_ROUTES.has(match.routeId))) return "nova";
  if (matches.some((match) => match.routeId === "/party")) return "party";
  // A game's details opened from the lobby are still part of the party.
  const fromParty = matches.some((match) => {
    if (match.routeId !== "/game/$gameId") return false;
    const from = (match.search as { from?: string } | undefined)?.from;
    return from === "party" || from === "party-browse";
  });
  return fromParty ? "party" : "molten";
}

/** Shared page column over the site background; routes own their navigation and party chrome. */
export function AppLayout() {
  const variant = useRouterState({ select: (state) => backgroundFor(state.matches) });
  return (
    // `isolate` gives the shell its own stacking context. The background is a
    // normal positive layer inside it so the shell color cannot paint over
    // it; the page content and controls sit above that layer.
    <div className="isolate flex min-h-screen flex-col bg-background text-foreground">
      <SiteBackground variant={variant} />
      <main className="relative z-10 mx-auto w-full max-w-7xl flex-1 px-4 pb-8 pt-6">
        <Outlet />
      </main>
      <SiteFooter />
    </div>
  );
}
