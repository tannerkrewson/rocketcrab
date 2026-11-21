import { lazy, Suspense, useEffect, useRef, useState } from "react";
import type { PartyEngine } from "../../lib/party/engine";
import { usePartyEngine } from "../../lib/party/use-party";
import { canUseWebGL2, viewportPixelRatio } from "./webgl";

// Lazy so the shader code never delays the first paint of the page itself.
const MoltenMetal = lazy(() => import("../../vendor/react-bits/MoltenMetal"));

/**
 * The full-viewport canvas renders about this many pixels (a phone at ~1x).
 * It runs behind most pages, so it is the most expensive effect in the app.
 */
const PIXEL_BUDGET = 300_000;

/**
 * - `molten`: rocketcrab's default.
 * - `nova`: blue molten metal for the Nova build and editor pages.
 */
type SiteBackgroundVariant = "molten" | "nova";

const PALETTE_FADE_MS = 650;
type Rgb = readonly [number, number, number];

function blendColor(from: Rgb, to: Rgb, blend: number): string {
  const mix = (start: number, end: number) => Math.round(start + (end - start) * blend);
  return `rgb(${mix(from[0], to[0])}, ${mix(from[1], to[1])}, ${mix(from[2], to[2])})`;
}

function MoltenBackground({ blue }: { blue: boolean }) {
  const [pixelRatio] = useState(() => viewportPixelRatio(PIXEL_BUDGET));
  const [webgl] = useState(canUseWebGL2);
  const [blend, setBlend] = useState(blue ? 1 : 0);
  const currentBlend = useRef(blend);

  useEffect(() => {
    const from = currentBlend.current;
    const to = blue ? 1 : 0;
    if (from === to) return;

    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    const start = performance.now();
    let frame = requestAnimationFrame(function fade(now) {
      const progress = reducedMotion?.matches
        ? 1
        : Math.min(1, Math.max(0, (now - start) / PALETTE_FADE_MS));
      const eased = progress * progress * (3 - 2 * progress);
      const next = from + (to - from) * eased;
      currentBlend.current = next;
      setBlend(next);
      if (progress < 1) frame = requestAnimationFrame(fade);
    });
    return () => cancelAnimationFrame(frame);
  }, [blue]);

  return (
    <>
      <div className="rc-molten-red absolute inset-0" style={{ opacity: 1 - blend }} />
      <div className="rc-molten-blue absolute inset-0" style={{ opacity: blend }} />
      {webgl ? (
        <Suspense fallback={null}>
          <MoltenMetal
            // Update the palette without restarting the shader's animation.
            colors={[
              blendColor([92, 4, 16], [8, 25, 84], blend),
              blendColor([227, 20, 44], [45, 89, 220], blend),
            ]}
            coreColor={blendColor([255, 122, 77], [102, 155, 255], blend)}
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
 * across navigation. The canvas unmounts during play.
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
      <div className="rc-bg-in absolute inset-0">
        <MoltenBackground blue={variant === "nova"} />
      </div>
    </div>
  );
}
