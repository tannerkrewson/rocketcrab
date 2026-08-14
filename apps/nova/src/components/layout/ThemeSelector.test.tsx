import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DARK_THEME_IDS,
  DEFAULT_DARK_THEME_ID,
  DEFAULT_LIGHT_THEME_ID,
  LIGHT_THEME_IDS,
  isDarkTheme,
  isLightTheme,
} from "../../lib/theme";
import { ThemeSelector } from "./ThemeSelector";

/** jsdom has no matchMedia; stub it so systemPrefersDark() is testable. */
function mockSystemDark(dark: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: dark,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}

describe("ThemeSelector (rocketcrab-9fv.7.45)", () => {
  beforeEach(() => {
    document.documentElement.removeAttribute("data-theme");
    window.localStorage.clear();
    vi.restoreAllMocks();
    mockSystemDark(false);
  });

  it("defaults to light (system) with no stored theme and no override applied", () => {
    render(<ThemeSelector />);
    expect(screen.getByRole("button", { name: "Light theme" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Dark theme" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  });

  it("is icon-only with no visible Light/Dark labels (7.47)", () => {
    render(<ThemeSelector />);
    expect(screen.queryByText("Light")).not.toBeInTheDocument();
    expect(screen.queryByText("Dark")).not.toBeInTheDocument();
    // The controls stay keyboard- and screen-reader accessible via labels.
    expect(screen.getByRole("button", { name: "Light theme" })).toHaveAttribute(
      "title",
      "Light theme",
    );
    expect(screen.getByRole("button", { name: "Dark theme" })).toHaveAttribute(
      "title",
      "Dark theme",
    );
    expect(screen.getByRole("button", { name: "Random theme" })).toBeInTheDocument();
  });

  it("defaults to dark when the system prefers dark and nothing is stored", () => {
    mockSystemDark(true);
    render(<ThemeSelector />);
    expect(screen.getByRole("button", { name: "Dark theme" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("applies and persists Nova's dark theme when Dark is picked", () => {
    render(<ThemeSelector />);
    fireEvent.click(screen.getByRole("button", { name: "Dark theme" }));
    expect(document.documentElement.getAttribute("data-theme")).toBe(DEFAULT_DARK_THEME_ID);
    expect(window.localStorage.getItem("nova.theme")).toBe(DEFAULT_DARK_THEME_ID);
  });

  it("applies and persists Nova's light theme when Light is picked", () => {
    window.localStorage.setItem("nova.theme", "dracula");
    render(<ThemeSelector />);
    fireEvent.click(screen.getByRole("button", { name: "Light theme" }));
    expect(document.documentElement.getAttribute("data-theme")).toBe(DEFAULT_LIGHT_THEME_ID);
    expect(window.localStorage.getItem("nova.theme")).toBe(DEFAULT_LIGHT_THEME_ID);
  });

  it("rolls a random light theme matching the light mode and persists it", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    render(<ThemeSelector />);
    fireEvent.click(screen.getByRole("button", { name: "Random theme" }));
    const applied = document.documentElement.getAttribute("data-theme");
    expect(applied).not.toBeNull();
    expect(applied).toBe(window.localStorage.getItem("nova.theme"));
    expect(isLightTheme(applied ?? "")).toBe(true);
    expect(applied).not.toBe(DEFAULT_LIGHT_THEME_ID);
    expect(LIGHT_THEME_IDS).toContain(applied);
  });

  it("rolls a random dark theme matching the dark mode and persists it", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    render(<ThemeSelector />);
    fireEvent.click(screen.getByRole("button", { name: "Dark theme" }));
    fireEvent.click(screen.getByRole("button", { name: "Random theme" }));
    const applied = document.documentElement.getAttribute("data-theme");
    expect(applied).not.toBeNull();
    expect(applied).toBe(window.localStorage.getItem("nova.theme"));
    expect(isDarkTheme(applied ?? "")).toBe(true);
    expect(applied).not.toBe(DEFAULT_DARK_THEME_ID);
    expect(DARK_THEME_IDS).toContain(applied);
  });

  it("reflects a persisted random theme on mount", () => {
    window.localStorage.setItem("nova.theme", "synthwave");
    render(<ThemeSelector />);
    expect(screen.getByRole("button", { name: "Dark theme" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(document.documentElement.getAttribute("data-theme")).toBe("synthwave");
  });
});
