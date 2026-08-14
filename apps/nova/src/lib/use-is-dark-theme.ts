import { useEffect, useState } from "react";
import { currentThemeMode } from "./theme";

/**
 * True when the effective app theme is dark (Task 4: dark code editor).
 *
 * Uses `currentThemeMode()` (the persisted theme's mode, or the OS
 * preference) on mount, then stays live through BOTH the system
 * `prefers-color-scheme` media query and a MutationObserver on
 * `document.documentElement`'s `data-theme` attribute — the footer theme
 * picker flips the attribute without reloading, so the editor re-themes
 * automatically.
 */
export function useIsDarkTheme(): boolean {
  const [isDark, setIsDark] = useState<boolean>(() => currentThemeMode() === "dark");

  useEffect(() => {
    const update = () => setIsDark(currentThemeMode() === "dark");

    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    media?.addEventListener("change", update);

    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });

    return () => {
      media?.removeEventListener("change", update);
      observer.disconnect();
    };
  }, []);

  return isDark;
}
