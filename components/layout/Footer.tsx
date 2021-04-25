import { useRouter } from "next/router";
import { RocketcrabMode } from "../../types/enums";
import { ThemeToggle } from "../common/ThemeToggle";

const Footer = (): JSX.Element => {
    const router = useRouter();
    const isKidsMode = router.locale === RocketcrabMode.KIDS;

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
        <footer style={{ marginTop: "1em" }}>
            <div className="side" />
            <div className="tag">
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
            <div className="side">
                <div className="theme-toggle">
                    <ThemeToggle />
                </div>
            </div>
            <style jsx>{`
                footer {
                    justify-content: center;
                    width: 100%;
                    display: flex;
                }

                .side {
                    flex: 1;
                    margin-left: auto;
                    position: relative;
                }

                .tag {
                    font-size: 12px;
                    text-align: center;
                    margin-bottom: 2em;
                }

                a:hover {
                    text-decoration: underline;
                }

                .theme-toggle {
                    position: absolute;
                    right: 0.9em;
                    bottom: 1.3em;
                }
            `}</style>
        </footer>
    );
};

export default Footer;
