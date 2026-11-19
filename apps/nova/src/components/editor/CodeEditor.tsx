import CodeMirror from "@uiw/react-codemirror";
import { html } from "@codemirror/lang-html";
import { EditorView } from "@codemirror/view";

export interface CodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  ariaLabel: string;
}

/** Use HeroUI variables for surfaces; dark: true also sets CodeMirror's base contrast. */
const themeSpec = {
  // Opaque (overlay) rather than glass: code stays legible over the background.
  "&": {
    backgroundColor: "var(--overlay)",
    color: "var(--foreground)",
  },
  ".cm-gutters": {
    backgroundColor: "var(--surface-secondary)",
  },
  ".cm-activeLine": {
    backgroundColor: "var(--surface-secondary)",
  },
};

// The app is dark-only (index.html sets `.dark` on <html>).
const darkTheme = EditorView.theme(themeSpec, { dark: true });

export function CodeEditor({ value, onChange, ariaLabel }: CodeEditorProps) {
  return (
    <CodeMirror
      value={value}
      height="100%"
      // The wrapper needs a definite height for CodeMirror's internal scroller.
      className="h-full"
      theme="dark"
      extensions={[html(), darkTheme, EditorView.contentAttributes.of({ "aria-label": ariaLabel })]}
      onChange={(next) => onChange(next)}
      basicSetup={{ lineNumbers: true, foldGutter: true, autocompletion: true }}
    />
  );
}
