import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { routeTree } from "../routeTree.gen";

/**
 * Prebuilt-game browser tests (rocketcrab-9fv.7.7.2 / 7.23 / 10.9 / 2t1.1):
 * /browse lists classic external iframe games with the classic badge. The
 * game list is hidden until a category opens or the user searches (10.9);
 * opening a category swaps to the list alone (no category buttons), and the
 * ONE unified "back" button returns to the category cards while a list is
 * open, or leaves the browser (home) at the top level. The "All games" box
 * is gone (2t1.1): category boxes are the only entry point.
 *
 * 5cl.10: Nova's example games were removed from the browser — it is
 * classic-only, and the "My games" box links to the full-featured library
 * page (5cl.12). 5cl.7: opening a game records the browse position, and the
 * details page's back button returns to the same category (?view=).
 */

function renderAt(path: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  render(<RouterProvider router={router} />, { wrapper });
  return router;
}

beforeEach(() => {
  window.history.pushState({}, "", "/");
  window.sessionStorage.clear();
});

describe("/browse", () => {
  it("shows only the category cards by default — no game list, no All-games box (10.9/2t1.1)", async () => {
    renderAt("/browse");
    expect(await screen.findByRole("heading", { name: "Games" })).toBeInTheDocument();
    // The brand row stays on the page (2t1.1).
    expect(screen.getByRole("link", { name: /rocketcrab\.com/ })).toBeInTheDocument();
    // Category cards (My games + the classic boxes); no "All games".
    expect(screen.getByRole("link", { name: /My games/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /netgames\.io/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /All games/ })).not.toBeInTheDocument();
    // The list is NOT shown by default.
    expect(screen.queryByText("Drawphone")).not.toBeInTheDocument();
  });

  it("renders the search input with its magnifier icon — no empty gap (3wf)", async () => {
    renderAt("/browse");
    const searchbox = await screen.findByRole("searchbox", { name: "Search games" });
    // The input is padded for an inline icon, and that icon actually
    // renders inside the same relative wrapper (no dead space where the
    // magnifier should be).
    expect(searchbox).toHaveClass("pl-10");
    const wrapper = searchbox.parentElement as HTMLElement;
    expect(wrapper.className).toContain("relative");
    expect(wrapper.querySelector("svg.lucide-search")).not.toBeNull();
  });

  it("lists classic games in their category boxes with the classic badge", async () => {
    renderAt("/browse");
    // A classic box (Drawing) opens its list with classic badges.
    await userEvent.click(await screen.findByRole("button", { name: /Drawing/ }));
    expect(screen.getByText("Drawphone")).toBeInTheDocument();
    expect(screen.getAllByText("classic").length).toBeGreaterThan(0);
    // "by author" grey line per classic's card layout.
    expect(screen.getAllByText(/^by Tanner Krewson$/).length).toBeGreaterThan(0);
  });

  it("badges classic games red (7.42)", async () => {
    renderAt("/browse");
    await screen.findByRole("button", { name: /Drawing/ });
    await userEvent.click(screen.getByRole("button", { name: /Drawing/ }));
    await screen.findByText("Drawphone");

    const classicBadges = screen.getAllByText("classic");
    expect(classicBadges.length).toBeGreaterThan(0);
    for (const badge of classicBadges) {
      expect(badge.className).toContain("badge-error");
    }
  });

  it("filters games by search (the list appears, category cards hide)", async () => {
    renderAt("/browse");
    await screen.findByRole("searchbox", { name: "Search games" });

    await userEvent.type(screen.getByRole("searchbox", { name: "Search games" }), "drawphone");

    expect(screen.getByText("Drawphone")).toBeInTheDocument();
    expect(screen.queryByText("Avalon")).not.toBeInTheDocument();
    // Searching hides the category buttons (10.9).
    expect(screen.queryByRole("link", { name: /My games/ })).not.toBeInTheDocument();
  });

  it("filters games by category box and shows only the list (netgames.io)", async () => {
    renderAt("/browse");
    await screen.findByRole("button", { name: /netgames\.io/ });
    await userEvent.click(screen.getByRole("button", { name: /netgames\.io/ }));

    expect(screen.getByText("Avalon")).toBeInTheDocument();
    expect(screen.queryByText("Drawphone")).not.toBeInTheDocument();
    // Only the list shows: no category cards, and the unified back.
    expect(screen.queryByRole("link", { name: /My games/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /back/i })).toBeInTheDocument();
  });

  it("returns to the category cards from an open category via the unified back (2t1.1)", async () => {
    renderAt("/browse");
    await screen.findByRole("button", { name: /netgames\.io/ });
    await userEvent.click(screen.getByRole("button", { name: /netgames\.io/ }));
    expect(screen.getByText("Avalon")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /back/i }));
    expect(screen.getByRole("link", { name: /My games/ })).toBeInTheDocument();
    expect(screen.queryByText("Avalon")).not.toBeInTheDocument();
  });

  it("navigates home from the top-level back button (2t1.1)", async () => {
    const router = renderAt("/browse");
    await screen.findByRole("button", { name: /back/i });

    await userEvent.click(screen.getByRole("button", { name: /back/i }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/"));
  });

  it("links the My games box to the library page (5cl.12)", async () => {
    renderAt("/browse");
    const myGames = await screen.findByRole("link", { name: /My games/ });
    expect(myGames.getAttribute("href")).toBe("/library");
  });

  it("returns to the category from the details page's back button (5cl.7)", async () => {
    const router = renderAt("/browse");
    await screen.findByRole("button", { name: /Drawing/ });
    await userEvent.click(screen.getByRole("button", { name: /Drawing/ }));
    // Opening a game from inside a category records the browse position.
    const drawphone = (await screen.findAllByRole("link", { name: /Drawphone/ })).find(
      (link) => link.getAttribute("href") === "/game/drawphone",
    );
    expect(drawphone).toBeDefined();
    await userEvent.click(drawphone!);
    await waitFor(() => expect(router.state.location.pathname).toBe("/game/drawphone"));

    // The details page's back button returns to the category, not /browse.
    const back = await screen.findByRole("link", { name: "Back to games" });
    expect(back.getAttribute("href")).toBe("/browse?view=drawing&q=");

    // Following it restores the Drawing category list.
    await userEvent.click(back);
    await waitFor(() => expect(router.state.location.pathname).toBe("/browse"));
    expect(router.state.location.searchStr).toContain("view=drawing");
    expect(await screen.findByText("Drawphone")).toBeInTheDocument();
  });
});

