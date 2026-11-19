import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { routeTree } from "../../routeTree.gen";

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
  it("credits the author and links GitHub at the bottom of every page", async () => {
    renderAt("/about");
    await screen.findByRole("heading", { name: "Coming soon" });

    const footer = screen.getByRole("contentinfo");
    expect(footer).toHaveTextContent("rocketcrab by Tanner Krewson");
    const author = within(footer).getByRole("link", { name: "Tanner Krewson" });
    expect(author).toHaveAttribute("href", "https://tannerkrewson.com");
    expect(author).toHaveAttribute("target", "_blank");
    expect(author).toHaveAttribute("rel", "noopener noreferrer");
    const github = within(footer).getByRole("link", { name: "View on GitHub" });
    expect(github).toHaveAttribute("href", "https://github.com/tannerkrewson/rocketcrab");
    expect(github).toHaveAttribute("target", "_blank");
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

  it("layers the page content above the site background", async () => {
    renderAt("/about");
    await screen.findByRole("heading", { name: "Coming soon" });

    // Check stacking classes, not just DOM presence: a negative-z layer can hide behind the shell.
    expect(screen.getByTestId("app-background")).toHaveClass("z-0");
    expect(screen.getByRole("main")).toHaveClass("relative", "z-10");
  });

  it("shows the background on every page when no game is live (5cl.4/22n)", async () => {
    renderAt("/");
    await screen.findByRole("heading", { name: "rocketcrab.com" });
    expect(screen.getByTestId("app-background")).toBeInTheDocument();

    renderAt("/about");
    await screen.findByRole("heading", { name: "Coming soon" });
    expect(screen.getByTestId("app-background")).toBeInTheDocument();
  });

  it("links the library page back home and to build (2t1.5)", async () => {
    renderAt("/library");
    await screen.findByRole("heading", { name: "My games" });

    const home = screen.getByRole("link", { name: "back" });
    expect(home.getAttribute("href")).toBe("/");
    const builds = screen.getAllByRole("link", { name: /New game/ });
    expect(builds.length).toBeGreaterThanOrEqual(1);
    for (const build of builds) {
      expect(build.getAttribute("href")).toBe("/build");
    }
    expect(screen.queryByRole("link", { name: /Browse games/ })).not.toBeInTheDocument();
  });

  it("gives every content page an explicit way back home (11.1/2t1.1)", async () => {
    for (const [path, heading] of [
      ["/browse", "Games"],
      ["/library", "My games"],
      ["/about", "Coming soon"],
    ] as const) {
      renderAt(path);
      await screen.findByRole("heading", { name: heading });
      const brand = screen.getByRole("link", { name: /rocketcrab\.com — home/ });
      expect(brand.getAttribute("href")).toBe("/");
      expect(screen.getByTestId("brand-logo").querySelector("img")).toHaveStyle({
        height: "40px",
      });
    }

    renderAt("/build");
    await screen.findByRole("heading", { name: "Introducing Nova" });
    const buildBack = screen.getByRole("link", { name: "back" });
    expect(buildBack.getAttribute("href")).toBe("/");
  });
});
