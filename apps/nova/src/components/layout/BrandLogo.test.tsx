import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { BrandLogo } from "./BrandLogo";

const noGlowSvg = readFileSync(join(process.cwd(), "public/rocketcrab-logo-no-glow.svg"), "utf8");

afterEach(() => cleanup());

describe("BrandLogo", () => {
  it("keeps the flat mark's negative-y claw strokes inside its viewport", () => {
    const viewBox = noGlowSvg.match(/viewBox="([^"]+)"/)?.[1];
    expect(viewBox).toBeDefined();
    const [minX, minY, width, height] = viewBox!.split(/\s+/).map(Number) as [
      number,
      number,
      number,
      number,
    ];

    // The claw paths reach above y=0; the old 0 0 128 128 viewport clipped
    // their tops in the Build hero and other tight brand placements.
    expect(minX).toBeLessThanOrEqual(0);
    expect(minY).toBeLessThan(0);
    expect(minX + width).toBeGreaterThanOrEqual(126);
    expect(minY + height).toBeGreaterThanOrEqual(127);
  });

  it("keeps shared marks at 40px while allowing the hero size to stay larger", () => {
    render(
      <>
        <BrandLogo size={40} />
        <BrandLogo size={80} responsive />
      </>,
    );

    const logos = screen.getAllByTestId("brand-logo");
    expect(logos[0]?.querySelector("img")).toHaveStyle({ height: "40px" });
    expect(logos[1]?.querySelector("img")).toHaveAttribute(
      "style",
      expect.stringContaining("height: min(80px, 16vw)"),
    );
  });
});
