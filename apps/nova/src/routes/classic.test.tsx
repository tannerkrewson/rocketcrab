import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { routeTree } from "../routeTree.gen";

/**
 * Classic game play route tests (rocketcrab-9fv.7.7.1): /classic/:gameId
 * runs the game's room-creation flow in the browser and embeds the external
 * game via iframe (classic-style external iframe flow). Failures surface a
 * readable error instead of hanging.
 */

function renderClassic(gameId: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [`/classic/${gameId}`] }),
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return render(<RouterProvider router={router} />, { wrapper });
}

const okJson = (value: unknown) => ({
  ok: true,
  status: 200,
  json: async () => value,
});

beforeEach(() => {
  window.history.pushState({}, "", "/");
});

afterEach(() => {
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("/classic/:gameId", () => {
  it("shows an error panel for an unknown game id", async () => {
    renderClassic("not-a-game");

    expect(await screen.findByText("Unknown classic game")).toBeInTheDocument();
  });

  it("connects to the game's server and embeds the game in an iframe", async () => {
    // Drawphone's room creation goes through the scoped relay (7.33): the
    // relay origin is pinned at build time via VITE_CLASSIC_RELAY_ORIGIN.
    vi.stubEnv("VITE_CLASSIC_RELAY_ORIGIN", "https://relay.example.net");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => okJson({ gameCode: "ABC123" })),
    );
    renderClassic("drawphone");

    const frame = await screen.findByTestId("classic-game-frame");
    const src = frame.getAttribute("src") ?? "";
    expect(src).toContain("https://drawphone.tannerkrewson.com/");
    expect(src).toContain("code=ABC123");
    expect(src).toContain("rocketcrab=true");
    expect(src).toContain("ishost=true");
  });

  it("shows the connecting state while the room is being created", async () => {
    vi.stubEnv("VITE_CLASSIC_RELAY_ORIGIN", "https://relay.example.net");
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise((resolve) => {
            setTimeout(() => resolve(okJson({ gameCode: "LATE" })), 50);
          }),
      ),
    );
    renderClassic("drawphone");

    expect(await screen.findByText("Setting up Drawphone…")).toBeInTheDocument();
    expect(await screen.findByTestId("classic-game-frame")).toBeInTheDocument();
  });

  it("surfaces a readable error when the game's server is unreachable", async () => {
    vi.stubEnv("VITE_CLASSIC_RELAY_ORIGIN", "https://relay.example.net");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 503 })),
    );
    renderClassic("drawphone");

    expect(await screen.findByText("Couldn't start Drawphone")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("retries the connect flow from the error panel", async () => {
    vi.stubEnv("VITE_CLASSIC_RELAY_ORIGIN", "https://relay.example.net");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 503 })),
    );
    renderClassic("drawphone");

    expect(await screen.findByText("Couldn't start Drawphone")).toBeInTheDocument();

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => okJson({ gameCode: "RETRY" })),
    );
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));

    const frame = await screen.findByTestId("classic-game-frame");
    expect(frame.getAttribute("src")).toContain("code=RETRY");
  });
});
