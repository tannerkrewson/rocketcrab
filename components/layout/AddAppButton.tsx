import { lazy, Suspense, useState, useEffect, useContext } from "react";
import PrimaryButton from "../common/PrimaryButton";
import { logEvent } from "../../utils/analytics";
import { ModalContext } from "../../utils/ModalContext";

// https://github.com/chrisdancee/react-ios-pwa-prompt/issues/32#issuecomment-586762839
const PWAPrompt = lazy(() => import("react-ios-pwa-prompt"));

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

const AddAppButton = (): JSX.Element => {
    const [isLoading, setIsLoading] = useState(false);
    const [isiOS, setIsiOS] = useState(false);

    const [showiOS, setShowiOS] = useState(false);

    useEffect(() => {
        setIsiOS(
            /iPad|iPhone|iPod/.test(navigator.userAgent) &&
                !("MSStream" in window),
        );
    }, []);

    const fireModal = useContext(ModalContext);

    const handleAddApp = () => {
        setIsLoading(true);
        logEvent("home-clickAddApp");
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
            fireModal({
                title: "Hmm...",
                text: "Failed to add rocketcrab as an app on this device. Try refreshing the page!",
                icon: "error",
            });
            setIsLoading(false);

            logEvent("home-addApp-failed");
        }
    };

    return (
        <>
            <PrimaryButton
                onClick={handleAddApp}
                disabled={isLoading}
                loading={isLoading}
            >
                Add 🚀🦀 App
            </PrimaryButton>

            <Suspense fallback={null}>
                <PWAPrompt
                    appIconPath="/apple-touch-icon.png"
                    isShown={showiOS}
                    onClose={() => {
                        setShowiOS(false);
                        setIsLoading(false);
                    }}
                />
            </Suspense>
        </>
    );
};

export default AddAppButton;
