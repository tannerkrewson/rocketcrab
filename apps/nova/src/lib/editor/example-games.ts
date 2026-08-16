/**
 * Nova example games (7th pass): the shared catalog behind routes/examples
 * and the /build flow's "start from an example" path. Complete games live
 * under examples/games/ and open in the editor as a new local draft —
 * the same handoff the master-prompt paste flow uses (storeDraftSource).
 * Lazy ?raw imports keep the example sources out of the main bundle.
 */
export type ExampleGameMode = "state" | "simulation" | "raw";

export interface ExampleGame {
  id: string;
  title: string;
  mode: ExampleGameMode;
  description: string;
  /** Lazy raw import keeps the example sources out of the main bundle. */
  load: () => Promise<{ default: string }>;
}

export const exampleModeLabel: Record<ExampleGameMode, string> = {
  state: "state mode",
  simulation: "simulation mode",
  raw: "raw mode",
};

export const exampleGames: ExampleGame[] = [
  {
    id: "nova-quiz",
    title: "Nova Quiz",
    mode: "state",
    description:
      "A round-based trivia game with questions the host writes. Showcases state mode: actions, per-player views, join/leave handling, and mobile-first layout.",
    load: () => import("../../../../../examples/games/nova-quiz.html?raw"),
  },
  {
    id: "nova-drift",
    title: "Nova Drift",
    mode: "simulation",
    description:
      "Every player steers a shared puck with the arrow keys. Showcases simulation mode: ordered inputs, the Nova tick clock, and authoritative snapshots.",
    load: () => import("../../../../../examples/games/nova-drift.html?raw"),
  },
  {
    id: "raw-mode",
    title: "Chatter (raw mode sample)",
    mode: "raw",
    description:
      "Named channels exchanging structured chat messages and binary position samples. Showcases raw mode: reliable/ordered channels, targeted sends, and progress.",
    load: () => import("../../../../../examples/games/raw-mode.html?raw"),
  },
];
