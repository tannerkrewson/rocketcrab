import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { readDraftSource } from "../lib/editor/draft-handoff";
import { routeTree } from "../routeTree.gen";

/**
 * Prebuilt-game browser tests (rocketcrab-9fv.7.7.2 / 7.23 / 10.9 / 2t1.1):
 * /browse lists classic external iframe games and Nova's own games together
 * with distinct badges. The game list is hidden until a category opens or the
 * user searches (10.9); opening a category swaps to the list alone (no
 * category buttons), and the ONE unified "back" button returns to the
 * category cards while a list is open, or leaves the browser (home) at the
 * top level. The "All games" box is gone (2t1.1): category boxes are the
 * only entry point, and the Nova box uses a lucide icon, not the brand mark.
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
});

describe("/browse", () => {
  it("shows only the category cards by default — no game list, no All-games box (10.9/2t1.1)", async () => {
    renderAt("/browse");
    expect(await screen.findByRole("heading", { name: "Games" })).toBeInTheDocument();
    // The brand row stays on the page (2t1.1).
    expect(screen.getByRole("link", { name: /rocketcrab\.com/ })).toBeInTheDocument();
    // Category cards (My games + the classic boxes + Nova); no "All games".
    expect(screen.getByRole("button", { name: /My games/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /netgames\.io/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /All games/ })).not.toBeInTheDocument();
    // The list is NOT shown by default.
    expect(screen.queryByText("Drawphone")).not.toBeInTheDocument();
    expect(screen.queryByText("Nova Quiz")).not.toBeInTheDocument();
  });

  it("lists classic and nova games in their category boxes with distinct badges", async () => {
    renderAt("/browse");
    // Nova games in the Nova box (lucide sparkle icon, no brand mark).
    await userEvent.click(await screen.findByRole("button", { name: /Nova/ }));
    expect(screen.getByText("Nova Quiz")).toBeInTheDocument();
    expect(screen.getByText("Nova Drift")).toBeInTheDocument();
    expect(screen.getAllByText("nova").length).toBeGreaterThan(0);

    // Back to the category cards, then a classic box (Drawing).
    await userEvent.click(screen.getByRole("button", { name: /back/i }));
    await userEvent.click(screen.getByRole("button", { name: /Drawing/ }));
    expect(screen.getByText("Drawphone")).toBeInTheDocument();
    expect(screen.getAllByText("classic").length).toBeGreaterThan(0);
    // "by author" grey line per classic's card layout.
    expect(screen.getAllByText(/^by Tanner Krewson$/).length).toBeGreaterThan(0);
  });

  it("badges classic games red and nova games blue (7.42)", async () => {
    renderAt("/browse");
    await screen.findByRole("button", { name: /Nova/ });
    await userEvent.click(screen.getByRole("button", { name: /Nova/ }));
    await screen.findByText("Nova Quiz");

    const novaBadges = screen.getAllByText("nova");
    expect(novaBadges.length).toBeGreaterThan(0);
    for (const badge of novaBadges) {
      expect(badge.className).toContain("badge-info");
    }

    await userEvent.click(screen.getByRole("button", { name: /back/i }));
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

    await userEvent.type(screen.getByRole("searchbox", { name: "Search games" }), "quiz");

    expect(screen.getByText("Nova Quiz")).toBeInTheDocument();
    expect(screen.queryByText("Drawphone")).not.toBeInTheDocument();
    // Searching hides the category buttons (10.9).
    expect(screen.queryByRole("button", { name: /My games/ })).not.toBeInTheDocument();
  });

  it("filters games by category box and shows only the list (netgames.io)", async () => {
    renderAt("/browse");
    await screen.findByRole("button", { name: /netgames\.io/ });
    await userEvent.click(screen.getByRole("button", { name: /netgames\.io/ }));

    expect(screen.getByText("Avalon")).toBeInTheDocument();
    expect(screen.queryByText("Drawphone")).not.toBeInTheDocument();
    expect(screen.queryByText("Nova Quiz")).not.toBeInTheDocument();
    // Only the list shows: no category buttons, and the unified back.
    expect(screen.queryByRole("button", { name: /My games/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /back/i })).toBeInTheDocument();
  });

  it("returns to the category cards from an open category via the unified back (2t1.1)", async () => {
    renderAt("/browse");
    await screen.findByRole("button", { name: /netgames\.io/ });
    await userEvent.click(screen.getByRole("button", { name: /netgames\.io/ }));
    expect(screen.getByText("Avalon")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /back/i }));
    expect(screen.getByRole("button", { name: /My games/ })).toBeInTheDocument();
    expect(screen.queryByText("Avalon")).not.toBeInTheDocument();
  });

  it("filters to Nova games via the Nova category box", async () => {
    renderAt("/browse");
    await screen.findByRole("button", { name: /Nova/ });
    await userEvent.click(screen.getByRole("button", { name: /Nova/ }));

    expect(screen.getByText("Nova Quiz")).toBeInTheDocument();
    expect(screen.getByText("Nova Drift")).toBeInTheDocument();
    expect(screen.queryByText("Drawphone")).not.toBeInTheDocument();
  });

  it("navigates home from the top-level back button (2t1.1)", async () => {
    const router = renderAt("/browse");
    await screen.findByRole("button", { name: /back/i });

    await userEvent.click(screen.getByRole("button", { name: /back/i }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/"));
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

  it("switches between Info and Guide tabs (classic layout)", async () => {
    renderAt("/game/drawphone");
    await screen.findByRole("heading", { name: "Drawphone" });

    const guideTab = screen.getByRole("tab", { name: "Guide" });
    await userEvent.click(guideTab);

    expect(screen.getByRole("link", { name: /Read the guide/ })).toBeInTheDocument();
    expect(screen.queryByText(/In Drawphone, there are no winners/)).not.toBeInTheDocument();
  });

  it("opens a Nova game in the editor as a new draft", async () => {
    renderAt("/game/nova-quiz");

    const openButton = await screen.findByRole("button", { name: /Open in the editor/ });
    await userEvent.click(openButton);

    // The lazy source import + draft handoff resolve asynchronously.
    await waitFor(() => expect(readDraftSource()?.source).toContain("nova.defineGame"));
    const draft = readDraftSource();
    expect(draft?.gameId.startsWith("draft-")).toBe(true);
    expect(draft?.source).toContain("Nova Quiz");
  });

  it("starts a party with a Nova prebuilt game preselected (2t1.10)", async () => {
    const router = renderAt("/game/nova-quiz");

    const start = await screen.findByRole("button", { name: /Start party/ });
    await userEvent.click(start);

    // The source is handed to the party route via the source handoff and
    // the URL carries the game id, mode, and title.
    await waitFor(() => expect(router.state.location.pathname).toBe("/party"));
    const search = router.state.location.search as Record<string, unknown>;
    expect(search.gameId).toBe("nova-quiz");
    expect(search.mode).toBe("state");
    expect(search.title).toBe("Nova Quiz");
  });

  it("shows an error panel for an unknown game id", async () => {
    renderAt("/game/not-a-game");

    expect(await screen.findByText("Unknown game")).toBeInTheDocument();
    const back = screen.getByRole("link", { name: "Back to games" });
    expect(back.getAttribute("href")).toBe("/browse");
  });
});
