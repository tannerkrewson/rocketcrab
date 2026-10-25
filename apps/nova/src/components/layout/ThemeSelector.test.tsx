import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
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

describe("ThemeSelector (HeroUI light/dark/system)", () => {
  beforeEach(() => {
    document.documentElement.classList.remove("dark");
    document.documentElement.removeAttribute("data-theme");
    window.localStorage.clear();
    vi.restoreAllMocks();
    mockSystemDark(false);
  });

  it("shows three accessible icon-only controls", () => {
    render(<ThemeSelector />);
    for (const name of ["Light theme", "Dark theme", "System theme"]) {
      expect(screen.getByRole("button", { name })).toHaveAttribute("aria-pressed");
    }
  });

  it("marks the system option as pressed by default", () => {
    render(<ThemeSelector />);
    expect(screen.getByRole("button", { name: "System theme" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("applies and persists dark mode", () => {
    render(<ThemeSelector />);
    fireEvent.click(screen.getByRole("button", { name: "Dark theme" }));
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(window.localStorage.getItem("nova.theme")).toBe("dark");
  });

  it("applies and persists light mode", () => {
    window.localStorage.setItem("nova.theme", "dark");
    render(<ThemeSelector />);
    fireEvent.click(screen.getByRole("button", { name: "Light theme" }));
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(window.localStorage.getItem("nova.theme")).toBe("light");
  });

  it("system removes the stored override", () => {
    window.localStorage.setItem("nova.theme", "dark");
    render(<ThemeSelector />);
    fireEvent.click(screen.getByRole("button", { name: "System theme" }));
    expect(window.localStorage.getItem("nova.theme")).toBeNull();
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("reflects a persisted dark preference on mount", () => {
    window.localStorage.setItem("nova.theme", "dark");
    render(<ThemeSelector />);
    expect(screen.getByRole("button", { name: "Dark theme" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });
});
