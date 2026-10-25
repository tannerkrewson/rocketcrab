import { Monitor, Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "../ui/Button";
import {
  applyTheme,
  getStoredTheme,
  initTheme,
  resolvedTheme,
  setTheme,
  type ThemePreference,
} from "../../lib/theme";

// Apply the persisted theme before first paint (see lib/theme.ts).
initTheme();

const options: { preference: ThemePreference; label: string; icon: typeof Sun }[] = [
  { preference: "light", label: "Light theme", icon: Sun },
  { preference: "dark", label: "Dark theme", icon: Moon },
  { preference: "system", label: "System theme", icon: Monitor },
];

/**
 * Light/dark/system theme switcher (HeroUI controls the visuals; no theme
 * catalogue is bundled). Icon-only controls stay compact in the top bar while
 * keeping accessible labels.
 */
export function ThemeSelector() {
  const [preference, setPreference] = useState<ThemePreference>(() => getStoredTheme());

  // Re-apply on mount so the selector is self-contained even when initTheme
  // ran before the persisted value existed (tests, hot reload).
  useEffect(() => {
    applyTheme(resolvedTheme(preference));
  }, [preference]);

  const select = (next: ThemePreference) => {
    setPreference(next);
    setTheme(next);
  };

  return (
    <div className="flex items-center gap-1" role="group" aria-label="Theme">
      {options.map(({ preference: value, label, icon: Icon }) => (
        <Button
          key={value}
          size="sm"
          variant={preference === value ? "secondary" : "tertiary"}
          isIconOnly
          aria-pressed={preference === value}
          aria-label={label}
          onPress={() => select(value)}
        >
          <Icon className="h-4 w-4" aria-hidden="true" />
        </Button>
      ))}
    </div>
  );
}
