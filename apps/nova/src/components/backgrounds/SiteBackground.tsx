import { lazy, Suspense, useState } from "react";
import type { PartyEngine } from "../../lib/party/engine";
import { usePartyEngine } from "../../lib/party/use-party";
import { canUseWebGL2, viewportPixelRatio } from "./webgl";

// Lazy so the shader code never delays the first paint of the page itself.
const MoltenMetal = lazy(() => import("../../vendor/react-bits/MoltenMetal"));

/**
 * The full-viewport canvas renders about this many pixels (a phone at ~1x).
 * It runs behind every page, so it is the most expensive effect in the app.
 */
const PIXEL_BUDGET = 300_000;

/**
 * Site-wide decorative background (React Bits "Molten Metal") in rocket red.
 * Tuned low-contrast: a red-hot (not white-hot) core, wide hazy filaments
 * and reduced brightness, so no bright spots compete with the page. The
 * injected engine is a test seam: the playing phase mounts the full-screen
 * game shell, so the background unmounts and frees the GPU for the game.
 */
export function SiteBackground({ engine }: { engine?: PartyEngine }) {
  const { state } = usePartyEngine(engine);
  const [pixelRatio] = useState(() => viewportPixelRatio(PIXEL_BUDGET));

  if (state.phase === "playing") {
    return null;
  }
  return (
    <div
      aria-hidden="true"
      data-testid="app-background"
      className="pointer-events-none fixed inset-0 z-0"
    >
      {canUseWebGL2() ? (
        <Suspense fallback={null}>
          <MoltenMetal
            colors={["#3d0805", "#a3200f"]}
            coreColor="#c73a24"
            colorMode="ember"
            speed={0.22}
            scale={4}
            detail={3}
            glow={1}
            thickness={1.6}
            haze={1}
            brightness={0.85}
            opacity={0.7}
            drift={0.25}
            grain={0}
            // Taps land on buttons and cards; keep the background calm.
            mouseInteraction={false}
            flareOnClick={false}
            dpr={pixelRatio}
          />
        </Suspense>
      ) : null}
    </div>
  );
}
