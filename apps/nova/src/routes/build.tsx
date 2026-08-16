import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
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
import { Button, buttonStyles } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { BrandLogo } from "../components/layout/BrandLogo";
import { storeDraftSource } from "../lib/editor/draft-handoff";
import { exampleGames, exampleModeLabel } from "../lib/editor/example-games";
import { writeToClipboard } from "../lib/editor/clipboard";
import { buildMasterPrompt } from "../lib/prompt/master-prompt";

export const Route = createFileRoute("/build")({
  validateSearch: (search: Record<string, unknown>): BuildSearch => ({
    // ?page=prompt shows the master-prompt step (Page 2) so Back/refresh
    // land sanely on the two-page build flow (gmo).
    page: search.page === "prompt" ? "prompt" : undefined,
  }),
  component: BuildPage,
});

/** /build search params (rocketcrab-gmo: two-page build flow). */
interface BuildSearch {
  page?: "prompt";
}

/** GitHub link to the Nova API reference docs, branch-free (default branch). */
const NOVA_API_REFERENCE_URL =
  "https://github.com/tannerkrewson/rocketcrab/blob/docs/api/nova-api-ai-reference.md";

/**
 * 7th-pass ORBS (n6o): per-orb config for the hero card's soft "alien"
 * glow — stable hardcoded variety: distinct positions spread EVENLY across
 * the card (a fuller, denser field than 5cl.16: not one centered blob, not
 * sparse gaps), sizes, colors, breathing durations and delays. The info
 * cyan (nova IS the info color, 2t1.3) dominates so the glow matches the
 * brand halo, with a few primary/secondary/accent orbs for the alien mix.
 * Opacities stay low so the headline and actions read on top. The
 * animation uses `backwards` fill mode so every orb holds its 0% keyframe
 * during its delay — no first-render flash of the un-animated state.
 */
const ORBS = [
  {
    className: "h-40 w-72 bg-info/40 blur-2xl",
    left: "5%",
    top: "6%",
    breathe: "7s",
    delay: "0s",
  },
  {
    className: "h-28 w-52 bg-secondary/30 blur-xl",
    left: "56%",
    top: "2%",
    breathe: "9s",
    delay: "1.2s",
  },
  {
    className: "h-24 w-44 bg-accent/30 blur-xl",
    left: "28%",
    top: "12%",
    breathe: "8s",
    delay: "0.9s",
  },
  {
    className: "h-36 w-64 bg-info/35 blur-2xl",
    left: "72%",
    top: "22%",
    breathe: "10s",
    delay: "2s",
  },
  {
    className: "h-28 w-52 bg-primary/25 blur-2xl",
    left: "12%",
    top: "30%",
    breathe: "6s",
    delay: "1.6s",
  },
  {
    className: "h-24 w-44 bg-info/30 blur-xl",
    left: "44%",
    top: "34%",
    breathe: "11s",
    delay: "2.6s",
  },
  {
    className: "h-32 w-60 bg-secondary/25 blur-2xl",
    left: "80%",
    top: "48%",
    breathe: "12s",
    delay: "0.7s",
  },
  {
    className: "h-28 w-52 bg-accent/25 blur-xl",
    left: "6%",
    top: "58%",
    breathe: "9s",
    delay: "1.4s",
  },
  {
    className: "h-24 w-44 bg-info/30 blur-xl",
    left: "38%",
    top: "64%",
    breathe: "8s",
    delay: "3s",
  },
  {
    className: "h-36 w-64 bg-primary/25 blur-2xl",
    left: "64%",
    top: "70%",
    breathe: "10s",
    delay: "2.3s",
  },
  {
    className: "h-28 w-52 bg-info/25 blur-2xl",
    left: "22%",
    top: "82%",
    breathe: "7s",
    delay: "3.6s",
  },
];

/**
 * The build-a-game gateway, split into TWO pages (gmo): page one is the
 * "Introducing Nova" hero — the non-glow rocketcrab mark over the brand
 * line (Nova in the info color, matching the homepage alert), a clean
 * tagline, a nova-colored "Get started" CTA (btn-info + glow-info aura)
 * that steps to ?page=prompt, plus the three-step flow summary. Page two
 * (?page=prompt) carries the master prompt itself, the Nova example games
 * (wks) as the "start from something complete" alternative, and the Open
 * the editor entry point (7.44: the editor is the paste target, no paste
 * box here). The generation flow is unchanged — one copyable prompt that
 * works in any AI chat service.
 */
export function BuildPage() {
  const search = Route.useSearch();
  if (search.page === "prompt") {
    return <BuildPromptPage />;
  }
  return <BuildHeroPage />;
}

