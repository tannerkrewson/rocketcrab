import { lazy, Suspense, useState } from "react";
import type { PartyEngine } from "../../lib/party/engine";
import { usePartyEngine } from "../../lib/party/use-party";
import { cn } from "../../lib/cn";
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
 * - `nova`: blue molten metal for the Nova build and editor pages.
 * - `party`: plain black, so the lobby's own effect leads. Arriving from a
 *   molten page fades the molten out rather than cutting it.
 */
export type SiteBackgroundVariant = "molten" | "nova" | "party";

function MoltenBackground({ blue }: { blue: boolean }) {
  const [pixelRatio] = useState(() => viewportPixelRatio(PIXEL_BUDGET));
  const [webgl] = useState(canUseWebGL2);
  return (
    <>
      <div className={cn("absolute inset-0", blue ? "rc-molten-blue" : "rc-molten-red")} />
      {webgl ? (
        <Suspense fallback={null}>
          <MoltenMetal
            colors={blue ? ["#081954", "#2d59dc"] : ["#5c0410", "#e3142c"]}
            coreColor={blue ? "#669bff" : "#ff7a4d"}
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
            grain={0}
            // Taps land on buttons and cards; keep the background calm.
            mouseInteraction={false}
            flareOnClick={false}
            dpr={pixelRatio}
          />
        </Suspense>
      ) : null}
    </>
  );
}

/**
 * Blue and red share one Molten Metal canvas, so its pattern continues
 * across navigation. The canvas fades out into a party and unmounts during play.
 */
export function SiteBackground({
  engine,
  variant = "molten",
}: {
  engine?: PartyEngine;
  variant?: SiteBackgroundVariant;
}) {
  const { state } = usePartyEngine(engine);
  const [prevVariant, setPrevVariant] = useState(variant);
  const [leavingVariant, setLeavingVariant] = useState<Exclude<
    SiteBackgroundVariant,
    "party"
  > | null>(null);
  if (variant !== prevVariant) {
    setPrevVariant(variant);
    setLeavingVariant(variant === "party" && prevVariant !== "party" ? prevVariant : null);
  }

  if (state.phase === "playing") {
    return null;
  }
  const palette = variant === "party" ? leavingVariant : variant;
  return (
    <div
      aria-hidden="true"
      data-testid="app-background"
      data-variant={variant}
      className="pointer-events-none fixed inset-0 z-0 bg-black"
    >
      {palette !== null ? (
        <div
          className={`absolute inset-0 ${variant === "party" ? "rc-bg-out" : "rc-bg-in"}`}
          onAnimationEnd={(event) => {
            if (event.target === event.currentTarget && variant === "party") {
              setLeavingVariant(null);
            }
          }}
        >
          <MoltenBackground blue={palette === "nova"} />
        </div>
      ) : null}
    </div>
  );
}
