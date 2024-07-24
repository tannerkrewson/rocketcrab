import { Switch } from "@nextui-org/react";
import { useDarkMode } from "next-dark-mode";

export const ThemeToggle = (): JSX.Element => {
    const { darkModeActive, switchToDarkMode, switchToLightMode } =
        useDarkMode();
    return (
        <>
            <Switch
                isSelected={!darkModeActive}
                startContent={<span className="sun-moon">☀️</span>}
                endContent={<span className="sun-moon">🌙</span>}
                onValueChange={(checked) =>
                    checked ? switchToLightMode() : switchToDarkMode()
                }
            />
        </>
    );
};
