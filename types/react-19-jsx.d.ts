/**
 * React 19 compatibility: re-export the JSX global type for files
 * that reference `JSX.Element` without an explicit import.
 *
 * React 19 types removed the implicit global `JSX` namespace.
 * These files will be migrated to `import type { JSX } from "react"`
 * during the UI-02 component conversion. This declaration avoids
 * requiring a per-file change during the foundation migration.
 */
import "react";

declare global {
    namespace JSX {
        type Element = import("react").JSX.Element;
    }
}