describe("/game/:gameId", () => {
  it("shows the classic Info detail with author, players, categories, and description", async () => {
    renderAt("/game/drawphone");

    expect(await screen.findByRole("heading", { name: "Drawphone" })).toBeInTheDocument();
    expect(screen.getByText("classic")).toBeInTheDocument();
    expect(screen.getByText("by Tanner Krewson")).toBeInTheDocument();
    expect(screen.getByText("1+ players")).toBeInTheDocument();
    // Category badges (drawing, easy).
    expect(screen.getByText("drawing")).toBeInTheDocument();
    expect(screen.getByText("easy")).toBeInTheDocument();
    // Description body.
    expect(screen.getByText(/In Drawphone, there are no winners/)).toBeInTheDocument();
    // No standalone "play game" view (2t1.10) — classic games play in a
    // party; the CTA starts a party (classic games can't be preselected
    // over the URL, so it lands on the plain /party entry).
    expect(screen.queryByRole("link", { name: /Play game/ })).not.toBeInTheDocument();
    const start = screen.getByRole("link", { name: /Start party/ });
    expect(start.getAttribute("href")).toBe("/party");
    // The brand row stays visible on the details page (2t1.1).
    expect(screen.getByRole("link", { name: /rocketcrab\.com/ })).toBeInTheDocument();
  });

  it("sits every badge and the game/donation links at the top of the page (l41)", async () => {
    renderAt("/game/drawphone");
    await screen.findByRole("heading", { name: "Drawphone" });

    const description = screen.getByText(/In Drawphone, there are no winners/);
    const before = (a: Element, b: Element) =>
      (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;

    // All badges use daisyUI's soft style.
    for (const badge of [
      screen.getByText("classic"),
      screen.getByText("drawing"),
      screen.getByText("easy"),
    ]) {
      expect(badge.className).toContain("badge-soft");
    }
    // The game link + donation link sit right under the player count —
    // both before the Info/Guide tabs and the description body.
    const gameLink = screen.getByText("drawphone.tannerkrewson.com");
    const donationLink = screen.getByText("Buy Tanner a taco!");
    const tabs = screen.getByRole("tablist");
    expect(before(gameLink, tabs)).toBe(true);
    expect(before(donationLink, tabs)).toBe(true);
    // Category badges live in the header (before the description body).
    expect(before(screen.getByText("drawing"), description)).toBe(true);
    expect(before(screen.getByText("easy"), description)).toBe(true);
  });

  it("switches between Info and Guide tabs (classic layout)", async () => {
    renderAt("/game/drawphone");
    await screen.findByRole("heading", { name: "Drawphone" });

    const guideTab = screen.getByRole("tab", { name: "Guide" });
    await userEvent.click(guideTab);

    expect(screen.getByRole("link", { name: /Read the guide/ })).toBeInTheDocument();
    expect(screen.queryByText(/In Drawphone, there are no winners/)).not.toBeInTheDocument();
  });

  it("shows an error panel for an unknown game id", async () => {
    renderAt("/game/not-a-game");

    expect(await screen.findByText("Unknown game")).toBeInTheDocument();
    const back = screen.getByRole("link", { name: "Back to games" });
    expect(back.getAttribute("href")).toBe("/browse");
  });
});
