import { GeistProvider, CssBaseline } from "@geist-ui/core";
import Body from "../components/layout/Body";
import "fontsource-inconsolata";
import "fontsource-mukta";
import { AppPropsType } from "next/dist/shared/lib/utils";
import { initGA, logPageView } from "../utils/analytics";
import { useState, useEffect } from "react";
import Router from "next/router";
import dynamic from "next/dynamic";
import withDarkMode, { useDarkMode } from "next-dark-mode";
import { NextUIProvider } from "@nextui-org/react";

import "swiper/swiper-bundle.css";
import "react-toggle/style.css";
import "../styles/global.css";

const App = ({ Component, pageProps }: AppPropsType): JSX.Element => {
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
        <NextUIProvider>
            <GeistProvider themeType={darkModeActive ? "dark" : "light"}>
                <CssBaseline />

                <Body>
                    <Component {...pageProps} />
                </Body>
            </GeistProvider>
        </NextUIProvider>
    );
};
export default dynamic(() => Promise.resolve(withDarkMode(App)), {
    ssr: false,
});
