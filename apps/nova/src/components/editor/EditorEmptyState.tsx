import { Check, ClipboardCopy, ClipboardPaste, FileUp, ScrollText } from "lucide-react";
import { useMemo, useState } from "react";
import { writeToClipboard } from "../../lib/editor/clipboard";
import { buildMasterPrompt } from "../../lib/prompt/master-prompt";
import { toast } from "../../lib/toast";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";

export function EditorEmptyState({
  onPaste,
  onUpload,
}: {
  onPaste: () => void;
  onUpload: () => void;
}) {
  const prompt = useMemo(() => buildMasterPrompt(), []);
  const [copied, setCopied] = useState(false);

  const copyPrompt = async () => {
    if (await writeToClipboard(prompt)) {
      setCopied(true);
    } else {
      toast.danger("Couldn't copy the prompt. Open the full prompt to copy it manually.");
    }
  };

  return (
    <div className="mx-auto w-full max-w-2xl" data-testid="editor-empty-state">
      <Card className="border border-border p-5 sm:p-8">
        <section aria-labelledby="editor-prompt-heading" className="flex flex-col gap-3">
          <div>
            <h2 id="editor-prompt-heading" className="text-2xl font-black">
              Make a game with AI
            </h2>
            <p className="text-foreground/70">
              Use the Nova prompt to turn your idea into a playable game.
            </p>
          </div>
          <div>
            <Button size="lg" onPress={() => void copyPrompt()}>
              <ClipboardCopy className="h-5 w-5" aria-hidden="true" />
              {copied ? "Copy again" : "Copy prompt"}
            </Button>
            <div role="status">
              {copied ? (
                <p className="mt-3 text-sm text-foreground/80">
                  <strong className="mr-1.5 inline-flex items-center gap-1.5 text-foreground">
                    <Check className="h-4 w-4 text-success" aria-hidden="true" />
                    Prompt copied.
                  </strong>
                  Paste it into your AI chat and describe your game. Bring the finished HTML back
                  here.
                </p>
              ) : null}
            </div>
          </div>
          <details>
            <summary className="cursor-pointer text-sm font-bold text-nova-text">
              <span className="inline-flex items-center gap-2">
                <ScrollText className="h-4 w-4" aria-hidden="true" />
                Show the full prompt ({prompt.length.toLocaleString()} characters)
              </span>
            </summary>
            <pre className="mt-3 max-h-96 overflow-auto rounded-2xl bg-surface-secondary p-4 text-xs leading-relaxed whitespace-pre-wrap">
              {prompt}
            </pre>
          </details>
        </section>
        <section
          aria-labelledby="editor-import-heading"
          className="mt-2 flex flex-col gap-3 border-t border-border pt-5"
        >
          <div>
            <h2 id="editor-import-heading" className="text-xl font-black">
              Add your game
            </h2>
            <p className="text-foreground/70">
              Paste one complete HTML page or upload its .html file to start testing.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="lg" onPress={onPaste}>
              <ClipboardPaste className="h-5 w-5" aria-hidden="true" />
              Paste game
            </Button>
            <Button variant="default" soft size="lg" onPress={onUpload}>
              <FileUp className="h-5 w-5" aria-hidden="true" />
              Upload HTML file
            </Button>
          </div>
        </section>
      </Card>
    </div>
  );
}
