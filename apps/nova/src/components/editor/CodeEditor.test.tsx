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

/** Keep the wrapper's fixed-height chain intact so CodeMirror scrolls internally. */
describe("CodeEditor", () => {
  it("renders a CodeMirror editor with an accessible name", () => {
    render(<CodeEditor value="<p>hi</p>" onChange={() => {}} ariaLabel="Game HTML source" />);
    expect(screen.getByLabelText("Game HTML source")).toBeInTheDocument();
  });

  it("gives the CodeMirror wrapper the full height of its parent (scroll fix)", () => {
    render(<CodeEditor value="" onChange={() => {}} ariaLabel="Game HTML source" />);
    const editor = document.querySelector(".cm-editor");
    expect(editor).not.toBeNull();
    expect(editor?.parentElement).toHaveClass("h-full");
  });

  it("maps CodeMirror surfaces to HeroUI variables and follows the app theme", async () => {
    const { unmount } = render(
      <CodeEditor value="" onChange={() => {}} ariaLabel="Game HTML source" />,
    );
    await waitFor(() => expect(document.querySelector(".cm-theme-light")).not.toBeNull());
    const lightStyles = injectedStyles();
    expect(lightStyles).toContain("var(--surface)");
    expect(lightStyles).toContain("var(--foreground)");
    expect(lightStyles).toContain("var(--surface-secondary)");
    unmount();

    for (const darkTheme of ["dark"]) {
      window.localStorage.setItem(THEME_STORAGE_KEY, darkTheme);
      document.documentElement.classList.add("dark");
      document.documentElement.setAttribute("data-theme", darkTheme);
      const { unmount: unmountDark } = render(
        <CodeEditor value="" onChange={() => {}} ariaLabel="Game HTML source" />,
      );
      await waitFor(() => expect(document.querySelector(".cm-theme-dark")).not.toBeNull());
      expect(injectedStyles()).toContain("var(--surface)");
      expect(injectedStyles()).toContain("var(--foreground)");
      expect(injectedStyles()).toContain("var(--surface-secondary)");
      unmountDark();
    }
  });
});
