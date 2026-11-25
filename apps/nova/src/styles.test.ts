import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import pkg from "../package.json";

/** HeroUI v3 is the only component library (AGENTS.md), loaded after Tailwind. */
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
});
