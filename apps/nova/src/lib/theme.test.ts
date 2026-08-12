import { beforeEach, describe, expect, it } from "vitest";
import {
  SYSTEM_THEME_ID,
  THEME_OPTIONS,
  applyTheme,
  getStoredTheme,
  initTheme,
  setTheme,
} from "./theme";

describe("lib/theme store (rocketcrab-9fv.7.3)", () => {
  beforeEach(() => {
    document.documentElement.removeAttribute("data-theme");
    window.localStorage.clear();
  });

  it("defaults to the system theme: no data-theme override and nothing stored", () => {
    expect(getStoredTheme()).toBeNull();
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  });

  it("lists the Nova themes plus all 35 default daisyUI themes", () => {
    const ids = THEME_OPTIONS.map((option) => option.id);
    expect(ids).toContain("nova");
    expect(ids).toContain("nova-dark");
    for (const builtin of [
      "light",
      "dark",
      "cupcake",
      "synthwave",
      "dracula",
      "cyberpunk",
      "silk",
    ]) {
      expect(ids).toContain(builtin);
    }
  });

  it("setTheme applies data-theme and persists", () => {
    setTheme("dracula");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dracula");
    expect(window.localStorage.getItem("nova.theme")).toBe("dracula");
  });

  it("setTheme('system') clears the override and the stored value", () => {
    setTheme("dracula");
    setTheme(SYSTEM_THEME_ID);
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
    expect(getStoredTheme()).toBeNull();
  });

  it("setTheme(null) behaves like system", () => {
    setTheme("cupcake");
    setTheme(null);
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
    expect(getStoredTheme()).toBeNull();
  });

  it("getStoredTheme ignores unknown/expired values", () => {
    window.localStorage.setItem("nova.theme", "not-a-theme");
    expect(getStoredTheme()).toBeNull();
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  });

  it("initTheme applies the persisted theme", () => {
    setTheme("nord");
    document.documentElement.removeAttribute("data-theme");
    initTheme();
    expect(document.documentElement.getAttribute("data-theme")).toBe("nord");
  });

  it("applyTheme is idempotent and safe without a document", () => {
    applyTheme("abyss");
    expect(document.documentElement.getAttribute("data-theme")).toBe("abyss");
    applyTheme("abyss");
    expect(document.documentElement.getAttribute("data-theme")).toBe("abyss");
  });
});
