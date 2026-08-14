import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { readDraftSource } from "../lib/editor/draft-handoff";
import { routeTree } from "../routeTree.gen";

/**
 * Prebuilt-game browser tests (rocketcrab-9fv.7.7.2 / 7.23 / 10.9): /browse
 * lists classic external iframe games and Nova's own games together with
 * distinct badges. The game list is hidden until a category opens or the
 * user searches (10.9); opening a category swaps to the list alone (no
 * category buttons, back affordance), and "My games" is a category card.
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
  return render(<RouterProvider router={router} />, { wrapper });
}

beforeEach(() => {
  window.history.pushState({}, "", "/");
});

describe("/browse", () => {
  it("shows only the category cards by default — no game list (10.9)", async () => {
    renderAt("/browse");
    expect(await screen.findByRole("heading", { name: "Games" })).toBeInTheDocument();
    // Category cards (All games, My games, and the classic boxes).
    expect(screen.getByRole("button", { name: /All games/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /My games/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /netgames\.io/ })).toBeInTheDocument();
    // The list is NOT shown by default.
    expect(screen.queryByText("Drawphone")).not.toBeInTheDocument();
    expect(screen.queryByText("Nova Quiz")).not.toBeInTheDocument();
  });

  it("lists classic and nova games together with distinct badges", async () => {
    renderAt("/browse");
    await userEvent.click(await screen.findByRole("button", { name: /All games/ }));
    // A classic game and a Nova game, side by side.
    expect(screen.getByText("Drawphone")).toBeInTheDocument();
    expect(screen.getByText("Nova Quiz")).toBeInTheDocument();
    // Both badges exist.
    expect(screen.getAllByText("classic").length).toBeGreaterThan(0);
    expect(screen.getAllByText("nova").length).toBeGreaterThan(0);
    // "by author" grey line per classic's card layout (several games share an author).
    expect(screen.getAllByText(/^by Tanner Krewson$/).length).toBeGreaterThan(0);
  });

  it("badges classic games red and nova games blue (7.42)", async () => {
    renderAt("/browse");
    await screen.findByRole("button", { name: /All games/ });
    await userEvent.click(screen.getByRole("button", { name: /All games/ }));
    await screen.findByText("Drawphone");

    const classicBadges = screen.getAllByText("classic");
    expect(classicBadges.length).toBeGreaterThan(0);
    for (const badge of classicBadges) {
      expect(badge.className).toContain("badge-error");
    }
    const novaBadges = screen.getAllByText("nova");
    expect(novaBadges.length).toBeGreaterThan(0);
    for (const badge of novaBadges) {
      expect(badge.className).toContain("badge-info");
    }
  });

  it("filters games by search (the list appears, category cards hide)", async () => {
    renderAt("/browse");
    await screen.findByRole("searchbox", { name: "Search games" });

    await userEvent.type(screen.getByRole("searchbox", { name: "Search games" }), "quiz");

    expect(screen.getByText("Nova Quiz")).toBeInTheDocument();
    expect(screen.queryByText("Drawphone")).not.toBeInTheDocument();
    // Searching hides the category buttons (10.9).
    expect(screen.queryByRole("button", { name: /All games/ })).not.toBeInTheDocument();
  });

  it("filters games by category box and shows only the list (netgames.io)", async () => {
    renderAt("/browse");
    await screen.findByRole("button", { name: /netgames\.io/ });
    await userEvent.click(screen.getByRole("button", { name: /netgames\.io/ }));

    expect(screen.getByText("Avalon")).toBeInTheDocument();
    expect(screen.queryByText("Drawphone")).not.toBeInTheDocument();
    expect(screen.queryByText("Nova Quiz")).not.toBeInTheDocument();
    // Only the list shows: no category buttons, and a way back.
    expect(screen.queryByRole("button", { name: /All games/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /All categories/ })).toBeInTheDocument();
  });

  it("returns to the category cards from an open category (10.9)", async () => {
    renderAt("/browse");
    await screen.findByRole("button", { name: /netgames\.io/ });
    await userEvent.click(screen.getByRole("button", { name: /netgames\.io/ }));
    expect(screen.getByText("Avalon")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /All categories/ }));
    expect(screen.getByRole("button", { name: /All games/ })).toBeInTheDocument();
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

  it("links to the player's own saved games (library)", async () => {
    renderAt("/browse");

    const yourGames = await screen.findByRole("link", { name: "Your games" });
    expect(yourGames.getAttribute("href")).toBe("/library");
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
    // Play action goes to the classic play route.
    const play = screen.getByRole("link", { name: /Play game/ });
    expect(play.getAttribute("href")).toBe("/classic/drawphone");
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

  it("shows an error panel for an unknown game id", async () => {
    renderAt("/game/not-a-game");

    expect(await screen.findByText("Unknown game")).toBeInTheDocument();
    const back = screen.getByRole("link", { name: "Back to games" });
    expect(back.getAttribute("href")).toBe("/browse");
  });
});
