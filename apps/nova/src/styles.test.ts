import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import pkg from "../package.json";

/** Guards the HeroUI v3 styling contract (simplification stage 6). */
const css = readFileSync(join(process.cwd(), "src/styles.css"), "utf8");

describe("styles.css HeroUI setup", () => {
  it("imports Tailwind before HeroUI and never loads daisyUI", () => {
    const tailwind = css.indexOf('@import "tailwindcss"');
    const heroui = css.indexOf('@import "@heroui/styles"');
    expect(tailwind).toBeGreaterThan(-1);
    expect(heroui).toBeGreaterThan(tailwind);
    expect(css).not.toContain("daisyui");
    expect(css).not.toContain("@plugin");
    expect(pkg.devDependencies).not.toHaveProperty("daisyui");
    expect(pkg.dependencies).toHaveProperty("@heroui/react");
    expect(pkg.dependencies).toHaveProperty("@heroui/styles");
  });

  it("keeps only the Nova brand tokens on top of HeroUI themes", () => {
    expect(css).toContain("--color-primary: oklch(62% 0.21 22)");
    expect(css).toContain("--color-secondary: oklch(58% 0.17 250)");
    expect(css).toContain(".dark {");
    expect(css).toContain("--font-sans");
    expect(css).toContain("--font-title");
  });

  it("keeps the app-specific utilities (safe areas, logo motion, hidden frame)", () => {
    for (const token of [
      "@utility pb-safe",
      "@utility pt-safe",
      "@utility glow-info",
      "@utility text-glow-info",
      "rc-logo-launch",
      '[data-testid="party-frame"].invisible',
    ]) {
      expect(css).toContain(token);
    }
  });
});
