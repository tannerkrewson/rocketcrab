/* eslint-disable @typescript-eslint/explicit-module-boundary-types */
/* eslint-disable-next-line @typescript-eslint/ban-ts-comment */
// @ts-nocheck

// copied from https://github.com/tannerkrewson/spyfall/blob/dev/components/AddAppButton.js

import dynamic from "next/dynamic";
import { useState, useEffect } from "react";
import Swal from "sweetalert2";
import PrimaryButton from "../common/PrimaryButton";
import { logEvent } from "../../utils/analytics";

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
        logEvent("home-clickAddApp", true);
        if (isiOS) {
            setShowiOS(true);
        } else if (deferredPrompt) {
            // https://web.dev/customize-install/#in-app-flow

            // Show the install prompt
            deferredPrompt.prompt();
            // Wait for the user to respond to the prompt
            deferredPrompt.userChoice.then(() => setIsLoading(false));
        } else {
            Swal.fire({
                title: "Hmm...",
                text:
                    "Failed to add rocketcrab as an app on this device. Try again, or try on your phone!",
                icon: "error",
                heightAuto: false,
            });
            setIsLoading(false);
        }
    };

    return (
        <>
            {!isAlreadyPWA && (
                <PrimaryButton
                    className="btn-small btn-vertical"
                    onClick={handleAddApp}
                    disabled={isLoading}
                    manualWidth
                    type="default"
                >
                    {isLoading ? "Loading..." : "Add 🚀🦀 App"}
                </PrimaryButton>
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
