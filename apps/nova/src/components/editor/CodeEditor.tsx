import CodeMirror from "@uiw/react-codemirror";
import { html } from "@codemirror/lang-html";
import { EditorView } from "@codemirror/view";
import { useIsDarkTheme } from "../../lib/use-is-dark-theme";

export interface CodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  ariaLabel: string;
}

/** Use HeroUI variables for surfaces; dark: true also flips CodeMirror's base contrast. */
const themeSpec = {
  "&": {
    backgroundColor: "var(--surface)",
    color: "var(--foreground)",
  },
  ".cm-gutters": {
    backgroundColor: "var(--surface-secondary)",
  },
  ".cm-activeLine": {
    backgroundColor: "var(--surface-secondary)",
  },
};

const lightTheme = EditorView.theme(themeSpec);
const darkTheme = EditorView.theme(themeSpec, { dark: true });

export function CodeEditor({ value, onChange, ariaLabel }: CodeEditorProps) {
  const isDark = useIsDarkTheme();
  return (
    <CodeMirror
      value={value}
      height="100%"
      // The wrapper needs a definite height for CodeMirror's internal scroller.
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
