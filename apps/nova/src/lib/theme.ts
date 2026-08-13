/**
 * Theme state for the theme picker (rocketcrab-9fv.7.3).
 *
 * Strategy (built on rocketcrab-9fv.7.2): the app defaults to the "nova"
 * pure-white theme in light mode and "nova-dark" under prefers-color-scheme:
 * dark — both wired through daisyUI's `default`/`prefersdark` flags with no
 * `data-theme` attribute. Picking a theme here sets `data-theme` on <html>,
 * which overrides that default; "system" removes the attribute and returns
 * to the 7.2 behavior. The choice persists in localStorage.
 */

export const THEME_STORAGE_KEY = "nova.theme";

/** Pseudo-option: no data-theme override — follow the system (7.2 default). */
export const SYSTEM_THEME_ID = "system";

export interface ThemeOption {
  id: string;
  label: string;
}

/** Nova's own themes first, then all default daisyUI themes (v5.7.9). */
export const THEME_OPTIONS: ThemeOption[] = [
  { id: "nova", label: "Nova light" },
  { id: "nova-dark", label: "Nova dark" },
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
  { id: "cupcake", label: "Cupcake" },
  { id: "bumblebee", label: "Bumblebee" },
  { id: "emerald", label: "Emerald" },
  { id: "corporate", label: "Corporate" },
  { id: "synthwave", label: "Synthwave" },
  { id: "retro", label: "Retro" },
  { id: "cyberpunk", label: "Cyberpunk" },
  { id: "valentine", label: "Valentine" },
  { id: "halloween", label: "Halloween" },
  { id: "garden", label: "Garden" },
  { id: "forest", label: "Forest" },
  { id: "aqua", label: "Aqua" },
  { id: "lofi", label: "Lofi" },
  { id: "pastel", label: "Pastel" },
  { id: "fantasy", label: "Fantasy" },
  { id: "wireframe", label: "Wireframe" },
  { id: "black", label: "Black" },
  { id: "luxury", label: "Luxury" },
  { id: "dracula", label: "Dracula" },
  { id: "cmyk", label: "CMYK" },
  { id: "autumn", label: "Autumn" },
  { id: "business", label: "Business" },
  { id: "acid", label: "Acid" },
  { id: "lemonade", label: "Lemonade" },
  { id: "night", label: "Night" },
  { id: "coffee", label: "Coffee" },
  { id: "winter", label: "Winter" },
  { id: "dim", label: "Dim" },
  { id: "nord", label: "Nord" },
  { id: "sunset", label: "Sunset" },
  { id: "caramellatte", label: "Caramellatte" },
  { id: "abyss", label: "Abyss" },
  { id: "silk", label: "Silk" },
];

const OPTION_IDS = new Set(THEME_OPTIONS.map((option) => option.id));

// ---------------------------------------------------------------------------
// Light/dark classification (rocketcrab-9fv.7.45). Nova's own themes plus
// daisyUI v5.7.9's built-ins, split by each theme's `color-scheme`.
// ---------------------------------------------------------------------------

export type ThemeMode = "light" | "dark";

/** Themes whose color-scheme is light: nova + 21 daisyUI built-ins. */
export const LIGHT_THEME_IDS: readonly string[] = [
  "nova",
  "light",
  "lemonade",
  "retro",
  "bumblebee",
  "caramellatte",
  "silk",
  "corporate",
  "cupcake",
  "autumn",
  "fantasy",
  "nord",
  "cyberpunk",
  "wireframe",
  "acid",
  "winter",
  "valentine",
  "pastel",
  "lofi",
  "garden",
  "emerald",
  "cmyk",
];

/** Themes whose color-scheme is dark: nova-dark + 14 daisyUI built-ins. */
export const DARK_THEME_IDS: readonly string[] = [
  "nova-dark",
  "black",
  "halloween",
  "forest",
  "night",
  "abyss",
  "synthwave",
  "dim",
  "aqua",
  "dark",
  "coffee",
  "business",
  "luxury",
  "dracula",
  "sunset",
];

const LIGHT_IDS = new Set(LIGHT_THEME_IDS);
const DARK_IDS = new Set(DARK_THEME_IDS);

/** The default theme applied when the user picks a mode explicitly (7.45). */
export const DEFAULT_LIGHT_THEME_ID = "nova";
export const DEFAULT_DARK_THEME_ID = "nova-dark";

/** Dice pools exclude the mode defaults so rolling always changes the look. */
const LIGHT_DICE_POOL = LIGHT_THEME_IDS.filter((id) => id !== DEFAULT_LIGHT_THEME_ID);
const DARK_DICE_POOL = DARK_THEME_IDS.filter((id) => id !== DEFAULT_DARK_THEME_ID);

export function isLightTheme(id: string): boolean {
  return LIGHT_IDS.has(id);
}

export function isDarkTheme(id: string): boolean {
  return DARK_IDS.has(id);
}

/** The light/dark mode a theme id belongs to (light for unknown ids). */
export function themeMode(id: string): ThemeMode {
  return isDarkTheme(id) ? "dark" : "light";
}

/** True when the OS prefers dark (false when matchMedia is unavailable). */
export function systemPrefersDark(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/**
 * The effective mode: the persisted theme's mode when one is stored,
 * otherwise the OS preference (light when unknown).
 */
export function currentThemeMode(): ThemeMode {
  const stored = getStoredTheme();
  if (stored !== null) return themeMode(stored);
  return systemPrefersDark() ? "dark" : "light";
}

/** A random theme matching `mode`, never the mode's default (7.45 dice). */
export function randomThemeForMode(mode: ThemeMode): string {
  const pool = mode === "dark" ? DARK_DICE_POOL : LIGHT_DICE_POOL;
  return pool[Math.floor(Math.random() * pool.length)] ?? DEFAULT_LIGHT_THEME_ID;
}

/** The persisted theme id, or null when the user is on the system default. */
export function getStoredTheme(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
    return raw !== null && OPTION_IDS.has(raw) ? raw : null;
  } catch {
    return null;
  }
}

/** Apply a theme id (or null for "system") to the document, without persisting. */
export function applyTheme(id: string | null): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (id === null || id === SYSTEM_THEME_ID) {
    root.removeAttribute("data-theme");
  } else {
    root.setAttribute("data-theme", id);
  }
}

/** Apply AND persist a theme choice; null/"system" clears the override. */
export function setTheme(id: string | null): void {
  applyTheme(id);
  if (typeof window === "undefined") return;
  try {
    if (id === null || id === SYSTEM_THEME_ID) {
      window.localStorage.removeItem(THEME_STORAGE_KEY);
    } else {
      window.localStorage.setItem(THEME_STORAGE_KEY, id);
    }
  } catch {
    // Storage unavailable (e.g. private mode): the theme still applies for
    // the current session, it just won't persist.
  }
}

/**
 * Apply the persisted theme before first paint. Imported by the app shell
 * so the module side effect runs before React renders — no flash of the
 * system theme when the user picked something else.
 */
export function initTheme(): void {
  applyTheme(getStoredTheme());
}
