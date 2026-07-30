/**
 * Mode Context — SSR-safe React context for Rocketcrab application mode.
 *
 * Provides the resolved mode (MAIN or KIDS) to all descendant components
 * without relying on Next.js locale routing.
 *
 * Usage:
 *   // Root: wrap with the resolved mode
 *   <ModeProvider mode={getModeFromHost(hostname)}>
 *       <App />
 *   </ModeProvider>
 *
 *   // Any component:
 *   const mode = useMode();
 *   const kids = isKidsMode(mode);
 *
 * The mode must be resolved server-side (from hostname) and passed down.
 * Browser-only fallback: resolve from window.location.hostname on mount.
 */

import React, { createContext, useContext } from "react";
import { RocketcrabMode } from "../types/enums";

const ModeContext = createContext<RocketcrabMode>(RocketcrabMode.MAIN);

/**
 * Provider that makes the mode available to all descendant components.
 * Wrap the application root once with the resolved mode.
 */
export const ModeProvider = ({
    mode,
    children,
}: {
    mode: RocketcrabMode;
    children: React.ReactNode;
}): JSX.Element => (
    <ModeContext.Provider value={mode}>{children}</ModeContext.Provider>
);

/**
 * Hook to consume the current mode from context.
 */
export const useMode = (): RocketcrabMode => {
    const mode = useContext(ModeContext);
    return mode;
};
