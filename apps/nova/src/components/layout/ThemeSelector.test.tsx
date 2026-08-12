import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { SYSTEM_THEME_ID, THEME_OPTIONS } from "../../lib/theme";
import { ThemeSelector } from "./ThemeSelector";

describe("ThemeSelector (rocketcrab-9fv.7.3)", () => {
  beforeEach(() => {
    document.documentElement.removeAttribute("data-theme");
    window.localStorage.clear();
  });

  it("defaults to System when nothing is stored", () => {
    render(<ThemeSelector />);
    expect(screen.getByLabelText("Theme")).toHaveValue(SYSTEM_THEME_ID);
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  });

  it("lists the system option and every theme option", () => {
    render(<ThemeSelector />);
    const select = screen.getByLabelText("Theme") as HTMLSelectElement;
    const options = Array.from(select.options).map((option) => option.value);
    expect(options[0]).toBe(SYSTEM_THEME_ID);
    for (const option of THEME_OPTIONS) {
      expect(options).toContain(option.id);
    }
  });

  it("applies and persists the picked theme immediately", () => {
    render(<ThemeSelector />);
    fireEvent.change(screen.getByLabelText("Theme"), { target: { value: "synthwave" } });
    expect(document.documentElement.getAttribute("data-theme")).toBe("synthwave");
    expect(window.localStorage.getItem("nova.theme")).toBe("synthwave");
  });

  it("restores system behavior when System is picked", () => {
    render(<ThemeSelector />);
    fireEvent.change(screen.getByLabelText("Theme"), { target: { value: "retro" } });
    fireEvent.change(screen.getByLabelText("Theme"), { target: { value: SYSTEM_THEME_ID } });
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
    expect(window.localStorage.getItem("nova.theme")).toBeNull();
  });

  it("reflects a persisted theme on mount", () => {
    window.localStorage.setItem("nova.theme", "emerald");
    render(<ThemeSelector />);
    expect(screen.getByLabelText("Theme")).toHaveValue("emerald");
    expect(document.documentElement.getAttribute("data-theme")).toBe("emerald");
  });
});
