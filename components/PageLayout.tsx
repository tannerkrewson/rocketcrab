import Head from "next/head";
import Footer from "../components/Footer";
import MainTitle from "../components/MainTitle";
import { PageLayoutParams } from "../types/types";

const PageLayout = ({ children, path }: PageLayoutParams) => (
    <div className="container">
        <Head>
            <title>🚀🦀 rocketcrab</title>
        </Head>

        <main>
            <div className="main-content">
                <MainTitle path={path} />

                {children}
            </div>
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
                flex: 1;
                display: flex;
                flex-direction: column;
                justify-content: center;
                align-items: center;
            }

            .main-content {
                min-height: 20rem;
            }

            a {
                color: inherit;
                text-decoration: none;
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

export default PageLayout;
