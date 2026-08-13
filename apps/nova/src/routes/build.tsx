import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { Check, ClipboardCopy, Code2, ScrollText } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { writeToClipboard } from "../lib/editor/clipboard";
import { clearDraftSource } from "../lib/editor/draft-handoff";
import { buildMasterPrompt } from "../lib/prompt/master-prompt";

export const Route = createFileRoute("/build")({
  component: BuildPage,
});

/** GitHub link to the Nova API reference docs, branch-free (default branch). */
const NOVA_API_REFERENCE_URL =
  "https://github.com/tannerkrewson/rocketcrab/blob/docs/api/nova-api-ai-reference.md";

/**
 * The A4 master-prompt generator page (7.44): one copyable prompt that
 * works in any AI chat service. The page's two actions are "copy the master
 * prompt" and "open the editor" — the chatbot's HTML is pasted directly into
 * the editor (no paste box here).
 */
export function BuildPage() {
  const navigate = useNavigate();
  const prompt = useMemo(() => buildMasterPrompt(), []);
  const [copied, setCopied] = useState(false);

  const handleCopyPrompt = async () => {
    const ok = await writeToClipboard(prompt);
    if (ok) {
      setCopied(true);
      toast.success("Master prompt copied to your clipboard.");
    } else {
      toast.error("Couldn't copy the prompt — expand it below and copy manually.");
    }
  };

  /** Open a blank editor; clear any stale draft handoff. */
  const handleOpenEditor = () => {
    clearDraftSource();
    void navigate({ to: "/editor" });
  };

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-3xl font-black">Build a game</h1>
      </header>

      <section aria-labelledby="master-prompt-heading">
        <Card
          title={<span id="master-prompt-heading">The master prompt</span>}
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
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button variant="secondary" size="lg" onClick={handleOpenEditor}>
              <Code2 className="h-5 w-5" aria-hidden="true" />
              Open the editor
            </Button>
            <Link
              to="/examples"
              className="btn btn-outline btn-lg font-bold"
              title="Open complete example games in the editor"
            >
              See example games
            </Link>
          </div>
        </Card>
      </section>
    </div>
  );
}
