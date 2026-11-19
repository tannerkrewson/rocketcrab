import { lazy, Suspense } from "react";
import { canUseWebGL2 } from "./webgl";

const Silk = lazy(() => import("../../vendor/react-bits/Silk"));

/**
 * Deep Nova-blue satin (React Bits "Silk") filling a positioned parent: the
 * home page's Nova card and the /build hero it expands into. The satin is
 * kept dark (low sheen, deep base) and a scrim darkens the middle, so white
 * and `text-nova-text` copy keeps its contrast over the highlights.
 */
export function NovaSilk() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0">
      {canUseWebGL2() ? (
        <Suspense fallback={null}>
          <Silk
            color="#132b72"
            sheenColor="#7d9be0"
            speed={3}
            scale={1.1}
            noiseIntensity={0.5}
            sheen={0.3}
            depth={0.7}
            glow={0.2}
            variation={3}
            // Both cards share one look; skip the rise-in so the card that
            // expands into the hero stays continuous.
            intro={false}
            // Mobile cards are small; 1x keeps the satin smooth and cheap.
            dpr={1}
          />
        </Suspense>
      ) : null}
      {/* Cheap scrim instead of a blur: darkens the middle for the text. */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgb(0_0_0/0.65),rgb(0_0_0/0.15)_80%)]" />
    </div>
  );
}
