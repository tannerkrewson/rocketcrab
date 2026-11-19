import { lazy, Suspense, useState } from "react";
import { canUseWebGL2, viewportPixelRatio } from "./webgl";

const Silk = lazy(() => import("../../vendor/react-bits/Silk"));

/** The full-page silk renders about this many pixels, like the molten background. */
const PAGE_PIXEL_BUDGET = 300_000;

/** Silk's pattern spans its canvas 0–1 on both axes, so every canvas must share the viewport's shape. */
function viewportAspect(): number {
  if (typeof window === "undefined") return 9 / 16;
  return Math.max(0.3, window.innerWidth / Math.max(1, window.innerHeight));
}

function SilkCanvas({ dpr }: { dpr: number }) {
  return (
    <Suspense fallback={null}>
      <Silk
        color="#132b72"
        sheenColor="#7d9be0"
        speed={3}
        scale={1.1}
        noiseIntensity={0.5}
        sheen={0.3}
        depth={0.7}
        glow={0.2}
        variation={3}
        // The home card expands into the page background; skip the rise-in
        // so the fabric stays continuous across that transition.
        intro={false}
        dpr={dpr}
      />
    </Suspense>
  );
}

/**
 * Deep Nova-blue satin (React Bits "Silk").
 *
 * - `card`: fills a positioned parent (the home page's Nova card). The canvas
 *   is viewport-shaped and centered, the card crops it, so the card is a
 *   window onto the same fabric rather than a squashed copy.
 * - `page`: the full-viewport background on the Nova build and editor pages.
 *
 * A scrim keeps white and `text-nova-text` copy legible over the highlights.
 */
export function NovaSilk({ variant = "card" }: { variant?: "card" | "page" }) {
  const [aspect] = useState(viewportAspect);
  const [pageDpr] = useState(() => viewportPixelRatio(PAGE_PIXEL_BUDGET));
  const webgl = canUseWebGL2();

  if (variant === "page") {
    return (
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[#060b1f]">
        {webgl ? <SilkCanvas dpr={pageDpr} /> : null}
        {/* Darker at the top where the hero text sits, lighter below. */}
        <div className="absolute inset-0 bg-[radial-gradient(90%_55%_at_50%_22%,rgb(0_0_0/0.6),transparent_75%),linear-gradient(180deg,rgb(0_0_0/0.15),rgb(0_0_0/0.45))]" />
      </div>
    );
  }
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[#060b1f]">
      {webgl ? (
        <div
          className="absolute left-1/2 top-1/2 w-full -translate-x-1/2 -translate-y-1/2"
          style={{ aspectRatio: String(aspect) }}
        >
          {/* Most of this canvas is cropped away, so render it at 0.75x. */}
          <SilkCanvas dpr={0.75} />
        </div>
      ) : null}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgb(0_0_0/0.65),rgb(0_0_0/0.15)_80%)]" />
    </div>
  );
}
