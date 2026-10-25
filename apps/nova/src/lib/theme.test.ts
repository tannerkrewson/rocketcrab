import { beforeEach, describe, expect, it } from "vitest";
import {
  applyTheme,
  getStoredTheme,
  initTheme,
  resolvedTheme,
  setTheme,
  systemPrefersDark,
} from "./theme";

describe("lib/theme store (HeroUI light/dark/system)", () => {
  beforeEach(() => {
    document.documentElement.classList.remove("dark");
    document.documentElement.removeAttribute("data-theme");
    window.localStorage.clear();
  });

  it("defaults to the system preference with nothing stored", () => {
    expect(getStoredTheme()).toBe("system");
    expect(resolvedTheme()).toBe("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("applies and persists an explicit mode", () => {
    setTheme("dark");
    expect(getStoredTheme()).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.dataset.theme).toBe("dark");
    setTheme("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("system clears the stored preference and resolves the OS mode", () => {
    setTheme("dark");
    setTheme("system");
    expect(getStoredTheme()).toBe("system");
    expect(window.localStorage.getItem("nova.theme")).toBeNull();
    expect(resolvedTheme()).toBe("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("ignores unknown stored values", () => {
    window.localStorage.setItem("nova.theme", "dracula");
    expect(getStoredTheme()).toBe("system");
  });

  it("initTheme applies the persisted mode", () => {
    setTheme("dark");
    document.documentElement.classList.remove("dark");
    initTheme();
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("applyTheme is idempotent and safe without a document", () => {
    applyTheme("dark");
    applyTheme("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("systemPrefersDark is false when matchMedia is unavailable (jsdom)", () => {
    expect(typeof window.matchMedia).toBe("undefined");
    expect(systemPrefersDark()).toBe(false);
  });
});
