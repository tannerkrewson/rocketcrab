import { lazy, Suspense, useState } from "react";
import type { PartyEngine } from "../../lib/party/engine";
import { usePartyEngine } from "../../lib/party/use-party";
import { NovaSilk } from "./NovaSilk";
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
 * An orange-hot (never white-hot) core and wide hazy filaments over a warm
 * gradient, with light grain for texture, so the page has depth without
 * bright spots competing with the content. The
 * injected engine is a test seam: the playing phase mounts the full-screen
 * game shell, so the background unmounts and frees the GPU for the game.
 * `nova` swaps in the full-page Nova silk (the /build pages).
 */
export function SiteBackground({ engine, nova = false }: { engine?: PartyEngine; nova?: boolean }) {
  const { state } = usePartyEngine(engine);
  const [pixelRatio] = useState(() => viewportPixelRatio(PIXEL_BUDGET));

  if (state.phase === "playing") {
    return null;
  }
  if (nova) {
    // Nova pages trade the molten metal for full-page silk. It carries the
    // home card's view-transition name, so that card expands into it.
    return (
      <div
        aria-hidden="true"
        data-testid="app-background"
        data-variant="nova"
        className="vt-nova-hero pointer-events-none fixed inset-0 z-0"
      >
        <NovaSilk variant="page" />
      </div>
    );
  }
  return (
    <div
      aria-hidden="true"
      data-testid="app-background"
      className="pointer-events-none fixed inset-0 z-0"
    >
      {/* Static warm gradient under the canvas so the page reads as a deep
          ember glow rather than flat black (and is the fallback without WebGL). */}
      <div className="absolute inset-0 bg-[radial-gradient(120%_70%_at_50%_115%,rgb(120_22_10/0.45),transparent_65%),radial-gradient(80%_55%_at_0%_0%,rgb(70_12_28/0.35),transparent_60%),radial-gradient(70%_50%_at_100%_25%,rgb(90_24_8/0.25),transparent_60%),linear-gradient(180deg,#0b0405,#100505)]" />
      {canUseWebGL2() ? (
        <Suspense fallback={null}>
          <MoltenMetal
            colors={["#4a0a06", "#c42a14"]}
            coreColor="#ff8a5c"
            colorMode="ember"
            speed={0.22}
            scale={4}
            detail={3}
            glow={1.3}
            thickness={1.5}
            haze={0.9}
            brightness={1.05}
            opacity={0.85}
            drift={0.25}
            grain={0.04}
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
