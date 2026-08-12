import { Palette } from "lucide-react";
import { useEffect, useState } from "react";
import {
  SYSTEM_THEME_ID,
  THEME_OPTIONS,
  getStoredTheme,
  initTheme,
  setTheme,
} from "../../lib/theme";

// Apply the persisted theme before first paint (see lib/theme.ts).
initTheme();

/**
 * Theme picker over all default daisyUI themes (rocketcrab-9fv.7.3).
 * "System" removes the data-theme override and follows the OS preference
 * (the rocketcrab-9fv.7.2 default).
 */
export function ThemeSelector() {
  const [theme, setThemeId] = useState<string>(() => getStoredTheme() ?? SYSTEM_THEME_ID);

  // Keep data-theme + storage in sync with the picker (mount included, so
  // the component is self-contained even when initTheme ran earlier).
  useEffect(() => {
    setTheme(theme);
  }, [theme]);

  return (
    <label className="flex items-center gap-1.5">
      <Palette className="h-4 w-4 shrink-0 text-base-content/60" aria-hidden="true" />
      <span className="sr-only">Theme</span>
      <select
        className="select select-bordered select-sm w-32 font-semibold"
        value={theme}
        onChange={(event) => setThemeId(event.target.value)}
        aria-label="Theme"
      >
        <option value={SYSTEM_THEME_ID}>System</option>
        {THEME_OPTIONS.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
