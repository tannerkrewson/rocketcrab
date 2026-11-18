/**
 * Revalidate forwarded API calls before they reach a NovaSession. Runtime
 * validation is not a trust boundary for the host; these schemas mirror it
 * by contract, with tests guarding against drift.
 */
import { z } from "zod";
import { stateResponseSchema } from "@rocketcrab/protocol";

export const arenaApiCallSchemas = {
  ready: z.object({}).strict(),
  dispatch: z
    .object({
      action: z.object({
        type: z.string().min(1).max(64),
        payload: z.unknown().optional(),
        baseRevision: z.number().int().nonnegative().optional(),
      }),
      actionId: z.string().min(1).max(64),
    })
    .strict(),
  "raw.createChannel": z
    .object({
      spec: z.object({
        name: z.string().min(1).max(64),
        reliable: z.boolean().optional(),
        ordered: z.boolean().optional(),
        binary: z.boolean().optional(),
      }),
    })
    .strict(),
  "raw.close": z
    .object({
      name: z.string().min(1).max(64),
    })
    .strict(),
  "raw.send": z
    .object({
      name: z.string().min(1).max(64),
      payload: z.unknown(),
      options: z
        .object({
          to: z.string().min(1).max(64).optional(),
          reliable: z.boolean().optional(),
          ordered: z.boolean().optional(),
        })
        .optional(),
    })
    .strict(),
  "controls.set": z.object({ controls: z.unknown() }).strict(),
  stateResponse: z
    .object({
      requestId: z.string().min(1).max(64),
      result: stateResponseSchema,
    })
    .strict(),
} as const;

export type ArenaApiCallMethod = keyof typeof arenaApiCallSchemas;
