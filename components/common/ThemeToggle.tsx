import { useDarkMode } from "next-dark-mode";
import Toggle from "react-toggle";

export const ThemeToggle = (): JSX.Element => {
    const {
        darkModeActive,
        switchToDarkMode,
        switchToLightMode,
    } = useDarkMode();
    return (
        <>
            <Toggle
                checked={!darkModeActive}
                icons={{
                    checked: <span className="sun-moon">☀️</span>,
                    unchecked: <span className="sun-moon">🌙</span>,
                }}
                onChange={({ target }) =>
                    target.checked ? switchToLightMode() : switchToDarkMode()
                }
            />
            <style jsx>{`
                .sun-moon {
                    margin-left: -4px;
                    line-height: 0.7em;
                }
            `}</style>
            <style jsx global>{`
                .react-toggle--focus .react-toggle-thumb,
                .react-toggle:active:not(.react-toggle--disabled)
                    .react-toggle-thumb {
                    box-shadow: none;
                }

                .react-toggle:not(.react-toggle--checked) .react-toggle-track,
                .react-toggle:hover:not(.react-toggle--disabled)
                    .react-toggle-track {
                    background-color: #5f6a78;
                }

                .react-toggle--checked .react-toggle-track,
                .react-toggle--checked:hover:not(.react-toggle--disabled)
                    .react-toggle-track {
                    background-color: #03a5fc;
                }

                .react-toggle--checked .react-toggle-thumb {
                    border-color: transparent;
                }
            `}</style>
        </>
    );
};
