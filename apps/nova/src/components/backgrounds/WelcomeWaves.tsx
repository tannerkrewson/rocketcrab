import { lazy, Suspense } from "react";
import { canUseWebGL2 } from "./webgl";

const LineWaves = lazy(() => import("../../vendor/react-bits/LineWaves"));

/**
 * Flowing fine lines (React Bits "Line Waves") filling a positioned parent:
 * the lobby's Welcome card. Even, neutral grey lines (no highlight streaks,
 * no color cycling) kept dim enough that the white text always reads. Lines
 * bend toward a finger or cursor and ripple on tap (only inside the card).
 */
export function WelcomeWaves() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0">
      {canUseWebGL2() ? (
        <Suspense fallback={null}>
          <LineWaves
            color1="#ffffff"
            color2="#ffffff"
            color3="#ffffff"
            colorCycleSpeed={0}
            // No moving bright "river": every line is lit the same.
            highlight={0}
            brightness={0.22}
            glow={0.25}
            speed={0.2}
            lineCount={40}
            lineWidth={1}
            warpIntensity={0.7}
            rotation={-24}
            edgeFade={0.6}
            intro={false}
            maxDevicePixelRatio={2}
          />
        </Suspense>
      ) : null}
    </div>
  );
}
