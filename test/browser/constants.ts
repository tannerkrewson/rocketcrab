/**
 * Shared constants for the browser-mode E2E suite.
 *
 * The app server is started by test/browser/globalSetup.ts on
 * ROCKETCRAB_TEST_PORT (default 3010). The URL is injected into browser-side
 * code through `define` in vitest.browser.config.mts.
 */
declare const __ROCKETCRAB_APP_URL__: string | undefined;

export const APP_URL: string =
    typeof __ROCKETCRAB_APP_URL__ === "string"
        ? __ROCKETCRAB_APP_URL__
        : "http://localhost:3010";

/** Mock game hostname — the app iframes this host; we intercept it. */
export const MOCK_GAME_HOST = "just1.herokuapp.com";

/** Host app iframe id (nested inside the vitest test iframe). */
export const HOST_IFRAME_ID = "host-app";
