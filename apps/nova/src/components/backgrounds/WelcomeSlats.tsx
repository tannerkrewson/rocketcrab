import { lazy, Suspense } from "react";
import { canUseWebGL2 } from "./webgl";

const MicroSlats = lazy(() => import("../../vendor/react-bits/MicroSlats"));

/**
 * Greyscale rolling slats (React Bits "Micro Slats") filling a positioned
 * parent: the lobby's Welcome card. Dim grey slats with soft grey glints on
 * black keep the white text readable; a scrim darkens the middle further.
 */
export function WelcomeSlats() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0">
      {canUseWebGL2() ? (
        <Suspense fallback={null}>
          <MicroSlats
            preset="tide"
            color="#2e2e2e"
            glintColor="#a3a3a3"
            backgroundColor="#000000"
            slatWidth={8}
            slatHeight={20}
            gap={3}
            // Taps land on the card's buttons; skip the cursor fluid sim.
            interactive={false}
          />
        </Suspense>
      ) : null}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgb(0_0_0/0.7),transparent_85%)]" />
    </div>
  );
}
