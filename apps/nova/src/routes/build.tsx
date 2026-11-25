import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { ArrowLeft, Bot, ClipboardPaste, Sparkles } from "lucide-react";
import { buttonStyles } from "../components/ui/Button";
import { BrandLogo } from "../components/layout/BrandLogo";
import { clarityEvent } from "../lib/clarity";

export const Route = createFileRoute("/build")({
  validateSearch: (search: Record<string, unknown>): { page?: "prompt" } => ({
    page: search.page === "prompt" ? "prompt" : undefined,
  }),
  // Old prompt links open the new prompt and import flow in the editor.
  beforeLoad: ({ search }) => {
    if (search.page === "prompt") throw redirect({ to: "/editor", replace: true });
  },
  component: BuildPage,
});

/** Introduce Nova and link to the editor's game creation flow. */
export function BuildPage() {
  return (
    <div className="theme-nova mx-auto flex w-full max-w-2xl flex-col items-center gap-10 text-center">
      <Link to="/" className={buttonStyles("default", "md", "self-start", true)}>
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Back
      </Link>

      <section
        aria-labelledby="build-hero-heading"
        data-testid="build-hero"
        // Sits directly on the page's blue molten metal background (SiteBackground).
        className="relative w-full"
      >
        <div className="relative flex flex-col items-center gap-4 px-2 py-10 sm:py-14">
          <div className="drop-shadow-[0_0_10px_oklch(64%_0.2_264/0.55)]">
            <BrandLogo nova />
          </div>
          <h1
            id="build-hero-heading"
            className="text-4xl font-black text-foreground [text-shadow:0_2px_16px_rgb(0_0_0/0.8),0_0_20px_oklch(64%_0.2_264/0.45)] sm:text-5xl"
          >
            Introducing <span className="text-nova-text">Nova</span>
          </h1>
          <p className="max-w-md text-lg leading-relaxed text-foreground/85 [text-shadow:0_1px_10px_rgb(0_0_0/0.8),0_0_14px_oklch(64%_0.2_264/0.4)]">
            Turn any idea into a game your friends can play.
          </p>
          <Link
            to="/editor"
            onClick={() => clarityEvent("open_editor_clicked")}
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
