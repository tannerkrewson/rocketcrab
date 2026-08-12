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
      // The wrapper div @uiw/react-codemirror renders (`.cm-theme-*`) has no
      // height of its own, so `.cm-editor`'s height:100% collapses to auto
      // and the editor grows to full content height — clipped by the
      // overflow-hidden panel with no way to scroll (U4 scroll bug). Give the
      // wrapper the full height of its fixed-height parent so the internal
      // `.cm-scroller` actually scrolls.
      className="h-full"
      extensions={[html(), EditorView.contentAttributes.of({ "aria-label": ariaLabel })]}
      onChange={(next) => onChange(next)}
      basicSetup={{ lineNumbers: true, foldGutter: true, autocompletion: true }}
    />
  );
}
