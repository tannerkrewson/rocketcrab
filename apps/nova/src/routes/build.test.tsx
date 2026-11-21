import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildMasterPrompt } from "../lib/prompt/master-prompt";
import { routeTree } from "../routeTree.gen";

const PROMPT = buildMasterPrompt();

/** GitHub link to the docs, branch-free (GitHub resolves the default branch). */
const NOVA_API_REFERENCE_URL =
  "https://github.com/tannerkrewson/rocketcrab/blob/docs/api/nova-api-ai-reference.md";

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
    expect(cta.getAttribute("href")).toBe("/build?page=prompt");
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

describe("/build?page=prompt — the master-prompt step", () => {
  async function openPromptPage(initialEntry: string) {
    renderBuild(initialEntry);
    await screen.findByRole("heading", { name: "Get the master prompt" });
  }

  it("presents the generated prompt with the embedded API reference", async () => {
    await openPromptPage("/build?page=prompt");

    expect(screen.getByText(new RegExp("Nova Master Prompt"))).toBeInTheDocument();
    expect(screen.getByText(new RegExp("Interview the user first"))).toBeInTheDocument();
    expect(screen.getByText(new RegExp("Nova API — AI Quick Reference"))).toBeInTheDocument();
    expect(screen.queryByText(/template v\d+ · Nova API v\d+/)).not.toBeInTheDocument();
  });

  it("copies the full prompt and shows success feedback", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    await openPromptPage("/build?page=prompt");

    await userEvent.click(screen.getByRole("button", { name: "Copy the master prompt" }));

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith(PROMPT);
    expect(await screen.findByRole("button", { name: "Prompt copied!" })).toBeInTheDocument();
  });

  it("links to the Nova API reference on GitHub (branch-free URL)", async () => {
    await openPromptPage("/build?page=prompt");

    const link = await screen.findByRole("link", { name: "Nova API reference" });
    expect(link).toHaveAttribute("href", NOVA_API_REFERENCE_URL);
    expect(link.getAttribute("href")).not.toMatch(/\/blob\/(nova|dev|main|master)\//);
  });

  it("opens the editor through the existing editor-open plumbing", async () => {
    await openPromptPage("/build?page=prompt");

    const editor = screen.getByRole("link", { name: "Open the editor" });
    expect(editor.getAttribute("href")).toBe("/editor");
    expect(editor.className).toContain("button--primary");

    expect(screen.queryByRole("textbox", { name: "Paste game HTML" })).not.toBeInTheDocument();
  });

  it("keeps the editor as the paste target — no paste box (7.44)", async () => {
    await openPromptPage("/build?page=prompt");

    expect(screen.queryByTestId("paste-target")).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Paste game HTML" })).not.toBeInTheDocument();
    expect(
      screen.queryByText(/Copy the master prompt below into any AI chat service/),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Next steps" })).not.toBeInTheDocument();
  });

  it("Back returns to the intro page so refresh/Back work sanely (gmo)", async () => {
    renderBuild("/build?page=prompt");
    await screen.findByRole("heading", { name: "Get the master prompt" });

    const back = screen.getByRole("link", { name: "back" });
    expect(back.getAttribute("href")).toBe("/build");
  });
});
