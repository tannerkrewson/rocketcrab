import { Link, createFileRoute } from "@tanstack/react-router";
import {
  ArrowLeft,
  Bot,
  Check,
  ClipboardCopy,
  ClipboardPaste,
  Code2,
  ScrollText,
  Sparkles,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { BrandHeader } from "../components/layout/BrandHeader";
import { BrandLogo } from "../components/layout/BrandLogo";
import { Button, buttonStyles } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { writeToClipboard } from "../lib/editor/clipboard";
import { buildMasterPrompt } from "../lib/prompt/master-prompt";

export const Route = createFileRoute("/build")({
  component: BuildPage,
});

/** GitHub link to the Nova API reference docs, branch-free (default branch). */
const NOVA_API_REFERENCE_URL =
  "https://github.com/tannerkrewson/rocketcrab/blob/docs/api/nova-api-ai-reference.md";

/**
 * The build-a-game gateway (rocketcrab-9fv.10.11 / 2t1.7): a centered,
 * three-step introduction to the master-prompt flow — copy the prompt, chat
 * with any AI about your idea, and paste the resulting HTML into the editor.
 * The generation flow is unchanged (7.44): one copyable prompt that works
 * in any AI chat service, and the editor is the paste target (no paste box
 * here). The page ends at the master-prompt card (9fv.11.14) and now closes
 * with a prominent "Open the editor" CTA (2t1.7) — the editor is the
 * unavoidable next step, so it gets a real button instead of a dead end.
 * The hero carries the nova brand treatment (rocketcrab mark + info glow).
 */
export function BuildPage() {
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

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col items-center gap-10 text-center">
      <BrandHeader />
      <Link to="/" className={buttonStyles("neutral", "md", "self-start", true)}>
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        back
      </Link>

      <header className="flex flex-col items-center gap-5 pt-4">
        <span
          className="glow-info flex h-20 w-20 items-center justify-center rounded-box border-2 border-info/40 bg-base-100"
          aria-hidden="true"
        >
          <BrandLogo size={40} />
        </span>
        <div className="flex flex-col items-center gap-2">
          <h1 className="text-glow-info text-4xl font-black tracking-tight text-base-content sm:text-5xl">
            Build a game
          </h1>
          <p className="max-w-md text-lg leading-relaxed text-base-content/70">
            You bring the idea — the AI writes the code, Nova brings the players.
          </p>
        </div>
      </header>

      <ol
        aria-label="How to build a game"
        className="flex w-full flex-col gap-4 sm:grid sm:grid-cols-3 sm:gap-4"
      >
        <li className="card flex flex-col items-center gap-2.5 bg-base-100 p-6 text-center shadow-sm">
          <span
            className="flex h-12 w-12 items-center justify-center rounded-full border-2 border-base-300 text-base-content"
            aria-hidden="true"
          >
            <Sparkles className="h-5 w-5" />
          </span>
          <p className="text-xs font-black uppercase tracking-widest text-base-content/50">
            Step 1
          </p>
          <p className="text-lg font-black leading-tight">Get the prompt</p>
          <p className="text-sm leading-relaxed text-base-content/70">
            One copyable prompt that turns any AI chatbot into a Nova game maker.
          </p>
        </li>
        <li className="card flex flex-col items-center gap-2.5 bg-base-100 p-6 text-center shadow-sm">
          <span
            className="flex h-12 w-12 items-center justify-center rounded-full border-2 border-base-300 text-base-content"
            aria-hidden="true"
          >
            <Bot className="h-5 w-5" />
          </span>
          <p className="text-xs font-black uppercase tracking-widest text-base-content/50">
            Step 2
          </p>
          <p className="text-lg font-black leading-tight">Describe your game</p>
          <p className="text-sm leading-relaxed text-base-content/70">
            Paste the prompt into ChatGPT, Claude, or Gemini. The AI interviews you, then writes
            your game.
          </p>
        </li>
        <li className="card flex flex-col items-center gap-2.5 bg-base-100 p-6 text-center shadow-sm">
          <span
            className="flex h-12 w-12 items-center justify-center rounded-full border-2 border-base-300 text-base-content"
            aria-hidden="true"
          >
            <ClipboardPaste className="h-5 w-5" />
          </span>
          <p className="text-xs font-black uppercase tracking-widest text-base-content/50">
            Step 3
          </p>
          <p className="text-lg font-black leading-tight">Paste it in the editor</p>
          <p className="text-sm leading-relaxed text-base-content/70">
            The AI returns one complete HTML file. Paste it in the editor, run it, and make it
            yours.
          </p>
        </li>
      </ol>

      <section aria-labelledby="master-prompt-heading" className="w-full text-left">
        <Card
          title={<span id="master-prompt-heading">Your master prompt</span>}
          description="One prompt that works in every AI chat service. It embeds the complete Nova API reference, so the AI writes real Nova code — no tools, no setup."
        >
          <div className="flex justify-center">
            <Button
              variant="primary"
              size="lg"
              className="w-full sm:w-auto sm:px-16"
              onClick={() => void handleCopyPrompt()}
            >
              {copied ? (
                <Check className="h-5 w-5" aria-hidden="true" />
              ) : (
                <ClipboardCopy className="h-5 w-5" aria-hidden="true" />
              )}
              {copied ? "Prompt copied!" : "Copy the master prompt"}
            </Button>
          </div>
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
          <p className="text-sm text-base-content/70">
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

      {/* 2t1.7: the editor is the unavoidable next step — a real, prominent
          CTA instead of a dead end. The master prompt itself stays on this
          page (it's an AI prompt, not game HTML, so nothing is handed off
          to the editor; it opens blank, ready to paste). */}
      <section
        aria-label="Next step"
        className="flex w-full flex-col items-center gap-3 rounded-box border-2 border-info/40 bg-base-100 p-8 text-center"
      >
        <Code2 className="h-8 w-8 text-info" aria-hidden="true" />
        <h2 className="text-2xl font-black">Ready for your game?</h2>
        <p className="max-w-md text-base-content/70">
          When your AI chat returns the HTML, open the editor and paste it there to run it and play
          it with friends.
        </p>
        <Link to="/editor" className={buttonStyles("primary", "lg", "mt-1 sm:px-16")}>
          <Code2 className="h-5 w-5" aria-hidden="true" />
          Open the editor
        </Link>
      </section>
    </div>
  );
}
