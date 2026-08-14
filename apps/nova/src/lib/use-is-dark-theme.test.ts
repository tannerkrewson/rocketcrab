import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { THEME_STORAGE_KEY } from "./theme";
import { useIsDarkTheme } from "./use-is-dark-theme";

/**
 * useIsDarkTheme (Task 4): the dark-code-editor switch must follow the
 * effective app theme — the persisted theme's mode, or the OS preference —
 * and stay live when the footer theme picker flips `data-theme` on <html>
 * without a reload.
 */
describe("useIsDarkTheme", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
  });

  it("starts light by default (jsdom has no dark preference)", () => {
    const { result } = renderHook(() => useIsDarkTheme());
    expect(result.current).toBe(false);
  });

  it("follows a persisted dark theme", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "night");
    const { result } = renderHook(() => useIsDarkTheme());
    expect(result.current).toBe(true);
  });

  it("follows a persisted light theme", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "nova");
    const { result } = renderHook(() => useIsDarkTheme());
    expect(result.current).toBe(false);
  });

  it("flips live when the theme picker changes data-theme (dark, dim, night, dracula)", async () => {
    const { result } = renderHook(() => useIsDarkTheme());
    expect(result.current).toBe(false);

    // The picker persists the choice AND sets the attribute; the
    // MutationObserver on data-theme is what re-evaluates the hook.
    for (const darkTheme of ["dark", "dim", "night", "dracula"]) {
      act(() => {
        window.localStorage.setItem(THEME_STORAGE_KEY, darkTheme);
        document.documentElement.setAttribute("data-theme", darkTheme);
      });
      await waitFor(() => expect(result.current).toBe(true));
    }

    act(() => {
      window.localStorage.setItem(THEME_STORAGE_KEY, "nova");
      document.documentElement.setAttribute("data-theme", "nova");
    });
    await waitFor(() => expect(result.current).toBe(false));
  });

  it("stops observing after unmount", async () => {
    const { result, unmount } = renderHook(() => useIsDarkTheme());
    unmount();
    act(() => {
      document.documentElement.setAttribute("data-theme", "dracula");
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(result.current).toBe(false);
  });
});
