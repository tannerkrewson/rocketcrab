import { useEffect, useState } from "react";
import { resolvedTheme } from "./theme";

/**
 * True when the effective app theme is dark (dark code editor).
 *
 * The initial value resolves the persisted preference or the OS; the hook then
 * stays live through the system `prefers-color-scheme` query and a
 * MutationObserver on <html>'s class/data-theme (the theme control flips it
 * without a reload).
 */
export function useIsDarkTheme(): boolean {
  const [isDark, setIsDark] = useState<boolean>(() => resolvedTheme() === "dark");

  useEffect(() => {
    const update = () => setIsDark(resolvedTheme() === "dark");

    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    media?.addEventListener("change", update);

    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme", "class"],
    });

    return () => {
      media?.removeEventListener("change", update);
      observer.disconnect();
    };
  }, []);

  return isDark;
}
