import { toast } from "sonner";
import { cn } from "../../lib/cn";
import { writeToClipboard } from "../../lib/editor/clipboard";
import { phoneticSpelling } from "../../lib/party/phonetic";
import { BrandLogo } from "../layout/BrandLogo";

export interface PartyShellHeaderProps {
  /** Four-letter party code; omit (or null) for the bare logo header. */
  readonly code?: string | null;
  /** Full invite URL (session secret lives in the fragment; ADR-0011). */
  readonly inviteUrl?: string | null;
  /** Hide the phonetic spelling (classic's join page does this). */
  readonly disablePhonetic?: boolean;
  /**
   * Compact/faded state (5cl.8): the party shell header stays mounted while
   * the host browses games in the lobby, animating to a slightly smaller,
   * slightly faded version so the game browser beneath is the focus. The
   * transition is a pure CSS animation and respects prefers-reduced-motion.
   */
  readonly compact?: boolean;
}

/**
 * Classic-style party shell header (7.22 / 11.6): the rocket + crab logo
 * with the lobby page title — ONE "rocketcrab.com/abcd" string (origin +
 * lowercase code) styled like the homepage title. Tapping the title copies
 * the invite link to the clipboard (cursor + title attribute hint that it
 * is copyable), and the lowercase phonetic spelling of the code sits
 * underneath — the classic rocketcrab MainTitle ported to Nova's shell.
 *
 * The four-letter code is never shown separately from the title, and the
 * full invite URL (session secret) never appears on the page (ADR-0011).
 * The invite details (QR / URL / copy row) live in the lobby's invite card
 * (10.5) instead of the header: the header stays the classic identity —
 * one title + phonetic only.
 *
 * 5cl.8: while the host browses games the header renders `compact` — same
 * header, smaller logo + title and reduced opacity, animated via CSS.
 * 480: the shrink ANIMATES — the mark's height transitions on the img
 * (BrandLogo) and the title's font-size transitions on the button; both
 * are motion-reduce safe alongside the header's own transition.
 */
export function PartyShellHeader({
  code,
  inviteUrl,
  disablePhonetic = false,
  compact = false,
}: PartyShellHeaderProps) {
  const pageTitle =
    code === null || code === undefined ? null : `${window.location.host}/${code.toLowerCase()}`;

  const copyInvite = async () => {
    if (inviteUrl === null || inviteUrl === undefined) return;
    const ok = await writeToClipboard(inviteUrl);
    if (ok) {
      toast.success("Invite url copied.");
    } else {
      toast.error("Couldn't copy the link — try the Copy URL button in the lobby.");
    }
  };

  return (
    <header
      className={cn(
        "flex flex-col items-center gap-1 text-center transition-all duration-300 ease-out motion-reduce:transition-none",
        compact ? "py-1.5 opacity-70" : "py-3",
      )}
    >
      <BrandLogo size={compact ? 20 : 36} />
      {pageTitle !== null ? (
        <>
          <button
            type="button"
            className={cn(
              "font-title mt-2 cursor-pointer font-black text-base-content transition-all duration-300 ease-out motion-reduce:transition-none active:scale-95",
              compact ? "text-2xl" : "text-4xl sm:text-5xl",
            )}
            data-testid="party-title"
            onClick={() => void copyInvite()}
            disabled={inviteUrl === null}
            title={inviteUrl === null ? pageTitle : "Copy the invite link"}
            aria-label={`Party title ${pageTitle}`}
          >
            {pageTitle}
          </button>
          {/* 7.47: phonetic words stay lowercase ("(xray alpha bravo
              yankee)") — the `uppercase` class is intentionally absent.
              2t1.3: default letter-spacing, a size up from text-xs so the
              code is easier to read aloud over a call. */}
          {!disablePhonetic ? (
            <p className="text-sm font-semibold text-base-content/60">
              ({phoneticSpelling(code ?? "")})
            </p>
          ) : null}
        </>
      ) : null}
    </header>
  );
}
