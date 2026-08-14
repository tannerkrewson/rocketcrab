import CodeMirror from "@uiw/react-codemirror";
import { html } from "@codemirror/lang-html";
import { EditorView } from "@codemirror/view";
import { useIsDarkTheme } from "../../lib/use-is-dark-theme";

export interface CodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  ariaLabel: string;
}

/**
 * EditorView.theme mapping CodeMirror surfaces to daisyUI CSS variables so
 * the editor blends with whichever of the app's themes is active: the root
 * uses the page background/text, and gutters + the active line use the
 * slightly-lighter base-200 surface. The variables live on `:root` under
 * `data-theme`, so the editor re-themes automatically on theme switch —
 * no extra state. The dark variant passes `{ dark: true }` so CodeMirror's
 * base contrast (selection, cursor, syntax defaults) flips too.
 */
const themeSpec = {
  "&": {
    backgroundColor: "var(--color-base-100)",
    color: "var(--color-base-content)",
  },
  ".cm-gutters": {
    backgroundColor: "var(--color-base-200)",
  },
  ".cm-activeLine": {
    backgroundColor: "var(--color-base-200)",
  },
};

const lightTheme = EditorView.theme(themeSpec);
const darkTheme = EditorView.theme(themeSpec, { dark: true });

/**
 * CodeMirror 6 HTML editor via the maintained React integration
 * (engineering rule 12: no custom editor). The contenteditable carries an
 * accessible name so tests and screen readers can target it. The built-in
 * `theme` prop flips CodeMirror's base contrast (selection, cursor, syntax
 * defaults) to match the effective app theme (Task 4).
 */
export function CodeEditor({ value, onChange, ariaLabel }: CodeEditorProps) {
  const isDark = useIsDarkTheme();
  return (
    <CodeMirror
      value={value}
      height="100%"
      // The wrapper div @uiw/react-codemirror renders (`.cm-theme-*`) has no
      // height of its own, so `.cm-editor`'s height:100% collapses to auto
      // and the editor grows to full content height — clipped by the
      // overflow-hidden panel with no way to scroll (U4 scroll bug). Give the
      // wrapper the full height of its fixed-height parent so the internal
      // `.cm-scroller` actually scrolls.
      className="h-full"
      theme={isDark ? "dark" : "light"}
      extensions={[
        html(),
        isDark ? darkTheme : lightTheme,
        EditorView.contentAttributes.of({ "aria-label": ariaLabel }),
      ]}
      onChange={(next) => onChange(next)}
      basicSetup={{ lineNumbers: true, foldGutter: true, autocompletion: true }}
    />
  );
}
