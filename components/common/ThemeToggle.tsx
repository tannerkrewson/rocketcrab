import { Switch } from "@heroui/react";
import { useTheme } from "../../utils/theme";

export const ThemeToggle = (): JSX.Element => {
    const { isDark, setTheme } = useTheme();
    return (
        <label className="flex items-center gap-2 cursor-pointer">
            <Switch
                isSelected={!isDark}
                onValueChange={(checked) =>
                    setTheme(checked ? "light" : "dark")
                }
            />
            <span className="text-lg">{isDark ? "🌙" : "☀️"}</span>
        </label>
    );
};
