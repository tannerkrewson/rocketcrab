/** Shared mode labels for saved-game details and party overlays. */

export type NovaGameMode = "state" | "raw";

const modeLabel: Record<NovaGameMode, string> = {
  state: "state mode",
  raw: "raw mode",
};

export const NOVA_MODE_LABELS: Readonly<Record<NovaGameMode, string>> = modeLabel;
