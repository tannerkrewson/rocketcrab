/**
 * Theme state for Nova (HeroUI v3).
 *
 * HeroUI ships light/dark tokens; Nova keeps only those two plus "system".
 * The resolved mode is applied as the `.dark` class (and `data-theme`) on
 * <html>, which is what HeroUI's theme variables key off. The choice persists
 * in localStorage. No third-party theme list is bundled any more.
 */

export const THEME_STORAGE_KEY = "nova.theme";

export type ThemeMode = "light" | "dark";
export type ThemePreference = ThemeMode | "system";

/** True when the OS prefers dark (false when matchMedia is unavailable). */
export function systemPrefersDark(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/** The persisted explicit preference, or "system" when unset/invalid. */
export function getStoredTheme(): ThemePreference {
  if (typeof window === "undefined") return "system";
  try {
    const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
    return raw === "light" || raw === "dark" ? raw : "system";
  } catch {
    return "system";
  }
}

/** The mode that should actually render right now. */
export function resolvedTheme(preference: ThemePreference = getStoredTheme()): ThemeMode {
  if (preference === "light" || preference === "dark") return preference;
  return systemPrefersDark() ? "dark" : "light";
}

/** Apply a mode to the document without persisting it. */
export function applyTheme(mode: ThemeMode): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.classList.toggle("dark", mode === "dark");
  root.dataset.theme = mode;
  root.style.colorScheme = mode;
}

/** Apply AND persist a preference; "system" resolves the OS mode. */
export function setTheme(preference: ThemePreference): void {
  applyTheme(resolvedTheme(preference));
  if (typeof window === "undefined") return;
  try {
    if (preference === "system") {
      window.localStorage.removeItem(THEME_STORAGE_KEY);
    } else {
      window.localStorage.setItem(THEME_STORAGE_KEY, preference);
    }
  } catch {
    // Storage unavailable (private mode): the mode still applies this session.
  }
}

/**
 * Apply the persisted theme before first paint. Imported by the app shell so
 * the module side effect runs before React renders.
 */
export function initTheme(): void {
  applyTheme(resolvedTheme());
}
