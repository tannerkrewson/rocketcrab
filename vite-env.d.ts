/// <reference types="vite/client" />

/**
 * Type declarations for vite-plugin-pwa virtual module.
 * Provides the registerSW function for service worker registration.
 */
declare module "virtual:pwa-register" {
    import type { RegisterSWOptions } from "vite-plugin-pwa/types";

    export type { RegisterSWOptions };

    export function registerSW(
        options?: RegisterSWOptions,
    ): (reloadPage?: boolean) => Promise<void>;
}
