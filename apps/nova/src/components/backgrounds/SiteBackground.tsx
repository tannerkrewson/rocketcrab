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
 * - `party`: the molten, dimmed, so the lobby's own effect leads.
 */
export type SiteBackgroundVariant = "molten" | "nova" | "party";

function MoltenBackground({ dim = false }: { dim?: boolean }) {
  const [pixelRatio] = useState(() => viewportPixelRatio(PIXEL_BUDGET));
  return (
    <>
      {/* A deep, saturated crimson glow under the canvas (rising from the
          bottom, faint at the top) so the page has depth rather than flat
          black. Kept crimson, not brown, so it never reads as a wash. */}
      <div className="absolute inset-0 bg-[radial-gradient(140%_80%_at_50%_115%,#4a0410_0%,#1c0106_45%,transparent_75%),radial-gradient(120%_60%_at_50%_-15%,#2a0309_0%,transparent_60%)]" />
      {canUseWebGL2() ? (
        <Suspense fallback={null}>
          <MoltenMetal
            // Crimson filaments with an orange core that never reaches white.
            colors={["#5c0410", "#e3142c"]}
            coreColor="#ff7a4d"
            colorMode="molten"
            // Fine, slow-moving filaments with a soft glow that fills the
            // page: texture, not motion that competes with the UI.
            speed={0.15}
            drift={0.15}
            scale={4.5}
            detail={3}
            thickness={1.3}
            glow={1.9}
            haze={0.9}
            brightness={1.15}
            opacity={dim ? 0.45 : 1}
            grain={0}
            // Taps land on buttons and cards; keep the background calm.
            mouseInteraction={false}
            flareOnClick={false}
            dpr={pixelRatio}
          />
        </Suspense>
      ) : null}
      {dim ? <div className="absolute inset-0 bg-black/45" /> : null}
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
        {variant === "party" ? <MoltenBackground dim /> : null}
        {variant === "nova" ? <NovaSilk variant="page" /> : null}
      </div>
    </div>
  );
}
