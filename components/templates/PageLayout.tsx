import { Loading } from "@zeit-ui/react";
import Footer from "../atoms/Footer";
import MainTitle from "../atoms/MainTitle";
import { PageLayoutParams } from "../../types/types";

const PageLayout = ({ children, path, loading }: PageLayoutParams) => (
    <div className="container">
        <main>
            <div className="main-content">
                <MainTitle path={path} />

                {loading ? <Loading /> : children}
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
            html,
            body {
                padding: 0;
                margin: 0;
            }

            * {
                box-sizing: border-box;
            }
        `}</style>
    </div>
);

export default PageLayout;
