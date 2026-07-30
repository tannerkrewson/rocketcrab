import Body from "../components/layout/Body";
import "@fontsource/inconsolata";
import "@fontsource/mukta";
import { AppPropsType } from "next/dist/shared/lib/utils";
import { initGA, logPageView } from "../utils/analytics";
import { useState, useEffect, createContext } from "react";
import Router from "next/router";
import dynamic from "next/dynamic";
import withDarkMode, { useDarkMode } from "next-dark-mode";
import { NextUIProvider } from "@nextui-org/react";

import "../styles/global.css";
import Modal from "../components/common/Modal";

export const ModalContext = createContext(null);

const App = ({ Component, pageProps }: AppPropsType): JSX.Element => {
    const [, setLoading] = useState(false);
    const [modalState, setModalState] = useState({});
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

    useEffect(() => {
        if (darkModeActive) {
            document
                .querySelector("body")
                .classList.add("dark", "text-foreground", "bg-background");
        } else {
            document.querySelector("body").classList.remove("dark");
        }
    }, [darkModeActive]);

    return (
        <ModalContext.Provider value={setModalState}>
            <NextUIProvider>
                <Body>
                    <main>
                        <Component {...pageProps} />
                        <Modal state={modalState} />
                    </main>
                </Body>
            </NextUIProvider>
        </ModalContext.Provider>
    );
};
export default dynamic(() => Promise.resolve(withDarkMode(App)), {
    ssr: false,
});
