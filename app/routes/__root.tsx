import React from "react";
import {
    Outlet,
    HeadContent,
    Scripts,
    createRootRoute,
    Link,
} from "@tanstack/react-router";
import type { ErrorComponentProps } from "@tanstack/react-router";
import "@heroui/react/styles";

// --- Global Styles ---
import "../../styles/global.css";
// --- Fonts ---
import "@fontsource/inconsolata";
import "@fontsource/mukta";

// --- Mode Context ---
import { ModeProvider } from "../../utils/ModeContext";
import { getModeFromHost } from "../../utils/mode";

// --- Theme ---
import { ThemeProvider, ThemeScript } from "../../utils/theme";

// --- Modal ---
import { ModalProvider } from "../../utils/ModalContext";

// --- Analytics ---
import { AppAnalytics } from "../../utils/AnalyticsTracker";

/**
 * Root error boundary — catches rendering errors anywhere in the route tree.
 */
function RootErrorComponent({ error }: ErrorComponentProps) {
    return (
        <div
            style={{
                textAlign: "center",
                padding: "2em",
                fontFamily: "Mukta, sans-serif",
            }}
        >
            <h1>Something went wrong</h1>
            <p style={{ color: "#e74c3c" }}>
                {error?.message || "An unexpected error occurred."}
            </p>
            <a href="/">Go home</a>
        </div>
    );
}

/**
 * 404 catch-all — shown when no route matches the URL.
 */
function RootNotFoundComponent() {
    return (
        <div
            style={{
                textAlign: "center",
                padding: "2em",
                fontFamily: "Mukta, sans-serif",
            }}
        >
            <h1>404 — Page Not Found</h1>
            <p>This page does not exist.</p>
            <Link to="/">Go home</Link>
        </div>
    );
}

/**
 * Root layout — wraps every route in the application.
 *
 * Provides the ModeProvider with the resolved mode (MAIN/KIDS) from the
 * request hostname. This is SSR-safe — no browser-only globals are
 * accessed during server rendering.
 *
 * The HTML document shell (<html>, <head>, <body>, <Scripts>) is
 * managed by the TanStack Start stream handler, not by this route.
 */
export const Route = createRootRoute({
    component: RootComponent,
    errorComponent: RootErrorComponent,
    notFoundComponent: RootNotFoundComponent,
});

function RootComponent() {
    const [mounted, setMounted] = React.useState(false);
    React.useEffect(() => setMounted(true), []);
    /**
     * Resolve the mode from the current hostname.
     * During SSR, the TanStack Start request context provides the hostname.
     * In the browser, window.location.hostname is used.
     *
     * This is intentionally safe for SSR: we guard against browser-only
     * globals with the typeof check before accessing them.
     */
    const hostname =
        typeof window !== "undefined"
            ? window.location.hostname
            : "rocketcrab.com";
    const mode = getModeFromHost(hostname);

    return (
        <html>
            <head>
                <HeadContent />
                {/* PWA manifest link — enables browser install prompt */}
                <link rel="manifest" href="/manifest.webmanifest" />
                <meta name="theme-color" content="#ffffff" />
            </head>
            <body>
                <ModeProvider mode={mode}>
                    <ThemeProvider>
                        {/* Inline script to set theme class before hydration */}
                        {!mounted && <ThemeScript />}
                        <ModalProvider>
                            <AppAnalytics />
                            <div id="app-root">
                                <Outlet />
                            </div>
                        </ModalProvider>
                    </ThemeProvider>
                </ModeProvider>
                <Scripts />
            </body>
        </html>
    );
}
