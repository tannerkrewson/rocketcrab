import { Loading } from "@geist-ui/react";
import { RocketcrabMode } from "../../types/enums";
import Connecting from "./Connecting";
import Footer from "./Footer";
import MainTitle from "./MainTitle";

const PageLayout = ({
    children,
    path,
    loading,
    disablePhonetic,
    deemphasize,
    center,
    reconnecting,
    mode,
}: PageLayoutParams): JSX.Element => (
    <div className="container">
        <main>
            <div className="main-content">
                <MainTitle
                    mode={mode}
                    path={path}
                    disablePhonetic={disablePhonetic}
                    deemphasize={deemphasize}
                />

                {loading ? <Loading /> : children}
            </div>
            {!center && <div className="height-expander"></div>}
        </main>

        <Footer />

        <style jsx>{`
            .container {
                min-height: 100%;
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
                width: min(24em, 95vw);
            }

            a {
                color: inherit;
                text-decoration: none;
            }

            .height-expander {
                flex-grow: 1;
            }

            .theme-toggle {
                position: fixed;
                bottom: 1em;
                right: 1em;
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

            /* hide the fullscreen button */
            .fslightbox-toolbar-button:first-child {
                display: none;
            }
        `}</style>
        {reconnecting && <Connecting />}
    </div>
);

type PageLayoutParams = {
    children: React.ReactNode;
    path?: string;
    loading?: boolean;
    disablePhonetic?: boolean;
    deemphasize?: boolean;
    center?: boolean;
    reconnecting?: boolean;
    mode: RocketcrabMode;
};

export default PageLayout;
