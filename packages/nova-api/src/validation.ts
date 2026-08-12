/**
 * Structural validation for game-facing API inputs.
 *
 * The game-facing API validates every input with the same bounded Zod
 * schemas used at the protocol boundary (threat model T10; engineering
 * rules 15/21 — no `any`, never trust game-supplied values). The runtime
 * frame re-validates everything at its own boundary; these schemas give the
 * game an immediate, clear error before anything crosses a trust boundary.
 *
 * Payloads are additionally required to be structured-clone-compatible and
 * JSON-serializable (the two checks together): functions, cycles, BigInt,
 * and DOM nodes must never cross the frame, and the transport moves plain
 * JSON data.
 */
import { titleSchema } from "@rocketcrab/protocol";
import { z } from "zod";
import { NovaError } from "./errors";

/** Bounded registration options for `nova.defineGame` (S1 surface). */
export const novaGameDeclarationSchema = z.object({
  title: titleSchema.optional(),
  mode: z.enum(["state", "simulation", "raw"]).optional(),
  version: z.string().min(1).max(32).optional(),
  apiVersion: z.number().int().min(1).optional(),
});

/** Bounded action shape for `nova.dispatch` (state mode). */
export const novaActionSchema = z.object({
  type: z.string().min(1).max(64),
  payload: z.unknown().optional(),
  baseRevision: z.number().int().nonnegative().optional(),
});

/** Bounded raw channel spec for `nova.raw.createChannel`. */
export const novaRawChannelSpecSchema = z.object({
  name: z.string().min(1).max(64),
  reliable: z.boolean().optional(),
  ordered: z.boolean().optional(),
  binary: z.boolean().optional(),
});

/** Bounded raw channel name for `nova.raw.send` / `onMessage`. */
export const novaChannelNameSchema = z.string().min(1).max(64);

/** Bounded simulation input shape for `nova.simulation.sendInput`. */
export const novaSimulationInputSchema = z.object({
  type: z.string().min(1).max(64),
  payload: z.unknown().optional(),
  tick: z.number().int().nonnegative().optional(),
});

/** True when a payload is binary and travels on the transport binary path. */
export function isBinaryPayload(payload: unknown): boolean {
  return payload instanceof Uint8Array || payload instanceof ArrayBuffer;
}

/**
 * Require `value` to be structured-clone-compatible AND JSON-serializable
 * (plain data only): throws {@link NovaError} with code `invalid_payload`
 * otherwise. Binary payloads are rejected here — they are only allowed on
 * raw channels. `structuredClone` rejects functions, cycles, and DOM nodes
 * (frame-safety); `JSON.stringify` rejects BigInt and non-serializable
 * values (transport-safety).
 */
export function assertStructuredCloneSafe(value: unknown, label: string): void {
  if (value === undefined) {
    return; // optional payloads may be omitted
  }
  if (isBinaryPayload(value)) {
    throw new NovaError(
      "invalid_payload",
      `${label} must be plain data; binary payloads are only allowed on raw channels.`,
    );
  }
  try {
    structuredClone(value);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new NovaError(
      "invalid_payload",
      `${label} must be structured-clone-compatible plain data: ${detail}`,
    );
  }
  try {
    const json = JSON.stringify(value);
    if (json === undefined) {
      throw new TypeError("value is not JSON-serializable");
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new NovaError(
      "invalid_payload",
      `${label} must be JSON-serializable (structured-clone-compatible) data: ${detail}`,
    );
  }
}

/** Throw {@link NovaError} with code `invalid_options` when `ok` is false. */
export function assertValid(ok: boolean, detail: string): void {
  if (!ok) {
    throw new NovaError("invalid_options", detail);
  }
}
