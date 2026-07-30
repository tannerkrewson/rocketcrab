/**
 * SSR-safe cookie utilities.
 *
 * - In the browser: reads/writes document.cookie
 * - In SSR/synchronous contexts: caller passes a cookie string
 *   (from request headers or stored value)
 *
 * No dependency on `nookies` or any Next.js API.
 */

export type CookieOptions = {
    maxAge?: number;
    path?: string;
    domain?: string;
    secure?: boolean;
    sameSite?: "strict" | "lax" | "none";
};

const DEFAULT_OPTIONS: CookieOptions = {
    path: "/",
    sameSite: "lax",
};

/**
 * Read a cookie value from a cookie string (e.g. `document.cookie`
 * or the `Cookie` request header).
 *
 * Returns `undefined` when the cookie is absent.
 */
export function getCookie(
    name: string,
    cookieString?: string,
): string | undefined {
    const source =
        cookieString ??
        (typeof document !== "undefined" ? document.cookie : "");
    if (!source) return undefined;

    for (const entry of source.split("; ")) {
        const eq = entry.indexOf("=");
        if (eq === -1) continue;
        const key = entry.slice(0, eq).trim();
        if (key === name) {
            try {
                return decodeURIComponent(entry.slice(eq + 1));
            } catch {
                return entry.slice(eq + 1);
            }
        }
    }
    return undefined;
}

/**
 * Set a cookie in the browser.
 *
 * In SSR contexts this is a no-op — the caller should set the
 * cookie header on the response instead.
 */
export function setCookie(
    name: string,
    value: string,
    options?: CookieOptions,
): void {
    if (typeof document === "undefined") return;

    const opts = { ...DEFAULT_OPTIONS, ...options };
    const parts: string[] = [
        `${encodeURIComponent(name)}=${encodeURIComponent(value)}`,
    ];

    if (opts.maxAge != null) parts.push(`max-age=${opts.maxAge}`);
    if (opts.path) parts.push(`path=${opts.path}`);
    if (opts.domain) parts.push(`domain=${opts.domain}`);
    if (opts.secure) parts.push("secure");
    if (opts.sameSite) parts.push(`samesite=${opts.sameSite}`);

    document.cookie = parts.join("; ");
}

/**
 * Remove a cookie by setting its max-age to zero.
 */
export function removeCookie(name: string, options?: CookieOptions): void {
    setCookie(name, "", { ...options, maxAge: 0 });
}
