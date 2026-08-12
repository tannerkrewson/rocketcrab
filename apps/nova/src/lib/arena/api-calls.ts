/**
 * Host-side validation of forwarded Nova API calls (U6 session router).
 *
 * The runtime already validated these payloads at its boundary
 * (`novaApiCallSchemas` in apps/runtime); the arena re-validates at the host
 * boundary before touching a NovaSession, so malformed game input can never
 * reach the session (defense in depth — never trust game input at any hop).
 * Shapes mirror the runtime schemas by contract; drift is pinned by tests.
 */
import { z } from "zod";

export const arenaApiCallSchemas = {
  ready: z.object({}).strict(),
  dispatch: z
    .object({
      action: z.object({
        type: z.string().min(1).max(64),
        payload: z.unknown().optional(),
        baseRevision: z.number().int().nonnegative().optional(),
      }),
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
  "simulation.register": z.object({}).strict(),
  "simulation.sendInput": z
    .object({
      input: z.object({
        type: z.string().min(1).max(64),
        payload: z.unknown().optional(),
        tick: z.number().int().nonnegative().optional(),
      }),
    })
    .strict(),
} as const;

export type ArenaApiCallMethod = keyof typeof arenaApiCallSchemas;
