import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import pkg from "../package.json";

/** Guard the HeroUI v3 styling contract. */
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

  it("drives HeroUI's accent from the rocket/nova brand tokens", () => {
    expect(css).toContain("--rocket: oklch(");
    expect(css).toContain("--nova: oklch(");
    expect(css).toContain("--accent: var(--rocket)");
    expect(css).toContain("--nova-text: oklch(");
    expect(css).toContain("--color-primary: var(--brand)");
    expect(css).toContain("--color-secondary: var(--nova)");
    expect(css).toContain(".theme-nova {");
    expect(css).toContain("--background: oklch(0% 0 0)");
    expect(css).toContain("--font-sans");
    expect(css).toContain("--font-title");
  });

  it("keeps the app-specific utilities (safe areas, logo motion, Nova transition, hidden frame)", () => {
    for (const token of [
      "@utility pb-safe",
      "@utility pt-safe",
      ".vt-nova-hero",
      "rc-logo-launch",
      '[data-testid="party-frame"].invisible',
    ]) {
      expect(css).toContain(token);
    }
  });
});
