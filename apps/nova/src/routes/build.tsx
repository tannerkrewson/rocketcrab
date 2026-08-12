import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { Check, ClipboardCopy, Code2, ScrollText } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { writeToClipboard } from "../lib/editor/clipboard";
import { clearDraftSource, storeDraftSource } from "../lib/editor/draft-handoff";
import { buildMasterPrompt } from "../lib/prompt/master-prompt";

export const Route = createFileRoute("/build")({
  component: BuildPage,
});

/** GitHub link to the Nova API reference docs, branch-free (default branch). */
const NOVA_API_REFERENCE_URL =
  "https://github.com/tannerkrewson/rocketcrab/blob/docs/api/nova-api-ai-reference.md";

/**
 * The A4 master-prompt generator page: one copyable prompt that works in
 * any AI chat service, plus the paste target that turns the chatbot's HTML
 * into a new local draft in the editor. This page never interviews the user
 * — the prompt does that inside the chat service.
 */
export function BuildPage() {
  const navigate = useNavigate();
  const prompt = useMemo(() => buildMasterPrompt(), []);
  const [copied, setCopied] = useState(false);
  const [pastable, setPastable] = useState("");

  const handleCopyPrompt = async () => {
    const ok = await writeToClipboard(prompt);
    if (ok) {
      setCopied(true);
      toast.success("Master prompt copied to your clipboard.");
    } else {
      toast.error("Couldn't copy the prompt — expand it below and copy manually.");
    }
  };

  /** Continue to a blank editor; clear any stale draft handoff. */
  const handleOpenBlankEditor = () => {
    clearDraftSource();
    void navigate({ to: "/editor" });
  };

  /** Paste target: a new local draft is created immediately. */
  const handlePasteToDraft = () => {
    const source = pastable.trim();
    if (source.length === 0) return;
    storeDraftSource(source);
    setPastable("");
    void navigate({ to: "/editor" });
  };

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-3">
        <h1 className="text-3xl font-black">Build a game</h1>
        <p className="max-w-2xl text-base-content/70">
          Copy the master prompt below into any AI chat service. The chatbot interviews you about
          rules, players, turns, controls, and style, then writes your game as one complete HTML
          document. Paste that document back here to start editing it in Nova.
        </p>
      </header>

      <section aria-labelledby="master-prompt-heading">
        <Card
          title={<span id="master-prompt-heading">The master prompt</span>}
          description="The same prompt works in every AI chat service. It embeds the current Nova API reference so the chatbot writes against the real API."
          actions={
            <Button variant="primary" size="lg" onClick={() => void handleCopyPrompt()}>
              {copied ? (
                <Check className="h-5 w-5" aria-hidden="true" />
              ) : (
                <ClipboardCopy className="h-5 w-5" aria-hidden="true" />
              )}
              {copied ? "Prompt copied!" : "Copy the master prompt"}
            </Button>
          }
        >
          <details className="group">
            <summary className="cursor-pointer font-bold text-primary">
              <span className="inline-flex items-center gap-2">
                <ScrollText className="h-4 w-4" aria-hidden="true" />
                Show the full prompt ({prompt.length.toLocaleString()} characters)
              </span>
            </summary>
            <pre className="mt-3 max-h-96 overflow-auto rounded-box border-2 border-base-300 bg-base-200 p-4 text-xs leading-relaxed whitespace-pre-wrap">
              {prompt}
            </pre>
          </details>
          <p className="mt-3 text-sm text-base-content/70">
            Reading the API reference? It's on GitHub:{" "}
            <a
              href={NOVA_API_REFERENCE_URL}
              target="_blank"
              rel="noreferrer"
              className="font-bold text-primary underline underline-offset-2"
            >
              Nova API reference
            </a>
            .
          </p>
        </Card>
      </section>

      <section aria-labelledby="next-steps-heading">
        <Card
          title={<span id="next-steps-heading">Next steps</span>}
          description="Either continue to a blank editor, or paste the chatbot's HTML to create a new draft immediately."
        >
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="outline" size="lg" onClick={handleOpenBlankEditor}>
                <Code2 className="h-5 w-5" aria-hidden="true" />
                Continue to a blank editor
              </Button>
              <Link
                to="/examples"
                className="btn btn-ghost btn-lg font-bold"
                title="Open complete example games in the editor"
              >
                See example games
              </Link>
            </div>

            <div className="flex flex-col gap-2" data-testid="paste-target">
              <label htmlFor="paste-game-html" className="text-sm font-black text-base-content/80">
                Already have the game's HTML from your chat?
              </label>
              <textarea
                id="paste-game-html"
                value={pastable}
                onChange={(event) => setPastable(event.target.value)}
                placeholder="Paste the complete HTML document here…"
                aria-label="Paste game HTML"
                rows={5}
                className="textarea textarea-bordered w-full font-mono text-xs"
              />
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  variant="primary"
                  size="lg"
                  onClick={handlePasteToDraft}
                  disabled={pastable.trim().length === 0}
                >
                  Open in the editor
                </Button>
                <span className="text-sm text-base-content/60">
                  Creates a new unsaved draft you can run, fix, and save.
                </span>
              </div>
            </div>
          </div>
        </Card>
      </section>
    </div>
  );
}
