import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { routeTree } from "../../routeTree.gen";

/**
 * AppLayout tests (7.47, 11.1): the shared shell has NO navbar, no footer,
 * and no wordmark bar — just the page column plus ONE floating theme/color
 * control pinned to the BOTTOM-RIGHT corner of the screen (safe-area aware)
 * on every page, party routes included. Every content page carries its own
 * way back home (back buttons / home links), since the navbar no longer
 * provides it.
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

  it("renders no navbar or wordmark bar on any page", async () => {
    renderAt("/about");
    await screen.findByRole("heading", { name: "Coming soon" });

    expect(screen.queryByRole("banner")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Rocketcrab home/ })).not.toBeInTheDocument();
    expect(screen.queryByText("🦀")).not.toBeInTheDocument();
    expect(screen.queryByText("🚀")).not.toBeInTheDocument();
  });

  it("floats the theme/color controls in the bottom-right corner on every page", async () => {
    renderAt("/about");
    await screen.findByRole("heading", { name: "Coming soon" });

    const control = screen.getByTestId("floating-theme-control");
    expect(control.className).toContain("fixed");
    expect(control.className).toContain("bottom");
    expect(control.className).toContain("right");

    // Icon-only theme/color controls: labels are accessible, no visible text.
    expect(screen.getByRole("button", { name: "Light theme" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Dark theme" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Random theme" })).toBeInTheDocument();
    expect(screen.queryByText("Light")).not.toBeInTheDocument();
    expect(screen.queryByText("Dark")).not.toBeInTheDocument();
  });

  it("keeps the same floating bottom-right theme control on party routes", async () => {
    renderAt("/join");
    await screen.findByRole("heading", { name: "Join a party" });

    const control = screen.getByTestId("floating-theme-control");
    expect(control.className).toContain("fixed");
    expect(control.className).toContain("bottom");
    expect(control.className).toContain("right");
    expect(screen.getByRole("button", { name: "Light theme" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Dark theme" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Random theme" })).toBeInTheDocument();
    // Party routes keep their own classic shell chrome (PartyShellHeader), but
    // there is no app-level wordmark bar and no footer anywhere.
    expect(screen.queryByRole("link", { name: /Rocketcrab home/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("contentinfo")).not.toBeInTheDocument();
  });

  it("keeps theme controls reachable on the library page, which links back home and to browse", async () => {
    renderAt("/library");
    await screen.findByRole("heading", { name: "My games" });

    expect(screen.getByRole("button", { name: "Dark theme" })).toBeInTheDocument();
    const home = screen.getByRole("link", { name: "Back to home" });
    expect(home.getAttribute("href")).toBe("/");
    const browse = screen.getByRole("link", { name: /Browse games/ });
    expect(browse.getAttribute("href")).toBe("/browse");
  });

  it("gives every content page an explicit way back home (11.1)", async () => {
    for (const [path, heading] of [
      ["/browse", "Games"],
      ["/library", "My games"],
      ["/examples", "Example games"],
      ["/about", "Coming soon"],
      ["/build", "Build a game"],
    ] as const) {
      renderAt(path);
      await screen.findByRole("heading", { name: heading });
      const home = screen.getByRole("link", { name: "Back to home" });
      expect(home.getAttribute("href")).toBe("/");
    }
  });
});
