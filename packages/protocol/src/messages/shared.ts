import { z } from "zod";

/** Game execution modes (ADR-0006 state / raw modes). */
export const gameModeSchema = z.enum(["state", "raw"]);

export type GameMode = z.infer<typeof gameModeSchema>;

/**
 * Reasons a game ends (`game.end` on both planes). Shared so the peer
 * announcement and the runtime teardown request never drift.
 */
export const gameEndReasonSchema = z.enum(["user_exit", "host_closed", "error"]);

export type GameEndReason = z.infer<typeof gameEndReasonSchema>;
