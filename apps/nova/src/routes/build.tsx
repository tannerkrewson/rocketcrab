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
 * 5cl.16: per-orb config for the hero card's soft "alien" glow — stable
 * hardcoded variety: distinct positions spread across the card (NOT one
 * centered blob), sizes, colors, breathing durations and delays. The info
 * cyan (nova IS the info color, 2t1.3) dominates so the glow matches the
 * brand halo, with a few primary/secondary/accent orbs for the alien mix.
 * Opacities stay low so the headline and actions read on top.
 */
const ORBS = [
  {
    className: "h-40 w-72 bg-info/35 blur-2xl",
    left: "4%",
    top: "6%",
    breathe: "7s",
    delay: "0s",
  },
  {
    className: "h-32 w-56 bg-secondary/35 blur-2xl",
    left: "62%",
    top: "2%",
    breathe: "9s",
    delay: "1.4s",
  },
  {
    className: "h-28 w-48 bg-accent/35 blur-xl",
    left: "30%",
    top: "58%",
    breathe: "8s",
    delay: "0.7s",
  },
  {
    className: "h-36 w-64 bg-info/30 blur-2xl",
    left: "72%",
    top: "48%",
    breathe: "10s",
    delay: "2.2s",
  },
  {
    className: "h-24 w-44 bg-primary/30 blur-xl",
    left: "14%",
    top: "40%",
    breathe: "6s",
    delay: "1.8s",
  },
  {
    className: "h-20 w-36 bg-info/30 blur-xl",
    left: "48%",
    top: "12%",
    breathe: "11s",
    delay: "3.1s",
  },
  {
    className: "h-32 w-52 bg-secondary/25 blur-2xl",
    left: "80%",
    top: "74%",
    breathe: "12s",
    delay: "0.9s",
  },
];

/**
 * The build-a-game gateway (rocketcrab-9fv.10.11 / 2t1.7, hero redesigned
 * 5cl.16): a centered, three-step introduction to the master-prompt flow —
 * copy the prompt, chat with any AI about your idea, and paste the
 * resulting HTML into the editor. The generation flow is unchanged (7.44):
 * one copyable prompt that works in any AI chat service, and the editor is
 * the paste target (no paste box here).
 *
 * The page opens with ONE cohesive hero card (5cl.16): a prominent
 * "Rocketcrab Nova" headline (no daisyUI aura, no rocketcrab mark, no
 * brand row — the logo + rocketcrab.com row is gone from this page) with
 * a soft alien glow breathing in the card background, and the "Open the
 * editor" CTA (2t1.7) inside it so the editor is never more than one tap
 * away. The page ends at the master-prompt card (9fv.11.14).
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
      <Link to="/" className={buttonStyles("neutral", "md", "self-start", true)}>
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        back
      </Link>

      {/* 5cl.16: the page's ONE hero card — "Rocketcrab Nova" headline with
          the build/editor entry action inside it. The old daisyUI aura and
          rocketcrab logo mark are gone; instead the card background carries
          the soft alien glow (blurred orbs breathing from different origins,
          mirroring the lobby welcome card pattern). Purely decorative
          (aria-hidden), CSS-only, respects prefers-reduced-motion; orbs sit
          behind the content so the text stays readable. */}
      <section
        aria-labelledby="build-hero-heading"
        data-testid="build-hero"
        className="relative w-full overflow-hidden rounded-box border-2 border-info/40 bg-base-100 shadow-sm"
      >
        <div className="rc-build-glow" aria-hidden="true">
          {ORBS.map((orb, index) => (
            <span
              key={index}
              className={`rc-build-orb ${orb.className}`}
              style={{
                left: orb.left,
                top: orb.top,
                animation: `rc-build-orb-breathe ${orb.breathe} ease-in-out ${orb.delay} infinite alternate`,
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
        <div className="relative flex flex-col items-center gap-5 px-6 py-12 sm:px-12 sm:py-16">
          <p className="text-xs font-black uppercase tracking-wider text-base-content/50">
            Build a game
          </p>
          <h1
            id="build-hero-heading"
            className="text-glow-info text-4xl font-black text-base-content sm:text-5xl"
          >
            Rocketcrab <span className="text-primary">Nova</span>
          </h1>
          <p className="max-w-md text-lg leading-relaxed text-base-content/70">
            You bring the idea — the AI writes the code, Nova brings the players.
          </p>
          {/* 2t1.7: the editor is the unavoidable next step — a real,
              prominent CTA inside the hero so it's never more than one tap
              away. The master prompt itself stays on this page (it's an AI
              prompt, not game HTML, so nothing is handed off to the editor;
              it opens blank, ready to paste). */}
          <Link to="/editor" className={buttonStyles("primary", "lg", "mt-1 sm:px-16")}>
            <Code2 className="h-5 w-5" aria-hidden="true" />
            Open the editor
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
          <p className="text-xs font-black uppercase text-base-content/50">Step 1</p>
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
          <p className="text-xs font-black uppercase text-base-content/50">Step 2</p>
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
          <p className="text-xs font-black uppercase text-base-content/50">Step 3</p>
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
    </div>
  );
}
