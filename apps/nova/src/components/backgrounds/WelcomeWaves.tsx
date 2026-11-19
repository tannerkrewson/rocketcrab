import { lazy, Suspense } from "react";
import { canUseWebGL2 } from "./webgl";

const LineWaves = lazy(() => import("../../vendor/react-bits/LineWaves"));

/**
 * Flowing fine lines (React Bits "Line Waves") filling a positioned parent:
 * the lobby's Welcome card. Mostly white with a rocket-red tint; a scrim
 * darkens the middle so the white text reads. Lines bend toward a finger or
 * cursor and ripple on tap (only inside the card).
 */
export function WelcomeWaves() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-black">
      {canUseWebGL2() ? (
        <Suspense fallback={null}>
          <LineWaves
            color1="#ffffff"
            color2="#ff6b4f"
            color3="#ffd2c4"
            colorCycleSpeed={0.6}
            speed={0.2}
            lineCount={48}
            lineWidth={1.2}
            glow={0.5}
            brightness={0.9}
            warpIntensity={0.8}
            rotation={-24}
            edgeFade={0.3}
            intro={false}
            maxDevicePixelRatio={2}
          />
        </Suspense>
      ) : null}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgb(0_0_0/0.6),transparent_80%)]" />
    </div>
  );
}
