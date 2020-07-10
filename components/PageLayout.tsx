import Head from "next/head";
import Footer from "../components/Footer";
import MainTitle from "../components/MainTitle";

const PageLayout = ({ children }) => (
    <div className="container">
        <Head>
            <title>🚀🦀 rocketcrab</title>
        </Head>

        <main>
            <MainTitle />

            {children}
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
