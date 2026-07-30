/**
 * Mode Resolution Module
 *
 * Resolves Rocketcrab application mode (MAIN or KIDS) from the request hostname.
 * This module is designed to work WITHOUT Next.js — it can be imported by both
 * the current Express/Socket.IO server and the future TanStack Start router.
 *
 * Mode mapping:
 *   - `rocketcrab.com`          → MAIN  (default)
 *   - `kids.rocketcrab.com`     → KIDS
 *
 * Import this module directly in server code. On the client, use ModeProvider
 * and useMode() from ./ModeContext.tsx.
 *
 * Local dev: set HOSTNAME env var or use hostname localhost → MAIN.
 * To test KIDS mode locally, set HOSTNAME=kids.localhost or configure
 * your hosts file: 127.0.0.1  kids.localhost
 */

import { RocketcrabMode } from "../types/enums";

/**
 * Maps each RocketcrabMode to its canonical hostname.
 */
export const MODE_MAP: Record<RocketcrabMode, string> = {
    [RocketcrabMode.MAIN]: "rocketcrab.com",
    [RocketcrabMode.KIDS]: "kids.rocketcrab.com",
    [RocketcrabMode.ALL]: "rocketcrab.com", // ALL mode is for testing only
};

/**
 * Resolves the application mode from a request hostname.
 *
 * - Hostnames starting with "kids." resolve to KIDS.
 * - Everything else (including localhost, IPs, unknown) resolves to MAIN.
 *
 * Server usage:
 *   const mode = getModeFromHost(req.hostname);
 *
 * Client usage (when hostname is available):
 *   const mode = getModeFromHost(window.location.hostname);
 */
export const getModeFromHost = (hostname: string): RocketcrabMode =>
    hostname?.startsWith("kids.") ? RocketcrabMode.KIDS : RocketcrabMode.MAIN;

/**
 * Returns true when the given mode is KIDS.
 * KIDS mode restricts which games are shown and makes /find unavailable.
 */
export const isKidsMode = (mode: RocketcrabMode): boolean =>
    mode === RocketcrabMode.KIDS;
