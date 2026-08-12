import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guards the theme contract behind rocketcrab-9fv.7.2:
 *  - a light "nova" theme that is the default, PURE WHITE (no tan), and
 *  - a "nova-dark" theme with classic blacks, wired to prefers-color-scheme
 *    via the daisyUI `prefersdark` flag so the app follows the system by
 *    default, while both themes stay selectable via [data-theme=...] for the
 *    future theme selector (rocketcrab-9fv.7.3).
 */
const styles = readFileSync(join(process.cwd(), "src/styles.css"), "utf8");

function themeBlock(name: string): string {
  const marker = `@plugin "daisyui/theme" {\n  name: "${name}"`;
  const start = styles.indexOf(marker);
  expect(start, `theme block "${name}" must be declared in styles.css`).toBeGreaterThan(-1);
  const end = styles.indexOf("}", start);
  return styles.slice(start, end + 1);
}

describe("styles.css theme setup", () => {
  it("keeps only the custom themes enabled", () => {
    expect(styles).toContain("themes: false");
  });

  it("defines the pure-white light theme as the default", () => {
    const light = themeBlock("nova");
    expect(light).toContain("default: true");
    expect(light).toContain("prefersdark: false");
    expect(light).toContain("color-scheme: light");
    // Pure white background, NOT the tanish off-white it replaced.
    expect(light).toContain("--color-base-100: oklch(100% 0 0)");
    // Neutrals stay achromatic (chroma 0, hue 0) — no tan/cream tint.
    expect(light).toMatch(/--color-base-200: oklch\([0-9.]+% 0 0\)/);
    expect(light).toMatch(/--color-base-300: oklch\([0-9.]+% 0 0\)/);
    // Near-black content on white.
    expect(light).toMatch(/--color-base-content: oklch\((1[0-9]|20)% 0 0\)/);
  });

  it("defines a system-dark theme with classic blacks", () => {
    const dark = themeBlock("nova-dark");
    expect(dark).toContain("default: false");
    expect(dark).toContain("prefersdark: true");
    expect(dark).toContain("color-scheme: dark");
    // Classic blacks: all surfaces below 20% lightness, achromatic.
    for (const token of ["--color-base-100", "--color-base-200", "--color-base-300"]) {
      expect(dark).toMatch(new RegExp(`${token}: oklch\\((1[0-9]|\\d)% 0 0\\)`));
    }
    // Near-white content on black.
    expect(dark).toMatch(/--color-base-content: oklch\((9[0-9]|100)% 0 0\)/);
  });
});
