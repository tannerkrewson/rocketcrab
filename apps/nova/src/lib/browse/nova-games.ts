/**
 * Nova's game modes (rocketcrab-9fv.7.7.2): the mode labels used for saved
 * games' badges in the game details page and the party game details modal.
 *
 * The built-in EXAMPLE games (nova-quiz / nova-drift / raw-mode) were
 * removed from the game browser entirely (rocketcrab-5cl.10): the browser
 * is classic-only, and Nova's own games are the user's saved games (plus
 * the /examples page's samples). The `load`-style prebuilt list lived here;
 * nothing imports it anymore, so only the shared mode labels remain.
 */

export type NovaGameMode = "state" | "simulation" | "raw";

const modeLabel: Record<NovaGameMode, string> = {
  state: "state mode",
  simulation: "simulation mode",
  raw: "raw mode",
};

export const NOVA_MODE_LABELS: Readonly<Record<NovaGameMode, string>> = modeLabel;
