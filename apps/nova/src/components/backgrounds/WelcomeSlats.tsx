import { lazy, Suspense } from "react";
import { canUseWebGL2 } from "./webgl";

const MicroSlats = lazy(() => import("../../vendor/react-bits/MicroSlats"));

/**
 * Greyscale rolling slats (React Bits "Micro Slats") filling a positioned
 * parent: the lobby's Welcome card. Mid-grey slats with soft glints on black,
 * stirred by touch; a scrim darkens the middle so the white text reads.
 */
export function WelcomeSlats() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0">
      {canUseWebGL2() ? (
        <Suspense fallback={null}>
          <MicroSlats
            preset="tide"
            color="#575757"
            glintColor="#c4c4c4"
            backgroundColor="#000000"
            slatWidth={8}
            slatHeight={20}
            gap={3}
            // Low contrast and no fog keep every slat lit: dim troughs used
            // to fade slats to transparent, leaving pure-black holes.
            contrast={0.35}
            fog={0}
            // Touch and drag stir the slats (listeners are on window, so the
            // card's buttons still get their taps).
            interactive
            cursorSize={50}
            intro={false}
          />
        </Suspense>
      ) : null}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgb(0_0_0/0.7),transparent_85%)]" />
    </div>
  );
}
