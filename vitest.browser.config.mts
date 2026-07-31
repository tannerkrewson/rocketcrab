/**
 * Vitest Browser Mode config — E2E user-flow tests against the real app.
 *
 * Runs tests in a real Chromium via the Playwright provider
 * (@vitest/browser-playwright). The app server is started by
 * test/browser/globalSetup.ts; test/browser/rocketcrab-command.ts exposes the
 * `rocketcrab` custom browser command that drives real pages in the
 * provider's browser.
 *
 * Run with: npm run test:browser
 */
import { defineConfig } from "vitest/config";
import { playwright } from "@vitest/browser-playwright";
import { rocketcrabCommand } from "./test/browser/rocketcrab-command.ts";

const APP_PORT = Number(process.env.ROCKETCRAB_TEST_PORT || 3010);

export default defineConfig({
    define: {
        __ROCKETCRAB_APP_URL__: JSON.stringify(`http://localhost:${APP_PORT}`),
    },
    oxc: {
        jsx: { importSource: "react" },
    },
    test: {
        name: "browser",
        include: ["test/browser/**/*.test.ts"],
        exclude: [],
        globalSetup: ["./test/browser/globalSetup.ts"],
        browser: {
            enabled: true,
            provider: playwright({}),
            instances: [{ browser: "chromium" }],
            headless: true,
            screenshotFailures: false,
            commands: {
                rocketcrab: rocketcrabCommand,
            },
        },
        // The suite drives one shared app server; keep files sequential.
        fileParallelism: false,
        testTimeout: 120_000,
        hookTimeout: 120_000,
    },
});
