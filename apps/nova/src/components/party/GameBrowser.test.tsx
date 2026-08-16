import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRouter,
  createRootRoute,
  createRoute,
} from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { gameRepository } from "../../lib/games/instance";
import { GameBrowser } from "./GameBrowser";

/**
 * GameBrowser party-exit tests (rocketcrab-8z9): the browser's exit links —
 * the empty saved-list "New game" action and the saved-game "Open in
 * editor" row action — leave the party flow entirely. In party mode
 * (`inParty`) they must ask "Leave the party?" first and only navigate
 * after the player confirms (leaving the party first); standalone they
 * keep navigating straight away.
 */

const { leavePartyMock } = vi.hoisted(() => ({
  leavePartyMock: vi.fn(async () => undefined),
}));

vi.mock("../../lib/party/use-party", () => ({
  usePartyEngine: () => ({
    state: { phase: "lobby" },
    engine: { leaveParty: leavePartyMock },
  }),
}));

async function renderBrowser(
  props: Partial<ComponentProps<typeof GameBrowser>> & { inParty?: boolean } = {},
) {
  cleanup();
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const buildRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/build",
    component: () => null,
  });
  const editRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/games/$gameId/edit",
    component: () => null,
  });
  const browserRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => <GameBrowser compact {...props} />,
  });
  const routeTree = rootRoute.addChildren([buildRoute, editRoute, browserRoute]);
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const result = render(<RouterProvider router={router} />, { wrapper });
  await result.findByRole("searchbox", { name: "Search games" });
  return router;
}

beforeEach(async () => {
  await gameRepository.clear();
  leavePartyMock.mockClear();
});

describe("GameBrowser exit links (8z9)", () => {
  it("asks 'Leave the party?' before New game in party mode, and leaves first (8z9)", async () => {
    const router = await renderBrowser({ inParty: true });

    // Empty saved list -> the New-game action in the My games category.
    await userEvent.click(screen.getByRole("button", { name: /My games/ }));
    const newGame = await screen.findByRole("button", { name: "New game" });
    await userEvent.click(newGame);

    // The prompt appears first — nothing navigated and nothing left yet.
    const dialog = screen.getByRole("dialog", { name: "Leave the party?" });
    expect(within(dialog).getByText(/you'll leave this party first/)).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/");
    expect(leavePartyMock).not.toHaveBeenCalled();

    // Staying keeps you in the party and on the browse page.
    await userEvent.click(within(dialog).getByRole("button", { name: "Stay in party" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/");
    expect(leavePartyMock).not.toHaveBeenCalled();

    // Confirming leaves the party and then opens the game builder.
    await userEvent.click(screen.getByRole("button", { name: "New game" }));
    await userEvent.click(
      within(screen.getByRole("dialog", { name: "Leave the party?" })).getByRole("button", {
        name: "Leave party",
      }),
    );
    await waitFor(() => expect(router.state.location.pathname).toBe("/build"));
    expect(leavePartyMock).toHaveBeenCalledTimes(1);
  });

  it("asks before Open in editor in party mode too (8z9)", async () => {
    const game = await gameRepository.create({
      title: "Rocket Rumble",
      html: "<!doctype html><html><body><p>rockets</p></body></html>",
      mode: "state",
    });
    const router = await renderBrowser({ inParty: true });

    await userEvent.click(screen.getByRole("button", { name: /My games/ }));
    const editorButton = await screen.findByRole("button", { name: /open in editor/i });
    await userEvent.click(editorButton);

    const dialog = screen.getByRole("dialog", { name: "Leave the party?" });
    expect(
      within(dialog).getByText(/open the editor, you'll leave this party/i),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/");
    expect(leavePartyMock).not.toHaveBeenCalled();

    await userEvent.click(within(dialog).getByRole("button", { name: "Leave party" }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/games/${game.id}/edit`));
    expect(leavePartyMock).toHaveBeenCalledTimes(1);
  });

  it("does not prompt outside a party — New game stays a plain link (8z9)", async () => {
    const router = await renderBrowser({ inParty: false });

    // No party: the New-game action is a plain link to the builder.
    await userEvent.click(screen.getByRole("button", { name: /My games/ }));
    const newGameLink = await screen.findByRole("link", { name: "New game" });
    expect(newGameLink.getAttribute("href")).toBe("/build");
    expect(leavePartyMock).not.toHaveBeenCalled();
    expect(router.state.location.pathname).toBe("/");
  });

  it("does not prompt outside a party — Open in editor stays a plain link (8z9)", async () => {
    const game = await gameRepository.create({
      title: "Rocket Rumble",
      html: "<!doctype html><html><body><p>rockets</p></body></html>",
      mode: "state",
    });
    const router = await renderBrowser({ inParty: false });

    await userEvent.click(screen.getByRole("button", { name: /My games/ }));
    const editorLink = await screen.findByRole("link", { name: /open in editor/i });
    expect(editorLink.getAttribute("href")).toBe(`/games/${game.id}/edit`);
    expect(leavePartyMock).not.toHaveBeenCalled();
    expect(router.state.location.pathname).toBe("/");
  });
});
