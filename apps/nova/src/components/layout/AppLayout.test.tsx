import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { routeTree } from "../../routeTree.gen";

/**
 * AppLayout tests (7.47): the shared shell no longer has a footer — a
 * sticky top bar (wordmark home link + icon-only theme/color controls)
 * renders on every non-party page, and the party routes (/join, /party,
 * /play), which keep their own classic shell chrome, get a compact
 * floating theme control instead. No page should be left without a way
 * back home or to the theme controls.
 */

function renderAt(path: string) {
  cleanup();
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
  cleanup();
  window.history.pushState({}, "", "/");
});

describe("AppLayout", () => {
  it("renders no footer anywhere", async () => {
    renderAt("/about");
    await screen.findByRole("heading", { name: "Coming soon" });

    expect(screen.queryByRole("contentinfo")).not.toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Footer" })).not.toBeInTheDocument();
    expect(screen.queryByText(/party games for phones/)).not.toBeInTheDocument();
  });

  it("renders the top bar with a home link and icon-only theme controls on non-party pages", async () => {
    renderAt("/about");
    await screen.findByRole("heading", { name: "Coming soon" });

    const home = screen.getByRole("link", { name: /Rocketcrab Nova/ });
    expect(home.getAttribute("href")).toBe("/");

    // Icon-only theme/color controls: labels are accessible, no visible text.
    expect(screen.getByRole("button", { name: "Light theme" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Dark theme" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Random theme" })).toBeInTheDocument();
    expect(screen.queryByText("Light")).not.toBeInTheDocument();
    expect(screen.queryByText("Dark")).not.toBeInTheDocument();
  });

  it("renders the compact floating theme control on party routes (no wordmark bar)", async () => {
    renderAt("/play");
    await screen.findByRole("heading", { name: "Play" });

    expect(screen.getByTestId("party-route-theme-control")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Light theme" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Dark theme" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Random theme" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Rocketcrab Nova/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("contentinfo")).not.toBeInTheDocument();
  });

  it("keeps theme controls reachable on the library page, which links back to browse", async () => {
    renderAt("/library");
    await screen.findByRole("heading", { name: "My games" });

    expect(screen.getByRole("button", { name: "Dark theme" })).toBeInTheDocument();
    const browse = screen.getByRole("link", { name: /Browse games/ });
    expect(browse.getAttribute("href")).toBe("/browse");
  });
});
