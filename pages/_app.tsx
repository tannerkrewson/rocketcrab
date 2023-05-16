import { GeistProvider, CssBaseline } from "@geist-ui/react";
import Body from "../components/layout/Body";
import "fontsource-inconsolata";
import "fontsource-mukta";
import { AppPropsType } from "next/dist/shared/lib/utils";
import { initGA, logPageView } from "../utils/analytics";
import { useState, useEffect } from "react";
import Router from "next/router";
import withDarkMode, { useDarkMode } from "next-dark-mode";

import "swiper/swiper-bundle.css";
import "react-toggle/style.css";

const MyApp = ({ Component, pageProps }: AppPropsType): JSX.Element => {
    const [, setLoading] = useState(false);
    useEffect(() => {
        initGA();
        logPageView();

        const loadingStart = () => setLoading(true);
        const loadingStop = () => {
            logPageView();
            setLoading(false);
        };

        Router.events.on("routeChangeStart", loadingStart);
        Router.events.on("routeChangeComplete", loadingStop);

        return () => {
            Router.events.off("routeChangeStart", loadingStart);
            Router.events.off("routeChangeComplete", loadingStop);
        };
    }, []);

    const { darkModeActive } = useDarkMode();

    return (
        <GeistProvider themeType={darkModeActive ? "dark" : "light"}>
            <CssBaseline />
            <Body>
                <Component {...pageProps} />
            </Body>
        </GeistProvider>
    );
};

export default withDarkMode(MyApp);
