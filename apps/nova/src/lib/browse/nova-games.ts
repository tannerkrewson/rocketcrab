/**
 * Nova's own prebuilt games (rocketcrab-9fv.7.7.2): the built-in example
 * games, one per mode. They are the "nova" half of the shared prebuilt-game
 * browser and are badged "nova" to distinguish them from the classic
 * external iframe games ("classic" badges). Opening one hands the source to
 * the editor as a new local draft (the same handoff the /build paste target
 * uses).
 */

export type NovaGameMode = "state" | "simulation" | "raw";

export interface NovaPrebuiltGame {
  /** Unique id, e.g. "nova-quiz". */
  id: string;
  /** Always "nova" — distinguishes Nova games from classic games. */
  kind: "nova";
  title: string;
  mode: NovaGameMode;
  description: string;
  /** Lazy raw import keeps the example sources out of the main bundle. */
  load: () => Promise<{ default: string }>;
}

const modeLabel: Record<NovaGameMode, string> = {
  state: "state mode",
  simulation: "simulation mode",
  raw: "raw mode",
};

export const NOVA_MODE_LABELS: Readonly<Record<NovaGameMode, string>> = modeLabel;

export const NOVA_PREBUILT_GAMES: readonly NovaPrebuiltGame[] = [
  {
    id: "nova-quiz",
    kind: "nova",
    title: "Nova Quiz",
    mode: "state",
    description:
      "A round-based trivia game with questions the host writes. Showcases state mode: actions, per-player views, join/leave handling, and mobile-first layout.",
    load: () => import("../../../../../examples/games/nova-quiz.html?raw"),
  },
  {
    id: "nova-drift",
    kind: "nova",
    title: "Nova Drift",
    mode: "simulation",
    description:
      "Every player steers a shared puck with the arrow keys. Showcases simulation mode: ordered inputs, the Nova tick clock, and authoritative snapshots.",
    load: () => import("../../../../../examples/games/nova-drift.html?raw"),
  },
  {
    id: "raw-mode",
    kind: "nova",
    title: "Chatter (raw mode sample)",
    mode: "raw",
    description:
      "Named channels exchanging structured chat messages and binary position samples. Showcases raw mode: reliable/ordered channels, targeted sends, and progress.",
    load: () => import("../../../../../examples/games/raw-mode.html?raw"),
  },
];

/** Look up a Nova prebuilt game by id; undefined when unknown. */
export function findNovaPrebuiltGame(id: string): NovaPrebuiltGame | undefined {
  return NOVA_PREBUILT_GAMES.find((game) => game.id === id);
}
