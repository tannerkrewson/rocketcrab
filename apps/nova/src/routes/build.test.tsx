import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildMasterPrompt } from "../lib/prompt/master-prompt";
import { readDraftSource, storeDraftSource } from "../lib/editor/draft-handoff";
import { routeTree } from "../routeTree.gen";

/**
 * Generator page tests (A4): the /build route presents the short
 * explanation, the generated master prompt, the copy button with success
 * feedback, a link to the GitHub-hosted API reference, the examples link,
 * the continue-to-editor button, and the paste target that creates a new
 * local draft immediately.
 */

const PROMPT = buildMasterPrompt();

/** GitHub link to the docs, branch-free (GitHub resolves the default branch). */
const NOVA_API_REFERENCE_URL =
  "https://github.com/tannerkrewson/rocketcrab/blob/docs/api/nova-api-ai-reference.md";

function renderBuild() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ["/build"] }),
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return render(<RouterProvider router={router} />, { wrapper });
}

async function editorSourceTextbox() {
  // The /editor route's CodeMirror surfaces as a textbox with this label.
  // Scope to the desktop layout: the phone layout mounts a second CodeMirror
  // that jsdom's CSS-less environment never hides.
  const desktop = await screen.findByTestId("desktop-layout");
  return within(desktop).getByRole("textbox", { name: "Game HTML source" });
}

beforeEach(() => {
  window.history.pushState({}, "", "/");
});

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  delete (navigator as { clipboard?: unknown }).clipboard;
});

describe("/build — master prompt generator", () => {
  it("presents a short explanation and the generated prompt", async () => {
    renderBuild();

    expect(await screen.findByRole("heading", { name: "Build a game" })).toBeInTheDocument();
    expect(
      screen.getByText(/Copy the master prompt below into any AI chat service/),
    ).toBeInTheDocument();

    // The complete generated prompt is present (inside the expandable panel).
    expect(screen.getByText(new RegExp("Nova Master Prompt"))).toBeInTheDocument();
    expect(
      screen.getByText(new RegExp("Interview the user before writing any code")),
    ).toBeInTheDocument();
    // The embedded API reference travels with the prompt.
    expect(screen.getByText(new RegExp("The whole API in one block"))).toBeInTheDocument();
    // The version badge was removed from the generator UI and the prompt.
    expect(screen.queryByText(/template v\d+ · Nova API v\d+/)).not.toBeInTheDocument();
  });

  it("copies the full prompt and shows success feedback", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    renderBuild();

    await userEvent.click(await screen.findByRole("button", { name: "Copy the master prompt" }));

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith(PROMPT);
    expect(await screen.findByRole("button", { name: "Prompt copied!" })).toBeInTheDocument();
  });

  it("links to the Nova API reference on GitHub (branch-free URL)", async () => {
    renderBuild();

    const link = await screen.findByRole("link", { name: "Nova API reference" });
    expect(link).toHaveAttribute("href", NOVA_API_REFERENCE_URL);
    expect(link.getAttribute("href")).not.toMatch(/\/blob\/(nova|dev|main|master)\//);
  });

  it("links to the example games", async () => {
    renderBuild();

    const link = await screen.findByRole("link", { name: "See example games" });
    expect(link).toHaveAttribute("href", "/examples");

    await userEvent.click(link);
    expect(await screen.findByRole("heading", { name: "Example games" })).toBeInTheDocument();
    expect(screen.getByText("Nova Quiz")).toBeInTheDocument();
    expect(screen.getByText("Nova Drift")).toBeInTheDocument();
    expect(screen.getByText("Chatter (raw mode sample)")).toBeInTheDocument();
  });

  it("continues to a blank editor without a stale draft", async () => {
    // A stale draft from a previous session must not leak into the blank editor.
    storeDraftSource("<p>stale draft</p>");
    renderBuild();

    await userEvent.click(
      await screen.findByRole("button", { name: "Continue to a blank editor" }),
    );

    const editor = await editorSourceTextbox();
    expect(editor.textContent?.trim()).toBe("");
    expect(readDraftSource()).toBeNull();
  });

  it("turns pasted HTML into a new local draft immediately", async () => {
    const pasted = "<!doctype html><title>Draft</title><p>hello nova</p>";
    renderBuild();

    await userEvent.type(await screen.findByRole("textbox", { name: "Paste game HTML" }), pasted);
    await userEvent.click(screen.getByRole("button", { name: "Open in the editor" }));

    const editor = await editorSourceTextbox();
    expect(editor.textContent).toContain("hello nova");
    const draft = readDraftSource();
    expect(draft?.source).toBe(pasted);
    expect(draft?.gameId.startsWith("draft-")).toBe(true);
  });
});
