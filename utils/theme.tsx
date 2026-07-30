/**
 * SSR-safe theme system.
 *
 * Replaces `next-dark-mode` with an application-owned implementation:
 * - Persists preference in a cookie (`theme`)
 * - Applies the `dark` class to `<html>` before hydration (inline script)
 * - Supports three modes: "light", "dark", "system"
 *
 * Usage:
 *   const { mode, resolvedTheme, setTheme, isDark } = useTheme();
 *
 * Install:
 *   1. Wrap the app root with <ThemeProvider>.
 *   2. The inline script in <ThemeScript /> prevents flash.
 *   3. ThemeToggle uses the hook directly.
 */

import React, {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useState,
} from "react";
import { getCookie, setCookie as setCookieValue } from "./cookies";

// --- Types ---

export type ThemeMode = "light" | "dark" | "system";

export type ThemeContextType = {
    /** The user's stored preference (or "system"). */
    mode: ThemeMode;
    /** The resolved effective theme — always "light" or "dark". */
    resolvedTheme: "light" | "dark";
    /** True when the resolved theme is dark. */
    isDark: boolean;
    /** Update the stored preference. */
    setTheme: (mode: ThemeMode) => void;
    /** Toggle between light and dark. */
    toggle: () => void;
};

// --- Cookie ---

const THEME_COOKIE = "theme";
const THEME_MAX_AGE = 365 * 24 * 60 * 60; // 1 year

function readThemeCookie(): ThemeMode | undefined {
    const raw = getCookie(THEME_COOKIE);
    if (raw === "light" || raw === "dark" || raw === "system") {
        return raw;
    }
    return undefined;
}

function persistThemeCookie(mode: ThemeMode): void {
    setCookieValue(THEME_COOKIE, mode, { maxAge: THEME_MAX_AGE });
}

// --- Apply class to <html> ---

function applyThemeClass(isDark: boolean): void {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    if (isDark) {
        root.classList.add("dark");
    } else {
        root.classList.remove("dark");
    }
}

// --- Inline script to prevent flash ---

/**
 * An inline <script> element that reads the theme cookie and applies the
 * `dark` class to `<html>` *before* React hydrates.
 *
 * Render this in the root layout <head>.
 */
export function ThemeScript(): React.ReactElement {
    // We define a function and call toString() so the minifier can't break it.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    function inlineFn() {
        var cookie = document.cookie || "";
        var match = cookie.match(/(?:^|;\s*)theme=([^;]+)/);
        var mode = match ? match[1] : null;
        var dark = false;
        if (mode === "dark") {
            dark = true;
        } else if (mode !== "light") {
            dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
        }
        if (dark) {
            document.documentElement.classList.add("dark");
        }
    }

    return (
        <script
            dangerouslySetInnerHTML={{
                __html: "(" + inlineFn.toString() + ")()",
            }}
        />
    );
}

// --- React Context & Provider ---

const ThemeContext = createContext<ThemeContextType | null>(null);

export function ThemeProvider({
    children,
}: {
    children: React.ReactNode;
}): React.ReactElement {
    const [mode, setModeState] = useState<ThemeMode>(() => {
        // During SSR, read from cookie (set by the server or previous session)
        // In the browser, this initializes from the cookie as well.
        return readThemeCookie() ?? "system";
    });

    const [systemDark, setSystemDark] = useState(false);

    // Listen for system preference changes
    useEffect(() => {
        const mq = window.matchMedia("(prefers-color-scheme: dark)");
        const handler = (e: MediaQueryListEvent) => setSystemDark(e.matches);
        setSystemDark(mq.matches);
        mq.addEventListener("change", handler);
        return () => mq.removeEventListener("change", handler);
    }, []);

    const resolvedTheme = useMemo<"light" | "dark">(
        () => {
            if (mode === "dark") return "dark";
            if (mode === "light") return "light";
            return systemDark ? "dark" : "light";
        },
        [mode, systemDark],
    );

    // Apply the dark class whenever the resolved theme changes
    useEffect(() => {
        applyThemeClass(resolvedTheme === "dark");
    }, [resolvedTheme]);

    const setTheme = useCallback((newMode: ThemeMode) => {
        setModeState(newMode);
        persistThemeCookie(newMode);
    }, []);

    const toggle = useCallback(() => {
        setTheme(resolvedTheme === "dark" ? "light" : "dark");
    }, [resolvedTheme, setTheme]);

    const contextValue = useMemo<ThemeContextType>(
        () => ({
            mode,
            resolvedTheme,
            isDark: resolvedTheme === "dark",
            setTheme,
            toggle,
        }),
        [mode, resolvedTheme, setTheme, toggle],
    );

    return (
        <ThemeContext.Provider value={contextValue}>
            {children}
        </ThemeContext.Provider>
    );
}

/**
 * Access the current theme state.
 *
 * Must be used inside a <ThemeProvider>.
 */
export function useTheme(): ThemeContextType {
    const ctx = useContext(ThemeContext);
    if (!ctx) {
        throw new Error("useTheme must be used within a <ThemeProvider>");
    }
    return ctx;
}
