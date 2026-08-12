import { z } from "zod";

/** Game execution modes (ADR-0006 state / simulation / raw modes). */
export const gameModeSchema = z.enum(["state", "simulation", "raw"]);

export type GameMode = z.infer<typeof gameModeSchema>;
