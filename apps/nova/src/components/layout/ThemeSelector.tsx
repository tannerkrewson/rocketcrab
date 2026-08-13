import { Dices, Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "../../lib/cn";
import {
  DEFAULT_DARK_THEME_ID,
  DEFAULT_LIGHT_THEME_ID,
  applyTheme,
  currentThemeMode,
  getStoredTheme,
  initTheme,
  randomThemeForMode,
  setTheme,
  type ThemeMode,
} from "../../lib/theme";

// Apply the persisted theme before first paint (see lib/theme.ts).
initTheme();

/**
 * Theme picker (rocketcrab-9fv.7.45): a light/dark toggle plus a dice that
 * rolls a random theme from the pool matching the current mode. The toggle
 * applies Nova's default theme for the mode; both choices persist via
 * lib/theme.ts, so they survive reloads.
 */
export function ThemeSelector() {
  const [mode, setMode] = useState<ThemeMode>(() => currentThemeMode());

  // Re-apply the persisted theme on mount so the selector is self-contained
  // even when initTheme ran before the persisted value existed (tests, hot
  // reload).
  useEffect(() => {
    applyTheme(getStoredTheme());
  }, []);

  const selectMode = (next: ThemeMode) => {
    setMode(next);
    setTheme(next === "dark" ? DEFAULT_DARK_THEME_ID : DEFAULT_LIGHT_THEME_ID);
  };

  const rollDice = () => {
    // The dice pool always matches `mode`, so the mode itself doesn't change.
    setTheme(randomThemeForMode(mode));
  };

  const isDark = mode === "dark";

  return (
    <div className="flex items-center gap-2" role="group" aria-label="Theme">
      <div className="join">
        <button
          type="button"
          aria-pressed={!isDark}
          onClick={() => selectMode("light")}
          className={cn("btn btn-sm join-item", !isDark && "btn-primary")}
        >
          <Sun className="h-4 w-4" aria-hidden="true" />
          Light
        </button>
        <button
          type="button"
          aria-pressed={isDark}
          onClick={() => selectMode("dark")}
          className={cn("btn btn-sm join-item", isDark && "btn-primary")}
        >
          <Moon className="h-4 w-4" aria-hidden="true" />
          Dark
        </button>
      </div>
      <button
        type="button"
        onClick={rollDice}
        aria-label="Random theme"
        title="Random theme"
        className="btn btn-sm btn-circle border-2 border-base-300"
      >
        <Dices className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}
