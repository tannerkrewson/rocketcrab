import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { routeTree } from "../routeTree.gen";

/**
 * Home route tests (7.20/7.35/7.47): the brand header — crab logo, the
 * rocketcrab.com title, the "Introducing Nova" alert — side-by-side
 * Join/Start party primaries (Join first), and a content-hugging secondary
 * action column (no recent-games browser since 7.35).
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
  it("shows the brand header: logo, title, tagline, and the Introducing Nova alert", async () => {
    renderHome();
    expect(await screen.findByRole("heading", { name: "rocketcrab.com" })).toBeInTheDocument();
    // The brand mark is the real rocket + crab SVG pair (11.2) — decorative
    // behind the h1 (aria-hidden), never the 🦀🚀 emoji pair.
    const logo = screen.getByTestId("brand-logo");
    expect(logo.querySelector('img[src="/rocket.svg"]')).not.toBeNull();
    expect(logo.querySelector('img[src="/crab.svg"]')).not.toBeNull();
    expect(screen.queryByText("🦀")).not.toBeInTheDocument();
    expect(screen.queryByText("🚀")).not.toBeInTheDocument();
    expect(screen.getByText("party games for phones")).toBeInTheDocument();
    const alert = screen.getByRole("status");
    expect(within(alert).getByText("Introducing Nova")).toBeInTheDocument();
    expect(
      within(alert).getByText("Build your own games and play them with friends, instantly."),
    ).toBeInTheDocument();
  });

  it("shows Join party before Start party in the primary row", async () => {
    renderHome();
    const primaryRow = await screen.findByRole("region", { name: "Start or join a party" });
    expect(primaryRow).toBeInTheDocument();
    const links = within(primaryRow).getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual(["Join party", "Start party"]);
  });

  it("lists the secondary actions column below the primaries", async () => {
    renderHome();
    const more = await screen.findByRole("region", { name: "More" });
    expect(within(more).getByRole("link", { name: "Build a game" })).toBeInTheDocument();
    expect(within(more).getByRole("link", { name: "My games" })).toBeInTheDocument();
    expect(within(more).getByRole("link", { name: "About" })).toBeInTheDocument();
  });

  it("no longer shows the Recent games section (7.35)", async () => {
    renderHome();
    await screen.findByRole("heading", { name: "rocketcrab.com" });
    expect(screen.queryByRole("heading", { name: "Recent games" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "See all" })).not.toBeInTheDocument();
    expect(screen.queryByText("No games yet")).not.toBeInTheDocument();
  });
});
