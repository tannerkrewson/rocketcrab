import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildMasterPrompt } from "../lib/prompt/master-prompt";
import { routeTree } from "../routeTree.gen";

const PROMPT = buildMasterPrompt();

function renderBuild(initialEntry = "/build") {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [initialEntry] }),
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return render(<RouterProvider router={router} />, { wrapper });
}

beforeEach(() => {
  window.history.pushState({}, "", "/");
  window.localStorage.clear();
  sessionStorage.clear();
});

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  delete (navigator as { clipboard?: unknown }).clipboard;
});

describe("/build — page 1 (hero)", () => {
  it("opens with one cohesive 'Introducing Nova' hero card and three steps (gmo)", async () => {
    renderBuild();

    const hero = await screen.findByTestId("build-hero");
    // The hero sits directly on the full-page blue molten metal background.
    expect(hero.className).not.toContain("border");

    const logo = hero.querySelector("img");
    expect(logo?.getAttribute("src")).toBe("/rocketcrab-logo-no-glow.svg");
    expect(logo?.style.height).toBe("min(80px, 16vw)");

    expect(
      await within(hero).findByRole("heading", { name: "Introducing Nova" }),
    ).toBeInTheDocument();
    expect(within(hero).getByText("Nova").className).toContain("text-nova-text");

    expect(
      screen.getByText("Turn any idea into a game your friends can play."),
    ).toBeInTheDocument();

    const cta = within(hero).getByRole("link", { name: "Get started" });
    expect(cta.getAttribute("href")).toBe("/editor");
    expect(cta.className).toContain("button--primary");
    expect(cta.className).toContain("drop-shadow");

    expect(screen.queryByRole("link", { name: /rocketcrab\.com — home/ })).not.toBeInTheDocument();
    expect(screen.queryByTestId("paste-target")).not.toBeInTheDocument();

    const steps = screen.getByRole("list", { name: "How to build a game" });
    const items = within(steps).getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(within(items[0]!).getByText("Get the prompt")).toBeInTheDocument();
    expect(within(items[1]!).getByText("Describe your game")).toBeInTheDocument();
    expect(within(items[2]!).getByText("Paste it in the editor")).toBeInTheDocument();
  });

  it("no longer offers the start-another-way row (9fv.11.14)", async () => {
    renderBuild();

    await screen.findByRole("heading", { name: "Introducing Nova" });

    expect(screen.queryByRole("button", { name: "Open the editor" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "See example games" })).not.toBeInTheDocument();
    expect(screen.queryByText("Or start another way")).not.toBeInTheDocument();
  });
});

describe("Build to editor", () => {
  async function startBuilding() {
    renderBuild();
    await userEvent.click(await screen.findByRole("link", { name: "Get started" }));
    return screen.findByTestId("editor-empty-state");
  }

  it("shows the full prompt on demand and keeps import available without copying", async () => {
    const empty = within(await startBuilding());

    await userEvent.click(empty.getByText(/Show the full prompt/));
    expect(empty.getByText(/Nova API — AI Quick Reference/)).toBeVisible();
    expect(empty.getByRole("button", { name: "Paste game" })).toBeVisible();
    expect(empty.getByRole("button", { name: "Upload HTML file" })).toBeVisible();
  });

  it("copies the full prompt and gives next steps alongside the import controls", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    const empty = within(await startBuilding());

    await userEvent.click(empty.getByRole("button", { name: "Copy prompt" }));

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith(PROMPT);
    expect(await empty.findByText("Prompt copied.")).toBeInTheDocument();
    expect(empty.getByText(/Paste it into your AI chat/)).toBeVisible();
    expect(empty.getByRole("button", { name: "Paste game" })).toBeVisible();
    expect(screen.queryByTestId("editor-tutorial")).not.toBeInTheDocument();
  });

  it("redirects a legacy prompt link to the editor", async () => {
    renderBuild("/build?page=prompt");
    expect(await screen.findByTestId("editor-empty-state")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(await screen.findByRole("heading", { name: "Introducing Nova" })).toBeVisible();
  });
});
