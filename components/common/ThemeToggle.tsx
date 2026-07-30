import { Switch } from "@heroui/react";
import { useTheme } from "../../utils/theme";

export const ThemeToggle = (): JSX.Element => {
    const { isDark, setTheme } = useTheme();
    return (
        <Switch
            defaultSelected={!isDark}
            onValueChange={(checked) => setTheme(checked ? "light" : "dark")}
        >
            <span>{isDark ? "🌙" : "☀️"}</span>
        </Switch>
    );
};
