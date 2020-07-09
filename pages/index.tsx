import Head from "next/head";
import Footer from "../components/Footer";

export const Home = (): JSX.Element => {
    const host = "rocketcrab.com"; // window.location.host
    const path = ""; // window.location.pathname === "/" ? "" : window.location.pathname;
    const title = host + path;

    return (
        <div className="container">
            <Head>
                <title>🚀🦀 rocketcrab</title>
            </Head>

            <main>
                <div className="title">
                    <h2>🚀🦀</h2>
                    <h2>{title}</h2>
                </div>

                <p className="description">
                    Get started by editing <code>pages/index.tsx</code>
                </p>

                <button
                    onClick={() => {
                        window.alert("With typescript and Jest");
                    }}
                >
                    Test Button
                </button>
            </main>

            <Footer />

            <style jsx>{`
                .container {
                    min-height: 100vh;
                    padding: 0 0.5rem;
                    display: flex;
                    flex-direction: column;
                    justify-content: center;
                    align-items: center;
                }

                main {
                    padding: 5rem 0;
                    flex: 1;
                    display: flex;
                    flex-direction: column;
                    justify-content: center;
                    align-items: center;
                }

                a {
                    color: inherit;
                    text-decoration: none;
                }

                .title a {
                    color: #0070f3;
                    text-decoration: none;
                }

                .title a:hover,
                .title a:focus,
                .title a:active {
                    text-decoration: underline;
                }

                .title {
                    margin: 0;
                    line-height: 1.15;
                    font-size: 1em;
                }

                .title,
                .description {
                    text-align: center;
                }

                .description {
                    line-height: 1.5;
                    font-size: 1.5rem;
                }
            `}</style>

            <style jsx global>{`
                html,
                body {
                    padding: 0;
                    margin: 0;
                    font-family: -apple-system, BlinkMacSystemFont, Segoe UI,
                        Roboto, Oxygen, Ubuntu, Cantarell, Fira Sans, Droid Sans,
                        Helvetica Neue, sans-serif;
                }

                * {
                    box-sizing: border-box;
                }
            `}</style>
        </div>
    );
};

export default Home;
