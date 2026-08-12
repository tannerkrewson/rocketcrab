import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readDraftSource } from "../lib/editor/draft-handoff";
import { routeTree } from "../routeTree.gen";

/**
 * Examples page tests (A4): the /examples route lists one complete game per
 * mode and "Open in the editor" turns an example source into a new local
 * draft (lazy ?raw import + the same handoff the /create paste target uses).
 */

function renderExamples() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ["/examples"] }),
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return render(<RouterProvider router={router} />, { wrapper });
}

beforeEach(() => {
  window.history.pushState({}, "", "/");
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("/examples", () => {
  it("lists one complete example game per mode", async () => {
    renderExamples();

    expect(await screen.findByRole("heading", { name: "Example games" })).toBeInTheDocument();
    expect(screen.getByText("Nova Quiz")).toBeInTheDocument();
    expect(screen.getByText("state mode")).toBeInTheDocument();
    expect(screen.getByText("Nova Drift")).toBeInTheDocument();
    expect(screen.getByText("simulation mode")).toBeInTheDocument();
    expect(screen.getByText("Chatter (raw mode sample)")).toBeInTheDocument();
    expect(screen.getByText("raw mode")).toBeInTheDocument();
  });

  it("opens an example as a new draft in the editor", async () => {
    renderExamples();

    // First card in DOM order is Nova Quiz (state mode).
    await userEvent.click(
      (await screen.findAllByRole("button", { name: /^Open in the editor/ }))[0],
    );

    // The editor route mounts with the example source as an unsaved draft
    // (scope to the desktop layout: jsdom never hides the phone editor).
    const desktop = await screen.findByTestId("desktop-layout");
    const editor = within(desktop).getByRole("textbox", { name: "Game HTML source" });
    // CodeMirror only renders visible lines, so assert the top of the source
    // in the editor and the full source through the draft handoff.
    expect(editor.textContent).toContain("<!doctype html>");

    const draft = readDraftSource();
    expect(draft?.gameId.startsWith("draft-")).toBe(true);
    expect(draft?.source).toContain("<!doctype html>");
    expect(draft?.source).toContain("nova.defineGame");
    expect(draft?.source).toContain("Nova Quiz");
  });
});
