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
  it("shows the empty state with only the header New-game CTA (2t1.5/ini)", async () => {
    renderLibrary();
    expect(await screen.findByText("No saved games yet")).toBeInTheDocument();
    const ctas = screen.getAllByRole("link", { name: "New game" });
    expect(ctas).toHaveLength(1);
    expect(ctas[0]!.getAttribute("href")).toBe("/build");
    expect(screen.queryByText(/Games are saved right in this browser/)).not.toBeInTheDocument();
  });

  it("shows ONE back button and a New-game action in the header (2t1.5)", async () => {
    await gameRepository.create({ title: "Rockets", html: "<p>a</p>" });
    renderLibrary();

    expect(await screen.findByRole("link", { name: /rocketcrab\.com/ })).toBeInTheDocument();

    const backs = screen.getAllByRole("link", { name: "back" });
    expect(backs).toHaveLength(1);
    const back = backs[0];
    expect(back!.getAttribute("href")).toBe("/");
    expect(back!.className).toContain("button--tertiary");
    expect(back!.className).toContain("self-start");
    expect(screen.queryByRole("link", { name: /Browse games/ })).not.toBeInTheDocument();

    const build = screen.getByRole("link", { name: "New game" });
    expect(build.getAttribute("href")).toBe("/build");
    expect(build.className).toContain("button--primary");
    expect(build.className).toContain("button--lg");
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

    await userEvent.click(cardScope.getByRole("button", { name: /^Delete$/ }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Doomed")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByText("Doomed")).toBeInTheDocument();

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
