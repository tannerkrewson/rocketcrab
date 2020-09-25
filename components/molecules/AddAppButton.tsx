/* eslint-disable @typescript-eslint/explicit-module-boundary-types */
/* eslint-disable-next-line @typescript-eslint/ban-ts-comment */
// @ts-nocheck

// copied from https://github.com/tannerkrewson/spyfall/blob/dev/components/AddAppButton.js

import dynamic from "next/dynamic";
import { useState, useEffect } from "react";
import PrimaryButton from "../atoms/PrimaryButton";
import { Spacer } from "@geist-ui/react";
import ButtonGroup from "../molecules/ButtonGroup";

// https://github.com/chrisdancee/react-ios-pwa-prompt/issues/32#issuecomment-586762839
const PWAPrompt = dynamic(() => import("react-ios-pwa-prompt"), {
    ssr: false,
});

const AddAppButton = () => {
    const [isAlreadyPWA, setIsAlreadyPWA] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [isiOS, setIsiOS] = useState(false);
    const [deferredPrompt, setDeferredPrompt] = useState();

    const [showiOS, setShowiOS] = useState(false);

    useEffect(() => {
        // https://stackoverflow.com/a/52695341
        setIsAlreadyPWA(
            window.matchMedia("(display-mode: standalone)").matches ||
                window.navigator.standalone ||
                document.referrer.includes("android-app://")
        );

        setIsiOS(
            /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream
        );

        // https://web.dev/customize-install/#beforeinstallprompt
        window.addEventListener("beforeinstallprompt", (e) => {
            // Prevent the mini-infobar from appearing on mobile
            e.preventDefault();
            // Stash the event so it can be triggered later.
            setDeferredPrompt(e);
        });
    });

    const handleAddApp = () => {
        setIsLoading(true);
        if (isiOS) {
            setShowiOS(true);
        } else if (deferredPrompt) {
            // https://web.dev/customize-install/#in-app-flow

            // Show the install prompt
            deferredPrompt.prompt();
            // Wait for the user to respond to the prompt
            deferredPrompt.userChoice.then(() => setIsLoading(false));
        } else {
            alert(
                "Failed to add Drawphone as an app on this device. Try again, or try on your phone!"
            );
            setIsLoading(false);
        }
    };

    return (
        <>
            {!isAlreadyPWA && (
                <>
                    <Spacer y={1} />
                    <ButtonGroup>
                        <PrimaryButton
                            className="btn-small btn-vertical"
                            onClick={handleAddApp}
                            size="small"
                        >
                            {isLoading ? "Loading..." : "Add 🚀🦀 App"}
                        </PrimaryButton>
                    </ButtonGroup>
                </>
            )}
            {showiOS && (
                <PWAPrompt
                    debug={true}
                    permanentlyHideOnDismiss={false}
                    onClose={() => {
                        setShowiOS(false);
                        setIsLoading(false);
                    }}
                />
            )}
        </>
    );
};

export default AddAppButton;
