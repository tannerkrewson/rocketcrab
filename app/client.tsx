/// <reference types="vite/client" />
import { StartClient } from "@tanstack/react-start/client";
import { hydrateRoot } from "react-dom/client";

hydrateRoot(document, <StartClient />);

// Register service worker in production only
if (import.meta.env.PROD && "serviceWorker" in navigator) {
    import("virtual:pwa-register").then(({ registerSW }) => {
        registerSW({
            onNeedRefresh() {
                console.log("[PWA] Update available; auto-updating...");
            },
            onOfflineReady() {
                console.log("[PWA] App ready for offline use");
            },
        });
    });
}
