import CodeMirror from "@uiw/react-codemirror";
import { html } from "@codemirror/lang-html";
import { EditorView } from "@codemirror/view";

export interface CodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  ariaLabel: string;
}

/**
 * CodeMirror 6 HTML editor via the maintained React integration
 * (engineering rule 12: no custom editor). The contenteditable carries an
 * accessible name so tests and screen readers can target it.
 */
export function CodeEditor({ value, onChange, ariaLabel }: CodeEditorProps) {
  return (
    <CodeMirror
      value={value}
      height="100%"
      extensions={[html(), EditorView.contentAttributes.of({ "aria-label": ariaLabel })]}
      onChange={(next) => onChange(next)}
      basicSetup={{ lineNumbers: true, foldGutter: true, autocompletion: true }}
    />
  );
}
