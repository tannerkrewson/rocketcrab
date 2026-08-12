import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CodeEditor } from "./CodeEditor";

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
});
