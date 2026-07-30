/**
 * TanStack Router analytics integration.
 *
 * Replaces the old next/router Router.events-based analytics in pages/_app.tsx.
 * Uses TanStack Router's useLocation to detect navigation and send pageviews
 * via react-ga4. Initializes Google Analytics once in the browser.
 *
 * Place this component inside the root route layout. It renders nothing.
 */
import { useEffect, useRef } from "react";
import { useLocation } from "@tanstack/react-router";
import { initGA, logPageView } from "./analytics";

export function AppAnalytics(): null {
    const location = useLocation();
    const initialized = useRef(false);

    // Initialize GA once on mount
    useEffect(() => {
        if (initialized.current) return;
        initialized.current = true;
        initGA();
        logPageView();
    }, []);

    // Send pageview on every navigation
    useEffect(() => {
        // Skip the initial pageview (already sent above)
        if (!initialized.current) return;
        logPageView();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [location.pathname, location.search]);

    return null;
}
