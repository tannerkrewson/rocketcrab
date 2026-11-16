/** Shared mode labels for saved-game details and party overlays. */

export type NovaGameMode = "state" | "simulation" | "raw";

const modeLabel: Record<NovaGameMode, string> = {
  state: "state mode",
  simulation: "simulation mode",
  raw: "raw mode",
};

export const NOVA_MODE_LABELS: Readonly<Record<NovaGameMode, string>> = modeLabel;
