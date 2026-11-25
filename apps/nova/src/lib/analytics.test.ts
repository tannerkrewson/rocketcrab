import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PartyEngineState } from "./party/engine-types";

type TagWindow = Window & { dataLayer?: IArguments[] };

function events() {
  return ((window as TagWindow).dataLayer ?? [])
    .map((entry) => Array.from(entry))
    .filter(([command]) => command === "event")
    .map(([, event, params]) => [event, params]);
}

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("PROD", true);
  vi.stubEnv("VITE_MAIN_ORIGIN", window.location.origin);
  vi.stubEnv("VITE_GA_MEASUREMENT_ID", "G-TEST");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  window.history.replaceState(null, "", "/");
  delete (window as TagWindow).dataLayer;
  document.querySelector('script[src*="googletagmanager"]')?.remove();
});

it("counts resolved pages once and omits invite and local game data", async () => {
  const { trackPage } = await import("./analytics");
  window.history.replaceState(null, "", "/party?title=Private#secret=invite");
  trackPage("/party");
  trackPage("/party");
  trackPage("/games/$gameId/edit", "private-game-id");
  trackPage("/game/$gameId", "drawphone");

  const origin = window.location.origin;
  expect(events().map(([, params]) => params.page_location)).toEqual([
    origin + "/party",
    origin + "/games/local/edit",
    origin + "/game/drawphone",
  ]);
  expect(JSON.stringify((window as TagWindow).dataLayer)).not.toMatch(
    /Private|invite|private-game-id/,
  );
  expect(document.querySelectorAll('script[src*="googletagmanager"]')).toHaveLength(1);
});

it("does not start the tag outside the configured origin", async () => {
  vi.stubEnv("VITE_MAIN_ORIGIN", "https://another.example");
  const { trackPage } = await import("./analytics");
  trackPage("/");
  expect((window as TagWindow).dataLayer).toBeUndefined();
});

it("counts one host game across reconnects and reports the duration at its end", async () => {
  const { trackPage } = await import("./analytics");
  const { observePartyAnalytics } = await import("./party/party-analytics");
  const clock = vi.spyOn(performance, "now").mockReturnValue(1000);
  const onState = vi.fn<(handler: (state: PartyEngineState) => void) => () => void>();
  trackPage("/party");
  observePartyAnalytics({ onState });
  const [publish] = onState.mock.calls[0]!;
  const state = {
    amHost: true,
    game: { kind: "nova", gameId: "private-game-id" },
    members: [{ isSelf: true }, { connected: true }, { connected: false }],
  } as unknown as PartyEngineState;

  publish({ ...state, phase: "playing", amHost: false });
  publish({ ...state, phase: "reconnecting" });
  publish({ ...state, phase: "playing" });
  publish({ ...state, phase: "lobby" });
  publish({ ...state, phase: "playing" });
  publish({ ...state, phase: "reconnecting" });
  publish({ ...state, phase: "playing" });
  clock.mockReturnValue(31_000);
  publish({ ...state, phase: "lobby" });

  expect(events().filter(([event]) => event.startsWith("game_"))).toEqual([
    ["game_start", { app_variant: "nova", game_id: "custom", game_kind: "nova", party_size: 2 }],
    ["game_end", { app_variant: "nova", game_id: "custom", game_kind: "nova", play_seconds: 30 }],
  ]);
});
