/**
 * Nova media transport (A3) — experimental surface.
 *
 * The A3 spike (docs/testing/media-bridging-findings.md) evaluated how a
 * game frame that acquires camera/microphone media could publish it through
 * Nova's Trystero-managed party connection. The verdict: media transport is
 * **experimental** for v1. The game-facing surface exists so games can
 * probe platform capability and fail clearly, but no track/stream may cross
 * the runtime frame boundary yet (Blocker Register B7).
 *
 * Why experimental (see the findings doc for the full option-by-option
 * evaluation):
 * - Cross-document media transfer (structured-cloning/transferring
 *   MediaStreamTrack across postMessage boundaries) is spec-listed but
 *   **unverified on the supported Mobile Safari versions**; F4 verified
 *   in-frame capture on device, not cross-frame transfer. B7 says: do not
 *   assume a cross-frame media bridge works consistently merely because the
 *   objects are structured-clone/transferable candidates.
 * - The protocol boundary currently only admits schema-validated plain
 *   data (threat model T10); live media objects cannot be schema-validated
 *   and must be treated as untrusted game content.
 *
 * This module implements the probe and the clear-failure contract; the
 * `nova.media` handle in `createNovaClient` and the in-frame bridge are
 * built from it (parity is asserted in the runtime bridge tests).
 */
import { NovaError } from "./errors";

/** Stable error code for media transport that cannot cross the boundary. */
export const MEDIA_UNSUPPORTED_CODE = "media_unsupported";

/** Message for `nova.media.publish` failures in this build. */
export const MEDIA_UNSUPPORTED_MESSAGE =
  "Media transport is experimental in this build: camera/microphone media cannot cross the runtime frame boundary yet. See docs/testing/media-bridging-findings.md.";

/** Message when `nova.media.publish` receives a non-media argument. */
export const MEDIA_PUBLISH_INPUT_MESSAGE =
  "nova.media.publish expects a MediaStreamTrack or MediaStream.";

/**
 * Platform capability probe: can this browser realm structured-clone a
 * `MediaStream`?
 *
 * This is the conservative, prompt-free part of the cross-frame media
 * question: if the platform cannot even clone a `MediaStream` in this
 * realm, it certainly cannot transfer tracks across the frame boundary. A
 * `true` result does **not** prove the full bridge works — track transfer
 * and the multi-hop party path still need the device-verification checklist
 * in `docs/testing/media-bridging-findings.md`. Returns `false` whenever
 * the APIs or `structuredClone` are unavailable (e.g. the Node test
 * environment) or the probe throws `DataCloneError`.
 */
export function probeMediaSupport(): boolean {
  try {
    if (typeof structuredClone !== "function") return false;
    if (typeof MediaStream === "undefined") return false;
    const probe = new MediaStream();
    const cloned = structuredClone(probe);
    return cloned instanceof MediaStream;
  } catch {
    return false;
  }
}

/**
 * True when `value` is a real `MediaStreamTrack` or `MediaStream` in this
 * realm. `instanceof`-based, so cross-realm media objects fail this check —
 * the game must pass a live local object (acquisition stays inside the game
 * frame; A3 acceptance).
 */
export function isMediaInput(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof MediaStreamTrack !== "undefined" && value instanceof MediaStreamTrack) return true;
  if (typeof MediaStream !== "undefined" && value instanceof MediaStream) return true;
  return false;
}

/**
 * The clear failure for `nova.media.publish` in this build: after lifecycle
 * and input validation, every publish attempt fails with the stable
 * `media_unsupported` code (unsupported combinations fail clearly; A3
 * acceptance).
 */
export function mediaUnsupportedError(): NovaError {
  return new NovaError(MEDIA_UNSUPPORTED_CODE, MEDIA_UNSUPPORTED_MESSAGE);
}