/** Page 1: the hero + the three-step intro. */
function BuildHeroPage() {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col items-center gap-10 text-center">
      <Link to="/" className={buttonStyles("default", "md", "self-start", true)}>
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        back
      </Link>

      {/* 7th pass: ONE hero card with the non-glow rocketcrab mark above the
          "Introducing Nova" line (Nova in the info color — the homepage
          alert uses the same daisyUI info, NOT primary), a short warm
          tagline, and the nova-colored Get started CTA (with the brand
          info aura) stepping to the prompt page. No nova-colored outline
          on the card (kqo) — a plain neutral border; the breathing orbs
          still carry the glow, now fuller and evenly spread (n6o).
          Purely decorative (aria-hidden), CSS-only, respects
          prefers-reduced-motion; orbs sit behind the content. */}
      <section
        aria-labelledby="build-hero-heading"
        data-testid="build-hero"
        className="relative w-full overflow-hidden rounded-box border-2 border-base-300 bg-base-100 shadow-sm"
      >
        <div className="rc-build-glow" aria-hidden="true">
          {ORBS.map((orb, index) => (
            <span
              key={index}
              className={`rc-build-orb ${orb.className}`}
              style={{
                left: orb.left,
                top: orb.top,
                animation: `rc-build-orb-breathe ${orb.breathe} ease-in-out ${orb.delay} infinite alternate backwards`,
              }}
            />
          ))}
        </div>
        <style>{`
          .rc-build-glow {
            position: absolute;
            inset: 0;
            overflow: hidden;
            pointer-events: none;
          }
          .rc-build-orb {
            position: absolute;
            border-radius: 9999px;
          }
          @keyframes rc-build-orb-breathe {
            0% { transform: scale(0.92); opacity: 0.5; }
            50% { transform: scale(1.08); opacity: 0.85; }
            100% { transform: scale(0.92); opacity: 0.5; }
          }
          @media (prefers-reduced-motion: reduce) {
            /* Inline animation styles would otherwise beat this rule. */
            .rc-build-orb {
              animation: none !important;
              opacity: 0.55;
            }
          }
        `}</style>
        <div className="relative flex flex-col items-center gap-4 px-6 py-12 sm:px-12 sm:py-16">
          {/* Non-glow rocketcrab mark above the headline (kqo): the
              flat mark via the BrandLogo no-glow variant. */}
          <BrandLogo variant="no-glow" size={80} responsive aria-hidden />
          <h1
            id="build-hero-heading"
            className="text-glow-info text-4xl font-black text-base-content sm:text-5xl"
          >
            Introducing <span className="text-info">Nova</span>
          </h1>
          <p className="max-w-md text-lg leading-relaxed text-base-content/70">
            Turn any idea into a game your friends can play.
          </p>
          {/* gmo: the nova-colored hero CTA steps to the prompt page. The
              btn-info class plus a nova drop-shadow make the aura (the
              filter rides on top of the button's own depth shadow). */}
          <Link
            to="/build"
            search={{ page: "prompt" }}
            className={buttonStyles(
              "info",
              "lg",
              "drop-shadow-[0_0_22px_oklch(72%_0.11_225/0.55)] mt-1 sm:px-14",
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
        <li className="card flex flex-col items-center gap-2.5 bg-base-100 p-6 text-center shadow-sm">
          <span
            className="flex h-12 w-12 items-center justify-center rounded-full border-2 border-base-300 text-base-content"
            aria-hidden="true"
          >
            <Sparkles className="h-5 w-5" />
          </span>
          <p className="text-xs font-black text-base-content/50">Step 1</p>
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
          <p className="text-xs font-black text-base-content/50">Step 2</p>
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
          <p className="text-xs font-black text-base-content/50">Step 3</p>
          <p className="text-lg font-black leading-tight">Paste it in the editor</p>
          <p className="text-sm leading-relaxed text-base-content/70">
            The AI returns one complete HTML file. Paste it in the editor, run it, and make it
            yours.
          </p>
        </li>
      </ol>
    </div>
  );
}

/** Page 2 (?page=prompt): the master prompt, the example games, and the
 *  editor entry — the "do the work" step of the build flow. */
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
      toast.error("Couldn't copy the prompt — expand it below and copy manually.");
    }
  };

  /** wks: load a Nova example into the editor (same handoff as /examples). */
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
      toast.error("Couldn't load this example game.");
      setOpeningId(null);
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col items-center gap-8 text-center">
      <Link to="/build" className={buttonStyles("default", "md", "self-start", true)}>
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        back
      </Link>

      <header className="flex flex-col items-center gap-3">
        <h1 className="text-3xl font-black text-base-content sm:text-4xl">
          Get the <span className="text-info">master prompt</span>
        </h1>
        <p className="max-w-xl text-lg leading-relaxed text-base-content/70">
          One prompt that works in every AI chat service. Copy it, tell the AI about your idea, and
          it writes your game — one complete HTML file ready to paste into the editor.
        </p>
      </header>

      {/* The three moves, spelled out compactly (gmo: legible, not
          overwhelming). */}
      <ol
        aria-label="What to do with the prompt"
        className="flex w-full flex-wrap items-center justify-center gap-2 text-sm font-semibold text-base-content/70"
      >
        <li className="flex items-center gap-2 rounded-full border-2 border-base-300 bg-base-100 px-4 py-2">
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-info/20 font-black text-info">
            1
          </span>
          Copy the prompt
        </li>
        <li className="flex items-center gap-2 rounded-full border-2 border-base-300 bg-base-100 px-4 py-2">
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-info/20 font-black text-info">
            2
          </span>
          Chat about your idea
        </li>
        <li className="flex items-center gap-2 rounded-full border-2 border-base-300 bg-base-100 px-4 py-2">
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-info/20 font-black text-info">
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

      {/* wks: Nova example games are back in the build flow — skip the
          prompt entirely and start from a complete game. */}
      <section aria-labelledby="example-games-heading" className="w-full text-left">
        <h2 id="example-games-heading" className="text-xl font-black">
          Or start from a Nova example
        </h2>
        <p className="mt-1 text-sm leading-relaxed text-base-content/70">
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
                  <span className="badge badge-accent badge-outline font-bold">
                    {exampleModeLabel[game.mode]}
                  </span>
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

      {/* The editor is the unavoidable next step (7.44): once the AI has
          written the game, paste it here. The master prompt itself stays on
          this page (it's an AI prompt, not game HTML, so nothing is handed
          off to the editor; it opens blank, ready to paste). */}
      <Link
        to="/editor"
        className={buttonStyles(
          "info",
          "lg",
          "drop-shadow-[0_0_22px_oklch(72%_0.11_225/0.55)] w-full sm:w-auto sm:px-16",
        )}
      >
        <Code2 className="h-5 w-5" aria-hidden="true" />
        Open the editor
      </Link>
    </div>
  );
}
