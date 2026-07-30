import { useMode } from "../../utils/ModeContext";
import { RocketcrabMode } from "../../types/enums";
import { ThemeToggle } from "../common/ThemeToggle";

const Footer = (): JSX.Element => {
    const mode = useMode();
    const isKidsMode = mode === RocketcrabMode.KIDS;

    const NameWrapper = ({ children }) =>
        !isKidsMode ? (
            <a
                href="https://www.tannerkrewson.com/"
                target="_blank"
                rel="noopener noreferrer"
            >
                {children}
            </a>
        ) : (
            <>{children}</>
        );

    return (
        <footer className="flex justify-center w-full mt-4">
            <div className="flex-1 ml-auto relative" />
            <div className="text-xs text-center mb-8">
                rocketcrab by <NameWrapper>Tanner Krewson</NameWrapper>
                {!isKidsMode && (
                    <>
                        <br />
                        <a
                            href="https://github.com/tannerkrewson/rocketcrab"
                            target="_blank"
                            rel="noopener noreferrer"
                        >
                            View on GitHub
                        </a>
                    </>
                )}
            </div>
            <div className="flex-1 ml-auto relative">
                <div className="absolute right-3 bottom-5">
                    <ThemeToggle />
                </div>
            </div>
        </footer>
    );
};

export default Footer;
