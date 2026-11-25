/**
 * Shared guards for the decorative React Bits WebGL backgrounds
 * (vendor/react-bits). They are pure decoration: when WebGL2 is missing the
 * page keeps its plain theme background.
 */

/** False in jsdom and very old browsers, so tests never create a GL context. */
export function canUseWebGL2(): boolean {
  return typeof window !== "undefined" && typeof window.WebGL2RenderingContext === "function";
}

/**
 * Canvas pixel ratio that keeps a full-viewport shader near `pixelBudget`
 * pixels. Phones' small screens get close to 1x; large desktop windows drop
 * toward the components' 0.5 floor. The soft, hazy backgrounds upscale
 * without visible blur, and fragment cost scales with the pixel count.
 */
export function viewportPixelRatio(pixelBudget: number): number {
  if (typeof window === "undefined") return 1;
  const area = Math.max(1, window.innerWidth * window.innerHeight);
  return Math.min(1, Math.max(0.5, Math.sqrt(pixelBudget / area)));
}
