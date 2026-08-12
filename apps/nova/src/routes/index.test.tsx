import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { routeTree } from "../routeTree.gen";

/**
 * Home route tests (7.20): the classic-conformed layout — tagline, side-by-side
 * Start/Join party primaries, secondary action column, and Recent games below.
 */

function renderHome() {
  cleanup();
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  const wrapper = ({ children }: { children: ReactNode }) => <>{children}</>;
  return render(<RouterProvider router={router} />, { wrapper });
}

beforeEach(() => {
  cleanup();
});

describe("/", () => {
  it("shows the classic tagline and side-by-side Start/Join party buttons", async () => {
    renderHome();
    expect(await screen.findByRole("heading", { name: /Rocketcrab Nova/ })).toBeInTheDocument();
    expect(screen.getByText("party games for phones")).toBeInTheDocument();
    const primaryRow = screen.getByRole("region", { name: "Start or join a party" });
    expect(primaryRow).toBeInTheDocument();
    expect(within(primaryRow).getByRole("link", { name: "Start party" })).toBeInTheDocument();
    expect(within(primaryRow).getByRole("link", { name: "Join party" })).toBeInTheDocument();
  });

  it("lists the secondary actions column below the primaries", async () => {
    renderHome();
    const more = await screen.findByRole("region", { name: "More" });
    expect(within(more).getByRole("link", { name: "Build a game" })).toBeInTheDocument();
    expect(within(more).getByRole("link", { name: "My games" })).toBeInTheDocument();
    expect(within(more).getByRole("link", { name: "About" })).toBeInTheDocument();
  });

  it("keeps the Recent games section at the bottom", async () => {
    renderHome();
    expect(await screen.findByRole("heading", { name: "Recent games" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "See all" })).toBeInTheDocument();
  });
});
