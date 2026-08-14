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
 * Classic-style party shell header (7.22): the rocket + crab logo with a
 * large mono room code that copies the invite link on click, and the
 * lowercase phonetic spelling of the code underneath — the classic
 * rocketcrab MainTitle ported to Nova's shell.
 *
 * The invite details (QR / URL / copy row) live in the lobby's invite card
 * (10.5) instead of the header: the header stays the classic identity —
 * big code + phonetic only. Only the code and origin are ever rendered; the
 * full invite URL (session secret) never appears on the page (ADR-0011).
 */
export function PartyShellHeader({
  code,
  inviteUrl,
  disablePhonetic = false,
}: PartyShellHeaderProps) {
  const copyInvite = async () => {
    if (inviteUrl === null || inviteUrl === undefined) return;
    const ok = await writeToClipboard(inviteUrl);
    if (ok) {
      toast.success("Invite link copied.");
    } else {
      toast.error("Couldn't copy the link — try the Copy URL button in the lobby.");
    }
  };

  return (
    <header className="flex flex-col items-center gap-1 py-3 text-center">
      <p className="text-4xl leading-none" aria-hidden="true">
        🦀🚀
      </p>
      {code !== null && code !== undefined ? (
        <>
          <button
            type="button"
            className="mt-2 font-mono text-4xl font-black tracking-[0.25em] text-primary sm:text-5xl"
            data-testid="party-code"
            onClick={() => void copyInvite()}
            disabled={inviteUrl === null}
            title={inviteUrl === null ? code : "Copy the invite link"}
            aria-label={`Party code ${code}`}
          >
            {code}
          </button>
          {/* 7.47: phonetic words stay lowercase ("(xray alpha bravo
              yankee)") — the `uppercase` class is intentionally absent. */}
          {!disablePhonetic ? (
            <p className="text-xs font-semibold tracking-widest text-base-content/60">
              ({phoneticSpelling(code)})
            </p>
          ) : null}
        </>
      ) : null}
    </header>
  );
}
