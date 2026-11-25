import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { gameRepository } from "../lib/games/instance";
import { routeTree } from "../routeTree.gen";

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
  it("shows the empty state with only the header New-game CTA", async () => {
    renderLibrary();
    expect(await screen.findByText("No saved games yet")).toBeInTheDocument();
    const ctas = screen.getAllByRole("link", { name: "New game" });
    expect(ctas).toHaveLength(1);
    expect(ctas[0]!.getAttribute("href")).toBe("/build");
    expect(screen.queryByText(/Games are saved right in this browser/)).not.toBeInTheDocument();
  });

  it("shows ONE back button and a New-game action in the header", async () => {
    await gameRepository.create({ title: "Rockets", html: "<p>a</p>" });
    renderLibrary();

    expect(await screen.findByTestId("browser-brand-row")).toHaveTextContent("rocketcrab.com");

    const backs = screen.getAllByRole("link", { name: "Back" });
    expect(backs).toHaveLength(1);
    const back = backs[0];
    expect(back!.getAttribute("href")).toBe("/");
    expect(back!.className).toContain("button--tertiary");
    // Compact: it sits beside the search box, not across the page.
    expect(back!.className).not.toContain("w-full");
    expect(screen.queryByRole("link", { name: /Browse games/ })).not.toBeInTheDocument();

    const build = screen.getByRole("link", { name: "New game" });
    expect(build.getAttribute("href")).toBe("/build");
    expect(build.className).toContain("button--primary");
  });

  it("lists saved games with a short line of context and Play/Edit", async () => {
    await gameRepository.create({
      title: "Rocket Rumble",
      description: "Fight in space",
      html: "<p>rockets</p>",
    });
    await gameRepository.create({ title: "Card Sharks", html: "<p>cards</p>" });

    renderLibrary();
    expect(await screen.findByText("Rocket Rumble")).toBeInTheDocument();
    expect(screen.getByText("Card Sharks")).toBeInTheDocument();
    // No jargon: mode, size, hash and untested badges are gone.
    expect(screen.queryByText(/state mode/)).not.toBeInTheDocument();
    expect(screen.queryByText("Not tested")).not.toBeInTheDocument();
    expect(screen.getAllByText(/^Edited /)).toHaveLength(2);
    expect(screen.getAllByRole("link", { name: "Edit" })).toHaveLength(2);
    const starts = screen.getAllByRole("link", { name: "Start party" });
    expect(starts).toHaveLength(2);
    expect(starts[0]!.getAttribute("href")).toContain("/party?gameId=");
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

    const openMenu = () => userEvent.click(cardScope.getByLabelText("More actions for Doomed"));
    await openMenu();
    await userEvent.click(cardScope.getByRole("menuitem", { name: "Delete" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Doomed")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByText("Doomed")).toBeInTheDocument();

    await openMenu();
    await userEvent.click(cardScope.getByRole("menuitem", { name: "Delete" }));
    await userEvent.click(await screen.findByRole("button", { name: "Delete game" }));
    await waitFor(() => expect(screen.queryByText("Doomed")).not.toBeInTheDocument());
    expect(await screen.findByText("No saved games yet")).toBeInTheDocument();
    await expect(gameRepository.read(game.id)).rejects.toMatchObject({ code: "not_found" });
  });

  it("shows who shared a game saved from a party", async () => {
    await gameRepository.create({
      title: "Their Game",
      html: "<p>x</p>",
      copiedFrom: { gameId: "game_theirs", sourceHash: "a".repeat(64), sharedBy: "Ada" },
    });
    renderLibrary();
    expect(await screen.findByText(/from Ada/)).toBeInTheDocument();
  });

  it("duplicates a game from its card", async () => {
    await gameRepository.create({ title: "Rockets", html: "<p>x</p>" });
    renderLibrary();

    const card = (await screen.findByText("Rockets")).closest("li");
    expect(card).not.toBeNull();
    const cardScope = within(card as HTMLElement);
    await userEvent.click(cardScope.getByLabelText("More actions for Rockets"));
    await userEvent.click(cardScope.getByRole("menuitem", { name: "Duplicate" }));

    expect(await screen.findByText("Rockets (copy)")).toBeInTheDocument();
    expect(screen.getByText("Rockets")).toBeInTheDocument();
  });
});
