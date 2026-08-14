import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { gameRepository } from "../lib/games/instance";
import { routeTree } from "../routeTree.gen";

/**
 * Library page integration test (U2): renders the real /library route through
 * the TanStack Router with the repository over fake-indexeddb, covering the
 * list, search, duplicate, and confirm-before-delete flows.
 */

function renderLibrary() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ["/library"] }),
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return render(<RouterProvider router={router} />, { wrapper });
}

beforeEach(async () => {
  await gameRepository.clear();
});

describe("/library", () => {
  it("shows the empty state when there are no saved games", async () => {
    renderLibrary();
    expect(await screen.findByText("No saved games yet")).toBeInTheDocument();
  });

  it("links back home and offers equal-sized browse/build actions", async () => {
    // Seed a game so the empty-state CTA (a second "Build a game" link)
    // does not collide with the header action under test.
    await gameRepository.create({ title: "Rockets", html: "<p>a</p>" });
    renderLibrary();

    // The Home link (rocketcrab-9fv.11.13) keeps the page reachable from
    // the homepage now that the shared footer is gone.
    const home = await screen.findByRole("link", { name: "Home" });
    expect(home.getAttribute("href")).toBe("/");
    expect(home.className).toContain("btn-outline");
    expect(home.className).toContain("self-start");

    // "Browse games" and "Build a game" share the same variant and size
    // (rocketcrab-9fv.11.13) so the header actions render consistently.
    const browse = screen.getByRole("link", { name: "Browse games" });
    const build = screen.getByRole("link", { name: "Build a game" });
    expect(browse.className).toContain("btn-primary");
    expect(browse.className).toContain("btn-lg");
    expect(build.className).toContain("btn-primary");
    expect(build.className).toContain("btn-lg");
  });

  it("lists saved games with their metadata", async () => {
    await gameRepository.create({
      title: "Rocket Rumble",
      description: "Fight in space",
      html: "<p>rockets</p>",
      mode: "state",
    });
    await gameRepository.create({ title: "Card Sharks", html: "<p>cards</p>" });

    renderLibrary();
    expect(await screen.findByText("Rocket Rumble")).toBeInTheDocument();
    expect(screen.getByText("Card Sharks")).toBeInTheDocument();
    expect(screen.getByText("state mode")).toBeInTheDocument();
    expect(screen.getAllByText("Not tested")).toHaveLength(2);
  });

  it("filters games as you type in the search box", async () => {
    await gameRepository.create({ title: "Rocket Rumble", html: "<p>a</p>" });
    await gameRepository.create({ title: "Card Sharks", html: "<p>b</p>" });

    renderLibrary();
    expect(await screen.findByText("Rocket Rumble")).toBeInTheDocument();

    const searchBox = screen.getByRole("searchbox", { name: "Search your games" });
    await userEvent.type(searchBox, "sharks");
    await waitFor(() => expect(screen.queryByText("Rocket Rumble")).not.toBeInTheDocument());
    expect(screen.getByText("Card Sharks")).toBeInTheDocument();

    await userEvent.type(searchBox, "zzz");
    expect(await screen.findByText("No games match")).toBeInTheDocument();
  });

  it("deletes a game only after confirmation", async () => {
    const game = await gameRepository.create({ title: "Doomed", html: "<p>x</p>" });
    renderLibrary();

    const card = (await screen.findByText("Doomed")).closest("li");
    expect(card).not.toBeNull();
    const cardScope = within(card as HTMLElement);

    // Delete opens the confirmation dialog; the game stays listed until confirmed.
    await userEvent.click(cardScope.getByRole("button", { name: /^Delete$/ }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Doomed")).toBeInTheDocument();

    // Cancel keeps the game.
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByText("Doomed")).toBeInTheDocument();

    // Confirm deletes it.
    await userEvent.click(cardScope.getByRole("button", { name: /^Delete$/ }));
    await userEvent.click(await screen.findByRole("button", { name: "Delete game" }));
    await waitFor(() => expect(screen.queryByText("Doomed")).not.toBeInTheDocument());
    expect(await screen.findByText("No saved games yet")).toBeInTheDocument();
    await expect(gameRepository.read(game.id)).rejects.toMatchObject({ code: "not_found" });
  });

  it("duplicates a game from its card", async () => {
    await gameRepository.create({ title: "Rockets", html: "<p>x</p>" });
    renderLibrary();

    const card = (await screen.findByText("Rockets")).closest("li");
    expect(card).not.toBeNull();
    await userEvent.click(within(card as HTMLElement).getByRole("button", { name: /duplicate/i }));

    expect(await screen.findByText("Rockets (copy)")).toBeInTheDocument();
    expect(screen.getByText("Rockets")).toBeInTheDocument();
  });
});
