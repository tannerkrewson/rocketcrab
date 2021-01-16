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

// https://web.dev/customize-install/#beforeinstallprompt
let deferredPrompt;

// window is not defined on ssr
// https://github.com/vercel/next.js/issues/5354#issuecomment-520305040
if (typeof window !== "undefined") {
    window.addEventListener("beforeinstallprompt", (e) => {
        // Prevent the mini-infobar from appearing on mobile
        e.preventDefault();
        // Stash the event so it can be triggered later.
        deferredPrompt = e;
    });
}

const AddAppButton = () => {
    const [isAlreadyPWA, setIsAlreadyPWA] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [isiOS, setIsiOS] = useState(false);

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
    }, []);

    const handleAddApp = () => {
        setIsLoading(true);
        logEvent("home-clickAddApp", true);
        if (isiOS) {
            setShowiOS(true);
            logEvent("home-addApp-iOS");
        } else if (deferredPrompt) {
            // https://web.dev/customize-install/#in-app-flow

            // Show the install prompt
            deferredPrompt.prompt();
            // Wait for the user to respond to the prompt
            deferredPrompt.userChoice.then(() => setIsLoading(false));

            logEvent("home-addApp-native");
        } else {
            Swal.fire({
                title: "Hmm...",
                text:
                    "Failed to add rocketcrab as an app on this device. Try refreshing the page!",
                icon: "error",
                heightAuto: false,
            });
            setIsLoading(false);

            logEvent("home-addApp-failed");
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
