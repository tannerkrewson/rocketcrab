import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { routeTree } from "../routeTree.gen";

// jsdom does not provide AnimationEvent, so React otherwise skips registering
// its animation event plugin. Install the smallest test-only implementation
// before React DOM is loaded so lifecycle events can be exercised here.
vi.hoisted(() => {
  const testWindow = window as unknown as { AnimationEvent?: unknown; Event: typeof Event };
  if (testWindow.AnimationEvent === undefined) {
    const WindowEvent = testWindow.Event;

    class TestAnimationEvent extends WindowEvent {
      readonly animationName: string;

      constructor(type: string, init?: EventInit & { animationName?: string }) {
        super(type, init);
        this.animationName = init?.animationName ?? "";
      }
    }

    Object.defineProperty(window, "AnimationEvent", {
      configurable: true,
      value: TestAnimationEvent,
    });
  }
});

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
    const logo = screen.getByTestId("brand-logo");
    expect(logo.querySelector('img[src="/rocketcrab-logo.svg"]')).not.toBeNull();
    expect(screen.queryByText("🦀")).not.toBeInTheDocument();
    expect(screen.queryByText("🚀")).not.toBeInTheDocument();
    expect(screen.getByText("party games for phones")).toBeInTheDocument();
    const alert = screen.getByRole("link", { name: /Introducing Nova/ });
    // Shares the /build hero's view-transition name so it expands into it.
    expect(alert).toHaveClass("vt-nova-hero");
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
    const links = within(primaryRow).getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual(["Join party", "Start party"]);
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

  it("styles the party buttons solid primary and the stack as equal-width glass (2t1.8/5cl.5)", async () => {
    renderHome();
    const primaryRow = await screen.findByRole("region", { name: "Start or join a party" });
    for (const link of within(primaryRow).getAllByRole("link")) {
      expect(link).toHaveClass("button--primary");
    }
    const more = await screen.findByRole("region", { name: "More" });
    for (const link of within(more).getAllByRole("link")) {
      expect(link).toHaveClass("button--tertiary", "w-full", "justify-center");
      expect(link).not.toHaveClass("button--danger");
    }
  });

  it("scales the title down on press (2t1.8)", async () => {
    renderHome();
    const title = await screen.findByRole("heading", { name: "rocketcrab.com" });
    expect(title).toHaveClass("active:scale-95", "transition-transform", "cursor-pointer");
  });

  it("runs the logo through shake, launch, and return phases without duplicating repeats", async () => {
    const user = userEvent.setup();
    renderHome();

    const launchButton = await screen.findByRole("button", { name: "Launch Rocketcrab" });
    const logoAnimation = screen.getByTestId("logo-animation");
    expect(logoAnimation).not.toHaveClass("rc-logo-shake", "rc-logo-launch", "rc-logo-return");

    await user.click(launchButton);
    await user.click(launchButton);
    expect(logoAnimation).toHaveClass("rc-logo-shake");

    const finishAnimation = (animationName: string) =>
      fireEvent.animationEnd(logoAnimation, { animationName });

    finishAnimation("rc-logo-shake");
    expect(logoAnimation).toHaveClass("rc-logo-launch");
    finishAnimation("rc-logo-launch");
    expect(logoAnimation).toHaveClass("rc-logo-return");
    finishAnimation("rc-logo-return");
    expect(logoAnimation).not.toHaveClass("rc-logo-shake", "rc-logo-launch", "rc-logo-return");
  });

  it("activates the logo launch control from the keyboard", async () => {
    const user = userEvent.setup();
    renderHome();

    const launchButton = await screen.findByRole("button", { name: "Launch Rocketcrab" });
    launchButton.focus();
    await user.keyboard("{Enter}");

    expect(screen.getByTestId("logo-animation")).toHaveClass("rc-logo-shake");
  });

  it("keeps the logo still when reduced motion is requested", async () => {
    const originalMatchMedia = window.matchMedia;
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn(() => ({ matches: true }) as MediaQueryList),
    });

    try {
      renderHome();
      const launchButton = await screen.findByRole("button", { name: "Launch Rocketcrab" });
      const logoAnimation = screen.getByTestId("logo-animation");

      await userEvent.click(launchButton);

      expect(logoAnimation).not.toHaveClass("rc-logo-shake", "rc-logo-launch", "rc-logo-return");
    } finally {
      Object.defineProperty(window, "matchMedia", {
        configurable: true,
        value: originalMatchMedia,
      });
    }
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
    partyStub.party.active = true;
    renderHome();
    await screen.findByRole("heading", { name: "rocketcrab.com" });

    await vi.waitFor(() => expect(partyStub.engine.leaveParty).toHaveBeenCalledTimes(1));
    expect(toastMock.success).toHaveBeenCalledWith("You left the party.");
  });
});
