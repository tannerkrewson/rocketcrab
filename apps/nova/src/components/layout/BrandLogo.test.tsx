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

    // Claw paths extend above y=0; the viewport must include their tops.
    expect(minX).toBeLessThanOrEqual(0);
    expect(minY).toBeLessThan(0);
    expect(minX + width).toBeGreaterThanOrEqual(126);
    expect(minY + height).toBeGreaterThanOrEqual(127);
  });

  it("renders both color palettes at the same size", () => {
    render(
      <>
        <BrandLogo />
        <BrandLogo nova />
      </>,
    );

    const [red, blue] = screen.getAllByTestId("brand-logo");
    expect(red).toHaveAttribute("src", "/rocketcrab-logo-no-glow.svg");
    expect(blue).toHaveAttribute("src", "/rocketcrab-logo-nova.svg");
    for (const logo of [red, blue]) {
      expect(logo).toHaveAttribute("height", "56");
      expect(logo).toHaveAttribute("width", "56");
    }
  });
});
