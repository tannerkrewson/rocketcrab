import { createFileRoute, Link } from "@tanstack/react-router";
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
import { toast } from "../lib/toast";
import { Button, buttonStyles } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { BrandLogo } from "../components/layout/BrandLogo";
import { writeToClipboard } from "../lib/editor/clipboard";
import { buildMasterPrompt } from "../lib/prompt/master-prompt";

export const Route = createFileRoute("/build")({
  validateSearch: (search: Record<string, unknown>): BuildSearch => ({
    // Keep the prompt step addressable for browser Back and refresh.
    page: search.page === "prompt" ? "prompt" : undefined,
  }),
  component: BuildPage,
});

interface BuildSearch {
  page?: "prompt";
}

/** Build flow: introduction, then a copyable prompt and the editor handoff. */
export function BuildPage() {
  const search = Route.useSearch();
  if (search.page === "prompt") {
    return <BuildPromptPage />;
  }
  return <BuildHeroPage />;
}

function BuildHeroPage() {
  return (
    <div className="theme-nova mx-auto flex w-full max-w-2xl flex-col items-center gap-10 text-center">
      <Link to="/" className={buttonStyles("default", "md", "self-start", true)}>
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        back
      </Link>

      <section
        aria-labelledby="build-hero-heading"
        data-testid="build-hero"
        // Sits directly on the page's blue molten metal background (SiteBackground).
        className="relative w-full"
      >
        <div className="relative flex flex-col items-center gap-4 px-2 py-10 sm:py-14">
          <BrandLogo variant="no-glow" size={80} responsive aria-hidden />
          <h1
            id="build-hero-heading"
            className="text-4xl font-black text-foreground [text-shadow:0_2px_16px_rgb(0_0_0/0.8)] sm:text-5xl"
          >
            Introducing <span className="text-nova-text">Nova</span>
          </h1>
          <p className="max-w-md text-lg leading-relaxed text-foreground/85 [text-shadow:0_1px_10px_rgb(0_0_0/0.8)]">
            Turn any idea into a game your friends can play.
          </p>
          <Link
            to="/build"
            search={{ page: "prompt" }}
            className={buttonStyles(
              "info",
              "lg",
              "drop-shadow-[0_0_22px_oklch(62%_0.19_264/0.55)] mt-1",
            )}
          >
            <Sparkles className="h-5 w-5" aria-hidden="true" />
            Get started
          </Link>
        </div>
      </section>

      <ol
        aria-label="How to build a game"
        className="flex w-full flex-col gap-4 sm:grid sm:grid-cols-3 sm:gap-4"
      >
        <li className="flex flex-col items-center gap-2.5 glass rounded-2xl p-6 text-center">
          <span
            className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-tertiary text-foreground"
            aria-hidden="true"
          >
            <Sparkles className="h-5 w-5" />
          </span>
          <p className="text-xs font-black text-foreground/50">Step 1</p>
          <p className="text-lg font-black leading-tight">Get the prompt</p>
          <p className="text-sm leading-relaxed text-foreground/70">
            One copyable prompt that turns any AI chatbot into a Nova game maker.
          </p>
        </li>
        <li className="flex flex-col items-center gap-2.5 glass rounded-2xl p-6 text-center">
          <span
            className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-tertiary text-foreground"
            aria-hidden="true"
          >
            <Bot className="h-5 w-5" />
          </span>
          <p className="text-xs font-black text-foreground/50">Step 2</p>
          <p className="text-lg font-black leading-tight">Describe your game</p>
          <p className="text-sm leading-relaxed text-foreground/70">
            Paste the prompt into ChatGPT, Claude, or Gemini. The AI interviews you, then writes
            your game.
          </p>
        </li>
        <li className="flex flex-col items-center gap-2.5 glass rounded-2xl p-6 text-center">
          <span
            className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-tertiary text-foreground"
            aria-hidden="true"
          >
            <ClipboardPaste className="h-5 w-5" />
          </span>
          <p className="text-xs font-black text-foreground/50">Step 3</p>
          <p className="text-lg font-black leading-tight">Paste it in the editor</p>
          <p className="text-sm leading-relaxed text-foreground/70">
            The AI returns one complete HTML file. Paste it in the editor, run it, and make it
            yours.
          </p>
        </li>
      </ol>
    </div>
  );
}

function BuildPromptPage() {
  const prompt = useMemo(() => buildMasterPrompt(), []);
  const [copied, setCopied] = useState(false);
  const [previewed, setPreviewed] = useState(false);

  const handleCopyPrompt = async () => {
    const ok = await writeToClipboard(prompt);
    if (ok) {
      setCopied(true);
    } else {
      toast.danger("Couldn't copy the prompt. Open the full prompt to copy it manually.");
    }
  };

  return (
    <div className="theme-nova mx-auto flex w-full max-w-2xl flex-col items-center gap-5">
      <Link to="/build" className={buttonStyles("tertiary", "md", "self-start")}>
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Back
      </Link>

      <h1 className="sr-only">Game prompt</h1>
      <Card className="w-full">
        <Button
          variant="primary"
          size="lg"
          className="self-start"
          onPress={() => void handleCopyPrompt()}
        >
          <ClipboardCopy className="h-5 w-5" aria-hidden="true" />
          {copied ? "Copy again" : "Copy prompt"}
        </Button>
        <details
          onToggle={(event) => {
            if (event.currentTarget.open) setPreviewed(true);
          }}
        >
          <summary className="cursor-pointer font-bold text-nova-text">
            <span className="inline-flex items-center gap-2">
              <ScrollText className="h-4 w-4" aria-hidden="true" />
              Show the full prompt ({prompt.length.toLocaleString()} characters)
            </span>
          </summary>
          <pre className="mt-3 max-h-96 overflow-auto rounded-2xl bg-surface-secondary p-4 text-xs leading-relaxed whitespace-pre-wrap">
            {prompt}
          </pre>
        </details>
      </Card>

      {copied || previewed ? (
        <div className="glass flex w-full flex-col items-start gap-3 rounded-2xl p-5">
          <div role="status" className="flex flex-col gap-1">
            {copied ? (
              <p className="flex items-center gap-2 font-bold">
                <Check className="h-4 w-4 text-success" aria-hidden="true" />
                Prompt copied
              </p>
            ) : null}
            <p className="text-foreground/80">
              Paste the prompt into your AI chat and describe your game. When it gives you the
              game&apos;s HTML, come back to paste it in or upload the file.
            </p>
          </div>
          <Link to="/editor" className={buttonStyles("outline", "md")}>
            <Code2 className="h-4 w-4" aria-hidden="true" />
            Paste or upload my game
          </Link>
        </div>
      ) : null}
    </div>
  );
}
