import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { THEME_STORAGE_KEY } from "./theme";
import { useIsDarkTheme } from "./use-is-dark-theme";

/** The dark-code-editor switch follows the effective app mode. */
describe("useIsDarkTheme", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.classList.remove("dark");
    document.documentElement.removeAttribute("data-theme");
  });

  it("starts light by default (jsdom has no dark preference)", () => {
    const { result } = renderHook(() => useIsDarkTheme());
    expect(result.current).toBe(false);
  });

  it("follows a persisted dark preference", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "dark");
    document.documentElement.classList.add("dark");
    const { result } = renderHook(() => useIsDarkTheme());
    expect(result.current).toBe(true);
  });

  it("follows a persisted light preference", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "light");
    const { result } = renderHook(() => useIsDarkTheme());
    expect(result.current).toBe(false);
  });

  it("flips live when the theme control changes the root class", async () => {
    const { result } = renderHook(() => useIsDarkTheme());
    expect(result.current).toBe(false);

    act(() => {
      window.localStorage.setItem(THEME_STORAGE_KEY, "dark");
      document.documentElement.classList.add("dark");
      document.documentElement.setAttribute("data-theme", "dark");
    });
    await waitFor(() => expect(result.current).toBe(true));

    act(() => {
      window.localStorage.setItem(THEME_STORAGE_KEY, "light");
      document.documentElement.classList.remove("dark");
      document.documentElement.setAttribute("data-theme", "light");
    });
    await waitFor(() => expect(result.current).toBe(false));
  });

  it("stops observing after unmount", async () => {
    const { result, unmount } = renderHook(() => useIsDarkTheme());
    unmount();
    act(() => {
      document.documentElement.classList.add("dark");
      document.documentElement.setAttribute("data-theme", "dark");
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(result.current).toBe(false);
  });
});
