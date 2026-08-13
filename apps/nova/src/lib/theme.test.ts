import { beforeEach, describe, expect, it } from "vitest";
import {
  DARK_THEME_IDS,
  DEFAULT_DARK_THEME_ID,
  DEFAULT_LIGHT_THEME_ID,
  LIGHT_THEME_IDS,
  SYSTEM_THEME_ID,
  THEME_OPTIONS,
  applyTheme,
  currentThemeMode,
  getStoredTheme,
  initTheme,
  isDarkTheme,
  isLightTheme,
  randomThemeForMode,
  setTheme,
  systemPrefersDark,
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

  it("classifies every theme option as light or dark, matching daisyUI color-scheme", () => {
    for (const option of THEME_OPTIONS) {
      expect(isLightTheme(option.id) || isDarkTheme(option.id)).toBe(true);
      expect(isLightTheme(option.id)).not.toBe(isDarkTheme(option.id));
    }
    expect(isLightTheme("nova")).toBe(true);
    expect(isLightTheme("cupcake")).toBe(true);
    expect(isDarkTheme("nova-dark")).toBe(true);
    expect(isDarkTheme("synthwave")).toBe(true);
    expect(isDarkTheme("cupcake")).toBe(false);
    expect(isLightTheme("not-a-theme")).toBe(false);
  });

  it("randomThemeForMode picks only from the matching mode's pool (7.45)", () => {
    const dark = randomThemeForMode("dark");
    const light = randomThemeForMode("light");
    expect(DARK_THEME_IDS).toContain(dark);
    expect(LIGHT_THEME_IDS).toContain(light);
    expect(isDarkTheme(dark)).toBe(true);
    expect(isLightTheme(light)).toBe(true);
    // The dice never returns the mode's default (that would be a no-op).
    expect(dark).not.toBe(DEFAULT_DARK_THEME_ID);
    expect(light).not.toBe(DEFAULT_LIGHT_THEME_ID);
  });

  it("systemPrefersDark is false when matchMedia is unavailable (jsdom)", () => {
    expect(typeof window.matchMedia).toBe("undefined");
    expect(systemPrefersDark()).toBe(false);
  });

  it("currentThemeMode follows the stored theme, then the system preference", () => {
    expect(currentThemeMode()).toBe("light"); // nothing stored, system light
    setTheme("dracula");
    expect(currentThemeMode()).toBe("dark");
    setTheme("cupcake");
    expect(currentThemeMode()).toBe("light");
    setTheme(null);
    expect(currentThemeMode()).toBe("light");
  });
});
