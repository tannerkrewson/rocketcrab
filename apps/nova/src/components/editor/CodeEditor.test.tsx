import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CodeEditor } from "./CodeEditor";

/** All injected <style> content (CodeMirror injects its theme CSS). */
function injectedStyles(): string {
  return Array.from(document.querySelectorAll("style"))
    .map((style) => style.textContent ?? "")
    .join("\n");
}

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

  it("maps CodeMirror surfaces to HeroUI variables in its dark theme", async () => {
    render(<CodeEditor value="" onChange={() => {}} ariaLabel="Game HTML source" />);
    await waitFor(() => expect(document.querySelector(".cm-theme-dark")).not.toBeNull());
    const styles = injectedStyles();
    expect(styles).toContain("var(--surface)");
    expect(styles).toContain("var(--foreground)");
    expect(styles).toContain("var(--surface-secondary)");
  });
});
