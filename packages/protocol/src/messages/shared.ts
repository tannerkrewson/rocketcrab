import { z } from "zod";

/**
 * Reasons a game ends (`game.end` on both planes). Shared so the peer
 * announcement and the runtime teardown request never drift.
 */
export const gameEndReasonSchema = z.enum(["user_exit", "host_closed", "error"]);

export type GameEndReason = z.infer<typeof gameEndReasonSchema>;
