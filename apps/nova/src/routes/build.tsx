import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Badge } from "../components/ui/Badge";
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
import { NovaSilk } from "../components/backgrounds/NovaSilk";
import { storeDraftSource } from "../lib/editor/draft-handoff";
import { exampleGames, exampleModeLabel } from "../lib/editor/example-games";
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

/** GitHub link to the Nova API reference docs, branch-free (default branch). */
const NOVA_API_REFERENCE_URL =
  "https://github.com/tannerkrewson/rocketcrab/blob/docs/api/nova-api-ai-reference.md";

/** Build flow: introduction, then a copyable prompt and example-game handoff. */
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
      <Link to="/" viewTransition className={buttonStyles("default", "md", "self-start", true)}>
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        back
      </Link>

      <section
        aria-labelledby="build-hero-heading"
        data-testid="build-hero"
        // The home page's Nova card expands into this hero (shared view-transition name).
        className="vt-nova-hero relative w-full overflow-hidden rounded-2xl bg-background"
      >
        <NovaSilk />
        <div className="relative flex flex-col items-center gap-4 px-6 py-12 sm:px-12 sm:py-16">
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
              "drop-shadow-[0_0_22px_oklch(62%_0.19_264/0.55)] mt-1 sm:px-14",
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
        <li className="flex flex-col items-center gap-2.5 rounded-2xl border border-border bg-surface p-6 text-center shadow-sm">
          <span
            className="flex h-12 w-12 items-center justify-center rounded-full border-2 border-border text-foreground"
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
        <li className="flex flex-col items-center gap-2.5 rounded-2xl border border-border bg-surface p-6 text-center shadow-sm">
          <span
            className="flex h-12 w-12 items-center justify-center rounded-full border-2 border-border text-foreground"
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
        <li className="flex flex-col items-center gap-2.5 rounded-2xl border border-border bg-surface p-6 text-center shadow-sm">
          <span
            className="flex h-12 w-12 items-center justify-center rounded-full border-2 border-border text-foreground"
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
  const navigate = useNavigate();
  const prompt = useMemo(() => buildMasterPrompt(), []);
  const [copied, setCopied] = useState(false);
  const [openingId, setOpeningId] = useState<string | null>(null);

  const handleCopyPrompt = async () => {
    const ok = await writeToClipboard(prompt);
    if (ok) {
      setCopied(true);
      toast.success("Master prompt copied to your clipboard.");
    } else {
      toast.danger("Couldn't copy the prompt — expand it below and copy manually.");
    }
  };

  const handleOpenExample = async (gameId: string) => {
    if (openingId !== null) return;
    setOpeningId(gameId);
    try {
      const game = exampleGames.find((candidate) => candidate.id === gameId);
      if (game === undefined) return;
      const source = (await game.load()).default;
      storeDraftSource(source);
      await navigate({ to: "/editor" });
    } catch {
      toast.danger("Couldn't load this example game.");
      setOpeningId(null);
    }
  };

  return (
    <div className="theme-nova mx-auto flex w-full max-w-2xl flex-col items-center gap-8 text-center">
      <Link to="/build" className={buttonStyles("default", "md", "self-start", true)}>
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        back
      </Link>

      <header className="flex flex-col items-center gap-3">
        <h1 className="text-3xl font-black text-foreground sm:text-4xl">
          Get the <span className="text-accent">master prompt</span>
        </h1>
        <p className="max-w-xl text-lg leading-relaxed text-foreground/70">
          One prompt that works in every AI chat service. Copy it, tell the AI about your idea, and
          it writes your game — one complete HTML file ready to paste into the editor.
        </p>
      </header>

      <ol
        aria-label="What to do with the prompt"
        className="flex w-full flex-wrap items-center justify-center gap-2 text-sm font-semibold text-foreground/70"
      >
        <li className="flex items-center gap-2 rounded-full border-2 border-border bg-surface px-4 py-2">
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-accent/20 font-black text-accent">
            1
          </span>
          Copy the prompt
        </li>
        <li className="flex items-center gap-2 rounded-full border-2 border-border bg-surface px-4 py-2">
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-accent/20 font-black text-accent">
            2
          </span>
          Chat about your idea
        </li>
        <li className="flex items-center gap-2 rounded-full border-2 border-border bg-surface px-4 py-2">
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-accent/20 font-black text-accent">
            3
          </span>
          Paste the game in the editor
        </li>
      </ol>

      <section aria-labelledby="master-prompt-heading" className="w-full text-left">
        <Card
          title={<span id="master-prompt-heading">The prompt</span>}
          description="It embeds the complete Nova API reference, so the AI writes real Nova code — no tools, no setup."
        >
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="primary"
              size="lg"
              className="sm:px-10"
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
            <pre className="mt-3 max-h-96 overflow-auto rounded-2xl border-2 border-border bg-surface-secondary p-4 text-xs leading-relaxed whitespace-pre-wrap">
              {prompt}
            </pre>
          </details>
          <p className="text-sm text-foreground/70">
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

      <section aria-labelledby="example-games-heading" className="w-full text-left">
        <h2 id="example-games-heading" className="text-xl font-black">
          Or start from a Nova example
        </h2>
        <p className="mt-1 text-sm leading-relaxed text-foreground/70">
          No prompt needed — open a complete game in the editor as a new draft, run it, and make it
          yours.
        </p>
        <div className="mt-4 flex flex-col gap-4">
          {exampleGames.map((game) => (
            <Card
              key={game.id}
              title={
                <span className="flex flex-wrap items-center gap-2">
                  {game.title}
                  <Badge color="accent" variant="secondary">
                    {exampleModeLabel[game.mode]}
                  </Badge>
                </span>
              }
              description={game.description}
              actions={
                <Button
                  variant="primary"
                  onClick={() => void handleOpenExample(game.id)}
                  disabled={openingId !== null}
                >
                  <Code2 className="h-4 w-4" aria-hidden="true" />
                  {openingId === game.id ? "Opening…" : "Open in the editor"}
                </Button>
              }
            />
          ))}
        </div>
      </section>

      {/* The prompt is instructions for an AI, not game HTML; open a blank
          editor rather than handing the prompt over as source. */}
      <Link
        to="/editor"
        className={buttonStyles(
          "info",
          "lg",
          "drop-shadow-[0_0_22px_oklch(62%_0.19_264/0.55)] w-full sm:w-auto sm:px-16",
        )}
      >
        <Code2 className="h-5 w-5" aria-hidden="true" />
        Open the editor
      </Link>
    </div>
  );
}
