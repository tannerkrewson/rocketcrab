/// <reference types="vite/client" />
import { StartClient } from "@tanstack/react-start/client";
import { hydrateRoot } from "react-dom/client";

hydrateRoot(document, <StartClient />);

// Register service worker in production only
// Uses the manual SW at /sw.js (public/sw.js) which handles caching
// and cleanup of old next-pwa service workers.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
    try {
        navigator.serviceWorker
            .register("/sw.js", {
                scope: "/",
                type: "classic",
            })
            .then((registration) => {
                registration.addEventListener("updatefound", () => {
                    const newWorker = registration.installing;
                    if (newWorker) {
                        newWorker.addEventListener("statechange", () => {
                            if (
                                newWorker.state === "installed" &&
                                navigator.serviceWorker.controller
                            ) {
                                console.log(
                                    "[PWA] New version detected; activating...",
                                );
                                newWorker.postMessage({ type: "SKIP_WAITING" });
                            }
                        });
                    }
                });
            })
            .catch((_err) => {
                console.warn("[PWA] Service worker registration failed:", _err);
            });
    } catch {
        console.warn("[PWA] Service worker not supported");
    }
}
