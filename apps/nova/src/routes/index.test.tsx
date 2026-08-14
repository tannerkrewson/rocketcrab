import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { routeTree } from "../routeTree.gen";

/**
 * Home route tests (7.20/7.35/7.47): the brand header — crab logo, the
 * rocketcrab.com title, the "Introducing Nova" alert — side-by-side
 * Join/Start party primaries (Join first), and a content-hugging secondary
 * action column (no recent-games browser since 7.35). Since 9fv.11.4 the
 * title taps to copy the domain; since 9fv.11.5 it renders in the
 * Inconsolata Variable brand font and the stack gains a Browse games link.
 */

const { toastMock } = vi.hoisted(() => ({
  toastMock: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("sonner", () => ({ toast: toastMock }));

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
  toastMock.success.mockClear();
  toastMock.error.mockClear();
});

afterEach(() => {
  delete (navigator as { clipboard?: unknown }).clipboard;
});

describe("/", () => {
  it("shows the brand header: logo, title, tagline, and the Introducing Nova alert", async () => {
    renderHome();
    expect(await screen.findByRole("heading", { name: "rocketcrab.com" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Rocketcrab logo" })).toHaveAttribute(
      "src",
      "/crab.svg",
    );
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
    expect(within(more).getByRole("link", { name: "Browse games" })).toHaveAttribute(
      "href",
      "/browse",
    );
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

  it("renders the title in the Inconsolata Variable brand font (9fv.11.5)", async () => {
    renderHome();
    const title = await screen.findByRole("heading", { name: "rocketcrab.com" });
    expect(title).toHaveClass("font-title");
  });

  it("copies the title to the clipboard on tap and shows a toast (9fv.11.4)", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    renderHome();

    const title = await screen.findByRole("heading", { name: "rocketcrab.com" });
    expect(title).toHaveAttribute("title", "Copy rocketcrab.com to your clipboard");

    await userEvent.click(title);

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith("rocketcrab.com");
    expect(toastMock.success).toHaveBeenCalledWith("Copied rocketcrab.com to your clipboard.");
    expect(toastMock.error).not.toHaveBeenCalled();
  });
});
