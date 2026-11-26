import { z } from "zod";
import { titleSchema } from "./ids";
import { playerLimitMax, tickRateMax } from "./limits";

/** Bounded registration options for `nova.defineGame`. */
const declarationFields = {
  title: titleSchema.optional(),
  apiVersion: z.number().int().min(1).optional(),
  tickRate: z.number().int().min(1).max(tickRateMax).optional(),
  minPlayers: z.number().int().min(1).max(playerLimitMax).optional(),
  maxPlayers: z.number().int().min(1).max(playerLimitMax).optional(),
};
const version = z.string().min(1).max(32).optional();

function playerLimitsInOrder(options: {
  minPlayers?: number | undefined;
  maxPlayers?: number | undefined;
}): boolean {
  return (
    options.minPlayers === undefined ||
    options.maxPlayers === undefined ||
    options.minPlayers <= options.maxPlayers
  );
}

export const novaGameDeclarationSchema = z
  .object({ ...declarationFields, version })
  .refine(playerLimitsInOrder, { message: "minPlayers must not exceed maxPlayers." });

export const runtimeGameDeclarationSchema = z
  .object({ ...declarationFields, gameVersion: version })
  .refine(playerLimitsInOrder);
export type RuntimeGameDeclaration = z.infer<typeof runtimeGameDeclarationSchema>;

/** Bounded action shape for `nova.dispatch`. */
export const novaActionSchema = z.object({
  type: z.string().min(1).max(64),
  payload: z.unknown().optional(),
  baseRevision: z.number().int().nonnegative().optional(),
});

export const gameFileRefSchema = z.string().regex(/^nova-file:[0-9a-f]{64}$/);
export const gameFileTypeSchema = z
  .string()
  .max(127)
  .regex(/^[\x20-\x7e]*$/);
