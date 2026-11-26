import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { routeTree } from "../routeTree.gen";

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
  it("shows only the category cards by default — no game list, no All-games box", async () => {
    renderAt("/browse");
    expect(await screen.findByRole("heading", { name: "Games" })).toBeInTheDocument();
    expect(screen.getByTestId("browser-brand-row")).toHaveTextContent("rocketcrab.com");
    expect(screen.getByRole("link", { name: /My games/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Trivia/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /netgames\.io/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /All games/ })).not.toBeInTheDocument();
    expect(screen.queryByText("Drawphone")).not.toBeInTheDocument();
  });

  it("renders the search input with its magnifier icon — no empty gap", async () => {
    renderAt("/browse");
    const searchbox = await screen.findByRole("searchbox", { name: "Search games" });
    expect(searchbox).toHaveClass("pl-10");
    const wrapper = searchbox.parentElement as HTMLElement;
    expect(wrapper.className).toContain("relative");
    expect(wrapper.querySelector("svg.lucide-search")).not.toBeNull();
  });

  it("lists external games in their category boxes, without a jargon badge", async () => {
    renderAt("/browse");
    await userEvent.click(await screen.findByRole("button", { name: /Drawing/ }));
    expect(screen.getByText("Drawphone")).toBeInTheDocument();
    expect(screen.queryByText("classic")).not.toBeInTheDocument();
    expect(screen.getAllByText(/^by Tanner Krewson$/).length).toBeGreaterThan(0);
  });

  it("filters games by search (the list appears, category cards hide)", async () => {
    renderAt("/browse");
    await screen.findByRole("searchbox", { name: "Search games" });

    await userEvent.type(screen.getByRole("searchbox", { name: "Search games" }), "drawphone");

    expect(screen.getByText("Drawphone")).toBeInTheDocument();
    expect(screen.queryByText("Avalon")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /My games/ })).not.toBeInTheDocument();
  });

  it("filters games by category box and shows only the list (Trivia)", async () => {
    renderAt("/browse");
    await screen.findByRole("button", { name: /Trivia/ });
    await userEvent.click(screen.getByRole("button", { name: /Trivia/ }));

    expect(screen.getByText("Protobowl")).toBeInTheDocument();
    expect(screen.queryByText("Drawphone")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /My games/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /back/i })).toBeInTheDocument();
  });

  it("returns to the category cards from an open category via the unified back", async () => {
    renderAt("/browse");
    await screen.findByRole("button", { name: /Trivia/ });
    await userEvent.click(screen.getByRole("button", { name: /Trivia/ }));
    expect(screen.getByText("Protobowl")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /back/i }));
    expect(screen.getByRole("link", { name: /My games/ })).toBeInTheDocument();
    expect(screen.queryByText("Protobowl")).not.toBeInTheDocument();
  });

  it("navigates home from the top-level back button", async () => {
    const router = renderAt("/browse");
    await screen.findByRole("button", { name: /back/i });

    await userEvent.click(screen.getByRole("button", { name: /back/i }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/"));
  });

  it("links the My games box to the library page", async () => {
    renderAt("/browse");
    const myGames = await screen.findByRole("link", { name: /My games/ });
    expect(myGames.getAttribute("href")).toBe("/library");
  });

  it("returns to the category from the details page's back button", async () => {
    const router = renderAt("/browse");
    await screen.findByRole("button", { name: /Drawing/ });
    await userEvent.click(screen.getByRole("button", { name: /Drawing/ }));
    const drawphone = (await screen.findAllByRole("link", { name: /Drawphone/ })).find(
      (link) => link.getAttribute("href") === "/game/drawphone",
    );
    expect(drawphone).toBeDefined();
    await userEvent.click(drawphone!);
    await waitFor(() => expect(router.state.location.pathname).toBe("/game/drawphone"));

    const back = await screen.findByRole("link", { name: "Back to games" });
    expect(back.getAttribute("href")).toBe("/browse?view=drawing&q=");

    await userEvent.click(back);
    await waitFor(() => expect(router.state.location.pathname).toBe("/browse"));
    expect(router.state.location.searchStr).toContain("view=drawing");
    expect(await screen.findByText("Drawphone")).toBeInTheDocument();
  });
});

describe("/game/:gameId", () => {
  it("shows the hosted game detail: author, players, categories, actions, description", async () => {
    renderAt("/game/drawphone");

    expect(await screen.findByRole("heading", { name: "Drawphone" })).toBeInTheDocument();
    expect(screen.getByText("by Tanner Krewson")).toBeInTheDocument();
    expect(screen.getByText("1–64 players")).toBeInTheDocument();
    expect(screen.getByText("Drawing")).toBeInTheDocument();
    expect(screen.getByText("Very simple")).toBeInTheDocument();
    expect(screen.getByText(/In Drawphone, there are no winners/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Play game/ })).not.toBeInTheDocument();
    const start = screen.getByRole("link", { name: /Start party/ });
    expect(start.getAttribute("href")).toBe("/party?gameId=drawphone&title=Drawphone");
    const guide = screen.getByRole("link", { name: /How to play/ });
    expect(guide).toHaveAttribute("href", "https://drawphone.tannerkrewson.com/how-to-play");
    expect(guide).toHaveAttribute("target", "_blank");
    expect(screen.getByTestId("browser-brand-row")).toHaveTextContent("rocketcrab.com");
  });

  it("puts the facts and actions above the screenshots and the About text", async () => {
    renderAt("/game/drawphone");
    await screen.findByRole("heading", { name: "Drawphone" });

    const before = (a: Element, b: Element) =>
      (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    const screenshots = screen.getByRole("region", { name: "Screenshots" });
    const about = screen.getByRole("region", { name: "About" });
    expect(before(screen.getByText("Drawing"), screenshots)).toBe(true);
    expect(before(screen.getByRole("link", { name: /Start party/ }), screenshots)).toBe(true);
    expect(before(screenshots, about)).toBe(true);
    // The game's own links live with its description.
    expect(about).toContainElement(screen.getByText("drawphone.tannerkrewson.com"));
    expect(about).toContainElement(screen.getByText("Buy Tanner a taco!"));
  });

  it("rejoins hard-wrapped description lines into paragraphs", async () => {
    renderAt("/game/drawphone");
    await screen.findByRole("heading", { name: "Drawphone" });

    const first = screen.getByText(/In Drawphone, there are no winners/);
    expect(first.textContent).toContain("Players take turns drawing");
    expect(first.textContent).not.toMatch(/\n/);
    expect(screen.getByText(/Drawphone was inspired by/)).not.toBe(first);
  });

  it("shows an error panel for an unknown game id", async () => {
    renderAt("/game/not-a-game");

    expect(await screen.findByText("Unknown game")).toBeInTheDocument();
    const back = screen.getByRole("link", { name: "Back to games" });
    expect(back.getAttribute("href")).toBe("/browse");
  });
});
