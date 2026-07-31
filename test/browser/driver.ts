/**
 * Browser-side driver for the rocketcrab custom command.
 *
 * Tests run inside Vitest's browser-mode iframe (real Chromium via the
 * Playwright provider). `commands` from `@vitest/browser/context` bridges to
 * the server-side command in test/browser/rocketcrab-command.ts, which drives
 * real pages in the provider's browser.
 */
import { commands, page, userEvent } from "vitest/browser";
import type { RcPayload, RcOp } from "./rocketcrab-command";
import { HOST_IFRAME_ID } from "./constants";

type RcResult = Record<string, unknown> | string | number | null;

export const rc = (payload: RcPayload): Promise<RcResult> =>
    (commands as unknown as Record<string, (p: RcPayload) => Promise<RcResult>>)
        .rocketcrab(payload);

/** Convenience accessor that returns the raw result of a payload. */
export const rcx = (op: RcOp, extra: Partial<RcPayload> = {}): Promise<RcResult> =>
    rc({ op, ...extra });

/**
 * Mount the host's app inside the vitest test iframe as a nested iframe.
 * Returns a vitest-browser FrameLocator for the host app, so tests can drive
 * the host with the `page` API (click/fill work cross-origin via the
 * provider's Playwright commands).
 */
export async function mountHostApp(
    url: string,
): Promise<ReturnType<typeof page.frameLocator>> {
    document.body.innerHTML = "";
    // Clear the app's cookies first so a previous test's lastPartyState
    // doesn't make the app skip the name-entry screen.
    await rc({ op: "clearAppState" });
    const iframe = document.createElement("iframe");
    iframe.id = HOST_IFRAME_ID;
    iframe.src = url;
    iframe.style.position = "absolute";
    iframe.style.top = "0";
    iframe.style.left = "0";
    iframe.style.width = "414px";
    iframe.style.height = "896px";
    iframe.style.border = "0";
    iframe.setAttribute("data-testid", HOST_IFRAME_ID);
    document.body.appendChild(iframe);
    return page.frameLocator(page.elementLocator(iframe));
}

/** Remove the host iframe (call in afterEach). */
export function unmountHostApp(): void {
    document.getElementById(HOST_IFRAME_ID)?.remove();
}

export { page, userEvent };
