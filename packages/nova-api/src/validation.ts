/**
 * Structural validation for game-facing API inputs.
 *
 * The game-facing API validates every input with the same bounded Zod
 * schemas used at the protocol boundary (threat model T10 — no `any`, never
 * trust game-supplied values). The runtime
 * frame re-validates everything at its own boundary; these schemas give the
 * game an immediate, clear error before anything crosses a trust boundary.
 *
 * Payloads are additionally required to be structured-clone-compatible and
 * JSON-serializable (the two checks together): functions, cycles, BigInt,
 * and DOM nodes must never cross the frame, and the transport moves plain
 * JSON data.
 */
import { tickRateMax, titleSchema } from "@rocketcrab/protocol";
import { z } from "zod";
import { NovaError } from "./errors";

/** Bounded registration options for `nova.defineGame`. */
export const novaGameDeclarationSchema = z.object({
  title: titleSchema.optional(),
  version: z.string().min(1).max(32).optional(),
  apiVersion: z.number().int().min(1).optional(),
  tickRate: z.number().int().min(1).max(tickRateMax).optional(),
});

/** Bounded action shape for `nova.dispatch`. */
export const novaActionSchema = z.object({
  type: z.string().min(1).max(64),
  payload: z.unknown().optional(),
  baseRevision: z.number().int().nonnegative().optional(),
});

/** True when a payload is binary (Uint8Array or ArrayBuffer). */
export function isBinaryPayload(payload: unknown): boolean {
  return payload instanceof Uint8Array || payload instanceof ArrayBuffer;
}

/**
 * Require `value` to be structured-clone-compatible AND JSON-serializable
 * (plain data only): throws {@link NovaError} with code `invalid_payload`
 * otherwise. Binary payloads are rejected: game data is JSON. `structuredClone` rejects functions, cycles, and DOM nodes
 * (frame-safety); `JSON.stringify` rejects BigInt and non-serializable
 * values (transport-safety).
 */
export function assertStructuredCloneSafe(value: unknown, label: string): void {
  if (value === undefined) {
    return; // optional payloads may be omitted
  }
  if (isBinaryPayload(value)) {
    throw new NovaError("invalid_payload", `${label} must be plain JSON data, not binary.`);
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
