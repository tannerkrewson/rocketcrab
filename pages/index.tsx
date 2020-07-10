import Head from "next/head";
import Footer from "../components/Footer";
import { Button, Grid } from "@zeit-ui/react";

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

                <div className="description">
                    all the best mobile web party games
                </div>

                <Grid.Container gap={1} justify="center">
                    <Grid>
                        <Button
                            onClick={() => {
                                window.alert("With typescript and Jest");
                            }}
                            type="secondary"
                            size="large"
                            ghost
                            shadow
                            auto
                        >
                            Join Lobby
                        </Button>
                    </Grid>
                    <Grid>
                        <Button
                            onClick={() => {
                                window.alert("With typescript and Jest");
                            }}
                            type="secondary"
                            size="large"
                            ghost
                            shadow
                            auto
                        >
                            New Lobby
                        </Button>
                    </Grid>
                </Grid.Container>
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

                .title,
                .description {
                    text-align: center;
                }

                .description {
                    margin-bottom: 2em;
                }
            `}</style>

            <style jsx global>{`
                @import url("https://fonts.googleapis.com/css2?family=Inconsolata:wght@400;600&display=swap");

                html,
                body {
                    padding: 0;
                    margin: 0;
                }

                * {
                    box-sizing: border-box;
                    letter-spacing: normal !important;
                    font-family: "Inconsolata", monospace;
                }
            `}</style>
        </div>
    );
};

export default Home;
