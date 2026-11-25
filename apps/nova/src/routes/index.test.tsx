import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { routeTree } from "../routeTree.gen";

const { toastMock, partyStub } = vi.hoisted(() => {
  const party: { active: boolean; phase: string } = { active: false, phase: "lobby" };
  const engine = {
    isActive: vi.fn(() => party.active),
    leaveParty: vi.fn(async () => undefined),
  };
  return {
    toastMock: { success: vi.fn() },
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

vi.mock("../lib/toast", () => ({ toast: toastMock }));
// Control the active-party guard through the stub rather than the idle singleton.
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
  return { router, ...render(<RouterProvider router={router} />, { wrapper }) };
}

beforeEach(() => {
  cleanup();
  toastMock.success.mockClear();
  partyStub.engine.isActive.mockClear();
  partyStub.engine.leaveParty.mockClear();
  // Default: no active party, so the guard is a no-op for the page tests.
  partyStub.party.active = false;
});

describe("/", () => {
  it("shows the brand header: logo, title, tagline, and the Introducing Nova alert", async () => {
    renderHome();
    expect(await screen.findByRole("heading", { name: "rocketcrab.com" })).toBeInTheDocument();
    const logo = screen.getByTestId("brand-logo");
    expect(logo).toHaveAttribute("src", "/rocketcrab-logo-no-glow.svg");
    expect(screen.queryByText("🦀")).not.toBeInTheDocument();
    expect(screen.queryByText("🚀")).not.toBeInTheDocument();
    expect(screen.getByText("party games for phones")).toBeInTheDocument();
    const alert = screen.getByRole("link", { name: /Introducing Nova/ });
    expect(alert).toHaveTextContent(/^Introducing Nova/);
    expect(within(alert).getByText("Nova")).toHaveClass("text-nova-text");
    expect(
      within(alert).getByText("Build your own games and play them with friends, instantly."),
    ).toBeInTheDocument();
    expect(alert).toHaveAttribute("href", "/build");
  });

  it("navigates to Build when the entire Introducing Nova alert is activated", async () => {
    const user = userEvent.setup();
    renderHome();

    const alert = await screen.findByRole("link", { name: /Introducing Nova/ });
    await user.click(alert);

    expect(await screen.findByRole("heading", { name: /Introducing Nova/ })).toBeInTheDocument();
  });

  it("shows Join party before Start party in the primary row", async () => {
    renderHome();
    const primaryRow = await screen.findByRole("region", { name: "Start or join a party" });
    expect(primaryRow).toBeInTheDocument();
    const join = within(primaryRow).getByRole("button", { name: "Join party" });
    expect(
      join.compareDocumentPosition(within(primaryRow).getByRole("link", { name: "Start party" })),
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it("takes a party code in the join popup, with no start-party button", async () => {
    const { router } = renderHome();
    await userEvent.click(await screen.findByRole("button", { name: "Join party" }));
    const dialog = await screen.findByRole("dialog", { name: "Join a party" });
    expect(within(dialog).getByText(/invite link/)).toBeInTheDocument();
    expect(within(dialog).queryByRole("link", { name: /start/i })).not.toBeInTheDocument();
    const join = within(dialog).getByRole("button", { name: "Join party" });
    const input = within(dialog).getByLabelText("Party code");
    // Letters only, lowercased, four at most.
    await userEvent.type(input, "Ab1c");
    expect(input).toHaveValue("abc");
    expect(join).toBeDisabled();
    await userEvent.type(input, "D");
    await userEvent.click(join);
    await waitFor(() => expect(router.state.location.pathname).toBe("/abcd"));
  });

  it("lists the secondary actions column below the primaries", async () => {
    renderHome();
    const more = await screen.findByRole("region", { name: "More" });
    const links = within(more).getAllByRole("link");
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

  it("styles the party buttons solid primary and the stack as glass", async () => {
    renderHome();
    const primaryRow = await screen.findByRole("region", { name: "Start or join a party" });
    for (const button of Array.from(primaryRow.children)) {
      expect(button).toHaveClass("button--primary");
    }
    expect(primaryRow).toHaveClass("button-row");
    const more = await screen.findByRole("region", { name: "More" });
    expect(more).toHaveClass("button-stack");
    for (const link of within(more).getAllByRole("link")) {
      expect(link).toHaveClass("button--tertiary");
      expect(link).not.toHaveClass("button--danger");
    }
  });

  it("makes the crab a launch button and leaves the wordmark as plain text", async () => {
    renderHome();
    const title = await screen.findByRole("heading", { name: "rocketcrab.com" });
    expect(title).not.toHaveAttribute("tabindex");
    expect(screen.getByRole("button", { name: "Launch rocketcrab" })).toContainElement(
      screen.getByTestId("brand-logo"),
    );
  });

  it("no longer shows the Recent games section", async () => {
    renderHome();
    await screen.findByRole("heading", { name: "rocketcrab.com" });
    expect(screen.queryByRole("heading", { name: "Recent games" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "See all" })).not.toBeInTheDocument();
    expect(screen.queryByText("No games yet")).not.toBeInTheDocument();
  });

  it("renders the title in the Inconsolata Variable brand font", async () => {
    renderHome();
    const title = await screen.findByRole("heading", { name: "rocketcrab.com" });
    expect(title).toHaveClass("font-title");
  });

  it("leaves any active party when the homepage is shown", async () => {
    partyStub.party.active = true;
    renderHome();
    await screen.findByRole("heading", { name: "rocketcrab.com" });

    await vi.waitFor(() => expect(partyStub.engine.leaveParty).toHaveBeenCalledTimes(1));
    expect(toastMock.success).toHaveBeenCalledWith("You left the party.");
  });
});
