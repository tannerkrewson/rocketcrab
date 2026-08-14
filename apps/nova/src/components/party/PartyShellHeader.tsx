import { toast } from "sonner";
import { writeToClipboard } from "../../lib/editor/clipboard";
import { phoneticSpelling } from "../../lib/party/phonetic";

export interface PartyShellHeaderProps {
  /** Four-letter party code; omit (or null) for the bare logo header. */
  readonly code?: string | null;
  /** Full invite URL (session secret lives in the fragment; ADR-0011). */
  readonly inviteUrl?: string | null;
  /** Hide the phonetic spelling (classic's join page does this). */
  readonly disablePhonetic?: boolean;
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
 */
export function PartyShellHeader({
  code,
  inviteUrl,
  disablePhonetic = false,
}: PartyShellHeaderProps) {
  const pageTitle =
    code === null || code === undefined ? null : `${window.location.host}/${code.toLowerCase()}`;

  const copyInvite = async () => {
    if (inviteUrl === null || inviteUrl === undefined) return;
    const ok = await writeToClipboard(inviteUrl);
    if (ok) {
      toast.success("Invite title copied.");
    } else {
      toast.error("Couldn't copy the link — try the Copy URL button in the lobby.");
    }
  };

  return (
    <header className="flex flex-col items-center gap-1 py-3 text-center">
      <p className="text-4xl leading-none" aria-hidden="true">
        🦀🚀
      </p>
      {pageTitle !== null ? (
        <>
          <button
            type="button"
            className="font-title mt-2 cursor-pointer text-4xl font-black tracking-tight text-base-content sm:text-5xl"
            data-testid="party-title"
            onClick={() => void copyInvite()}
            disabled={inviteUrl === null}
            title={inviteUrl === null ? pageTitle : "Copy the invite link"}
            aria-label={`Party title ${pageTitle}`}
          >
            {pageTitle}
          </button>
          {/* 7.47: phonetic words stay lowercase ("(xray alpha bravo
              yankee)") — the `uppercase` class is intentionally absent. */}
          {!disablePhonetic ? (
            <p className="text-xs font-semibold tracking-widest text-base-content/60">
              ({phoneticSpelling(code ?? "")})
            </p>
          ) : null}
        </>
      ) : null}
    </header>
  );
}
