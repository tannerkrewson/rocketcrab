import { ThemeToggle } from "../common/ThemeToggle";

const Footer = (): JSX.Element => {
    return (
        <footer style={{ marginTop: "1em" }}>
            <div className="side" />
            <div className="tag">
                rocketcrab by{" "}
                <a
                    href="https://www.tannerkrewson.com/"
                    target="_blank"
                    rel="noopener noreferrer"
                >
                    Tanner Krewson
                </a>
                <br />
                <a
                    href="https://github.com/tannerkrewson/rocketcrab"
                    target="_blank"
                    rel="noopener noreferrer"
                >
                    View on GitHub
                </a>
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
