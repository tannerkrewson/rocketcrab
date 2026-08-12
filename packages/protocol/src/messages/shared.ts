import { z } from "zod";

/** Game execution modes (ADR-0006 state / simulation / raw modes). */
export const gameModeSchema = z.enum(["state", "simulation", "raw"]);

export type GameMode = z.infer<typeof gameModeSchema>;

/**
 * Reasons a game ends (S1 `game.end` on both planes). Shared so the peer
 * announcement and the runtime teardown request never drift.
 */
export const gameEndReasonSchema = z.enum([
  "user_exit",
  "host_closed",
  "authority_migrated",
  "error",
]);

export type GameEndReason = z.infer<typeof gameEndReasonSchema>;
