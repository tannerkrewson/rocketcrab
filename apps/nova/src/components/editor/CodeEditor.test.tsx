import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CodeEditor } from "./CodeEditor";
import { THEME_STORAGE_KEY } from "../../lib/theme";

/** All injected <style> content (CodeMirror injects its theme CSS). */
function injectedStyles(): string {
  return Array.from(document.querySelectorAll("style"))
    .map((style) => style.textContent ?? "")
    .join("\n");
}

afterEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
});

/**
 * CodeEditor regression guard (Phase 7.8): @uiw/react-codemirror's wrapper
 * div (`.cm-theme-*`) has no height of its own, so `.cm-editor`'s
 * height:100% collapses to auto and the editor grows to full content height
 * — clipped by the overflow-hidden panel with no way to scroll. The `h-full`
 * class on the wrapper restores the fixed-height chain so the internal
 * `.cm-scroller` scrolls. Assert the class stays applied.
 */
describe("CodeEditor", () => {
  it("renders a CodeMirror editor with an accessible name", () => {
    render(<CodeEditor value="<p>hi</p>" onChange={() => {}} ariaLabel="Game HTML source" />);
    expect(screen.getByLabelText("Game HTML source")).toBeInTheDocument();
  });

  it("gives the CodeMirror wrapper the full height of its parent (scroll fix)", () => {
    render(<CodeEditor value="" onChange={() => {}} ariaLabel="Game HTML source" />);
    const editor = document.querySelector(".cm-editor");
    expect(editor).not.toBeNull();
    // The wrapper div around `.cm-editor` must carry `h-full` so the
    // editor's height:100% resolves against a definite parent height and the
    // scroller can overflow internally instead of being clipped.
    expect(editor?.parentElement).toHaveClass("h-full");
  });

  it("maps CodeMirror surfaces to daisyUI variables and follows the app theme (Task 4)", async () => {
    // Light default (no stored theme, jsdom has no dark preference).
    const { unmount } = render(
      <CodeEditor value="" onChange={() => {}} ariaLabel="Game HTML source" />,
    );
    await waitFor(() => expect(document.querySelector(".cm-theme-light")).not.toBeNull());
    const lightStyles = injectedStyles();
    expect(lightStyles).toContain("var(--color-base-100)");
    expect(lightStyles).toContain("var(--color-base-content)");
    expect(lightStyles).toContain("var(--color-base-200)");
    unmount();

    // Dark themes (daisyUI dark/dim/night/dracula + nova-dark): the editor
    // switches to the dark base and the same CSS-variable mapping applies.
    for (const darkTheme of ["dark", "dim", "night", "dracula", "nova-dark"]) {
      window.localStorage.setItem(THEME_STORAGE_KEY, darkTheme);
      document.documentElement.setAttribute("data-theme", darkTheme);
      const { unmount: unmountDark } = render(
        <CodeEditor value="" onChange={() => {}} ariaLabel="Game HTML source" />,
      );
      await waitFor(() => expect(document.querySelector(".cm-theme-dark")).not.toBeNull());
      expect(injectedStyles()).toContain("var(--color-base-100)");
      expect(injectedStyles()).toContain("var(--color-base-content)");
      expect(injectedStyles()).toContain("var(--color-base-200)");
      unmountDark();
    }
  });
});
