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

const { toastMock, partyStub } = vi.hoisted(() => {
  const party: { active: boolean; phase: string } = { active: false, phase: "lobby" };
  const engine = {
    isActive: vi.fn(() => party.active),
    leaveParty: vi.fn(async () => undefined),
  };
  return {
    toastMock: { success: vi.fn(), error: vi.fn() },
    partyStub: {
      party,
      engine,
      usePartyEngine: () => ({
        state: { phase: party.phase },
        engine,
      }),
    },
  };
});

vi.mock("sonner", () => ({ toast: toastMock }));
// 8z9: the homepage guard leaves any active party — control the engine
// through the stub instead of the real (idle) singleton.
vi.mock("../lib/party/use-party", () => ({
  usePartyEngine: partyStub.usePartyEngine,
}));

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
  partyStub.engine.isActive.mockClear();
  partyStub.engine.leaveParty.mockClear();
  // Default: no active party, so the guard is a no-op for the page tests.
  partyStub.party.active = false;
});

afterEach(() => {
  delete (navigator as { clipboard?: unknown }).clipboard;
});

describe("/", () => {
  it("shows the brand header: logo, title, tagline, and the Introducing Nova alert", async () => {
    renderHome();
    expect(await screen.findByRole("heading", { name: "rocketcrab.com" })).toBeInTheDocument();
    // The brand mark is the real single rocketcrab SVG (5cl.13) — decorative
    // behind the h1 (aria-hidden), never the 🦀🚀 emoji pair.
    const logo = screen.getByTestId("brand-logo");
    expect(logo.querySelector('img[src="/rocketcrab-logo.svg"]')).not.toBeNull();
    expect(screen.queryByText("🦀")).not.toBeInTheDocument();
    expect(screen.queryByText("🚀")).not.toBeInTheDocument();
    expect(screen.getByText("party games for phones")).toBeInTheDocument();
    const alert = screen.getByRole("status");
    // rocketcrab-5cl.6: the daisyUI aura wrapper, glowing orb, and twinkling
    // stars are gone — the alert keeps just its dotted outline and text.
    expect(alert.parentElement).not.toHaveClass("aura");
    expect(document.querySelector(".rc-alert-orb, .rc-alert-star")).toBeNull();
    // rocketcrab-2t1.8: the Nova alert is a dotted outline (not solid).
    expect(alert).toHaveClass("alert-outline", "border-dotted");
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
    const links = within(more).getAllByRole("link");
    // rocketcrab-2t1.1: My games now sits before Browse games; the
    // build-a-game button keeps its original position (pending user
    // clarification on the truncated note).
    expect(links.map((link) => link.textContent)).toEqual([
      "Build a game",
      "My games",
      "Browse games",
      "About",
    ]);
    expect(within(more).getByRole("link", { name: "Browse games" })).toHaveAttribute(
      "href",
      "/browse",
    );
    expect(within(more).getByRole("link", { name: "My games" })).toHaveAttribute(
      "href",
      "/library",
    );
  });

  it("styles the party buttons soft-primary and the stack soft-default (2t1.8/5cl.5)", async () => {
    renderHome();
    const primaryRow = await screen.findByRole("region", { name: "Start or join a party" });
    for (const link of within(primaryRow).getAllByRole("link")) {
      expect(link).toHaveClass("btn-primary", "btn-soft");
    }
    const more = await screen.findByRole("region", { name: "More" });
    for (const link of within(more).getAllByRole("link")) {
      expect(link).toHaveClass("btn-soft");
      expect(link).not.toHaveClass("btn-neutral");
    }
  });

  it("scales the title down on press (2t1.8)", async () => {
    renderHome();
    const title = await screen.findByRole("heading", { name: "rocketcrab.com" });
    expect(title).toHaveClass("active:scale-95", "transition-transform", "cursor-pointer");
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

  it("leaves any active party when the homepage is shown (8z9)", async () => {
    // A party is live (e.g. the user pressed the native back button from
    // the lobby) — sitting on "/" must tear it down, not keep a ghost
    // party running.
    partyStub.party.active = true;
    renderHome();
    await screen.findByRole("heading", { name: "rocketcrab.com" });

    await vi.waitFor(() => expect(partyStub.engine.leaveParty).toHaveBeenCalledTimes(1));
    expect(toastMock.success).toHaveBeenCalledWith("You left the party.");
  });
});
