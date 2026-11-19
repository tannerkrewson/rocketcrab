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
 * - `molten`: rocketcrab's default.
 * - `nova`: deep-blue silk for the Nova build and editor pages.
 * - `party`: plain black, so the lobby's own effect is the only motion.
 */
export type SiteBackgroundVariant = "molten" | "nova" | "party";

function MoltenBackground() {
  const [pixelRatio] = useState(() => viewportPixelRatio(PIXEL_BUDGET));
  return (
    <>
      {canUseWebGL2() ? (
        <Suspense fallback={null}>
          <MoltenMetal
            // Saturated reds with an orange core that never reaches white,
            // on true black: rich color without bright hot spots or a hazy
            // red wash.
            colors={["#5a0a06", "#e0281b"]}
            coreColor="#ff8a52"
            colorMode="molten"
            // Fine, slow-moving filaments: texture, not motion that competes
            // with the UI.
            speed={0.15}
            drift={0.15}
            scale={4}
            detail={3}
            glow={1.5}
            haze={0.75}
            brightness={1.15}
            opacity={1}
            grain={0}
            // Taps land on buttons and cards; keep the background calm.
            mouseInteraction={false}
            flareOnClick={false}
            dpr={pixelRatio}
          />
        </Suspense>
      ) : null}
      {/* Darken where the content sits so the glow frames the page rather
          than running behind the text. */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_70%_60%_at_50%_45%,rgb(0_0_0/0.55),transparent_75%)]" />
    </>
  );
}

/**
 * Site-wide decorative background (React Bits "Molten Metal" / "Silk").
 * Switching variants dips through black and fades the new one in. The
 * injected engine is a test seam: the playing phase mounts the full-screen
 * game shell, so the background unmounts and frees the GPU for the game.
 */
export function SiteBackground({
  engine,
  variant = "molten",
}: {
  engine?: PartyEngine;
  variant?: SiteBackgroundVariant;
}) {
  const { state } = usePartyEngine(engine);

  if (state.phase === "playing") {
    return null;
  }
  return (
    <div
      aria-hidden="true"
      data-testid="app-background"
      data-variant={variant}
      className="pointer-events-none fixed inset-0 z-0 bg-black"
    >
      {/* Keyed by variant: a change remounts the layer, which fades in. */}
      <div key={variant} className="rc-bg-in absolute inset-0">
        {variant === "molten" ? <MoltenBackground /> : null}
        {variant === "nova" ? <NovaSilk variant="page" /> : null}
      </div>
    </div>
  );
}
