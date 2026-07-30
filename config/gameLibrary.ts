import { createServerFn } from "@tanstack/react-start";

/**
 * Load game metadata on the server. The config loader reads game modules and
 * guide files from disk, so it must not be imported into the browser bundle.
 */
export const getGameLibraries = createServerFn({ method: "GET" }).handler(
    async () => {
        const { GAME_LIBRARY } = await import("./index.ts");
        return GAME_LIBRARY;
    },
);
