/** Lazy source imports for the example catalog shared by /examples and /build. */
export type ExampleGameMode = "state" | "raw";

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
    mode: "state",
    description:
      "Every player steers a shared puck with the keys or a finger. Showcases a ticking game: controls, a host-run tick, and smooth drawing between ticks.",
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
