import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NOVA_API_VERSION } from "@rocketcrab/nova-api";
import { MASTER_PROMPT_VERSION, buildMasterPrompt } from "../lib/prompt/master-prompt";
import { readDraftSource, storeDraftSource } from "../lib/editor/draft-handoff";
import { routeTree } from "../routeTree.gen";

/**
 * Generator page tests (A4): the /create route presents the short
 * explanation, the generated master prompt, the copy button with success
 * feedback, the expandable API details, the examples link, the
 * continue-to-editor button, and the paste target that creates a new local
 * draft immediately.
 */

const PROMPT = buildMasterPrompt();

function renderCreate() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ["/create"] }),
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

describe("/create — master prompt generator", () => {
  it("presents a short explanation and the generated prompt", async () => {
    renderCreate();

    expect(await screen.findByRole("heading", { name: "Create a game" })).toBeInTheDocument();
    expect(
      screen.getByText(/Copy the master prompt below into any AI chat service/),
    ).toBeInTheDocument();

    // The complete generated prompt is present (inside the expandable panel)
    // and carries the versioned template + API versions (badge and prompt
    // title both show it).
    expect(
      (
        await screen.findAllByText(
          new RegExp(`template v${MASTER_PROMPT_VERSION} · Nova API v${NOVA_API_VERSION}`),
        )
      ).length,
    ).toBeGreaterThan(0);
    expect(screen.getByText(new RegExp("Nova Master Prompt"))).toBeInTheDocument();
    expect(
      screen.getByText(new RegExp("Interview the user before writing any code")),
    ).toBeInTheDocument();
    // The embedded API reference travels with the prompt.
    expect(screen.getByText(new RegExp("The whole API in one block"))).toBeInTheDocument();
  });

  it("copies the full prompt and shows success feedback", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    renderCreate();

    await userEvent.click(await screen.findByRole("button", { name: "Copy the master prompt" }));

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith(PROMPT);
    expect(await screen.findByRole("button", { name: "Prompt copied!" })).toBeInTheDocument();
  });

  it("shows the expandable API details", async () => {
    renderCreate();

    const summary = await screen.findByText("What's in the Nova API reference");
    const details = summary.closest("details");
    expect(details).not.toBeNull();
    expect(details?.open).toBe(false);

    await userEvent.click(summary);
    expect(details?.open).toBe(true);
    expect(
      screen.getByText(
        new RegExp(`The prompt embeds the full Nova API reference \\(v${NOVA_API_VERSION}\\)`),
      ),
    ).toBeInTheDocument();
    // The instruction appears in both the prompt panel and the API details.
    expect(
      screen.getAllByText(/Prefer state mode unless the game genuinely needs another mode/),
    ).not.toHaveLength(0);
  });

  it("links to the example games", async () => {
    renderCreate();

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
    renderCreate();

    await userEvent.click(
      await screen.findByRole("button", { name: "Continue to a blank editor" }),
    );

    const editor = await editorSourceTextbox();
    expect(editor.textContent?.trim()).toBe("");
    expect(readDraftSource()).toBeNull();
  });

  it("turns pasted HTML into a new local draft immediately", async () => {
    const pasted = "<!doctype html><title>Draft</title><p>hello nova</p>";
    renderCreate();

    await userEvent.type(await screen.findByRole("textbox", { name: "Paste game HTML" }), pasted);
    await userEvent.click(screen.getByRole("button", { name: "Open in the editor" }));

    const editor = await editorSourceTextbox();
    expect(editor.textContent).toContain("hello nova");
    const draft = readDraftSource();
    expect(draft?.source).toBe(pasted);
    expect(draft?.gameId.startsWith("draft-")).toBe(true);
  });
});
