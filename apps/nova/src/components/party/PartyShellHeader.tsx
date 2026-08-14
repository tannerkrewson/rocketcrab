import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { writeToClipboard } from "../../lib/editor/clipboard";
import { phoneticSpelling } from "../../lib/party/phonetic";
import { Button } from "../ui/Button";
import { PartyInviteQr } from "./PartyInviteQr";

export interface PartyShellHeaderProps {
  /** Four-letter party code; omit (or null) for the bare logo header. */
  readonly code?: string | null;
  /** Full invite URL (session secret lives in the fragment; ADR-0011). */
  readonly inviteUrl?: string | null;
  /** Show the invite QR + URL + copy row under the code (Nova-only). */
  readonly showInviteDetails?: boolean;
  /** Hide the phonetic spelling (classic's join page does this). */
  readonly disablePhonetic?: boolean;
}

/**
 * Classic-style party shell header (7.22): the rocket + crab logo with a
 * large mono room code that copies the invite link on click, and the
 * phonetic spelling of the code underneath — the classic rocketcrab
 * MainTitle ported to Nova's shell. Nova-only invite details (QR + URL +
 * copy button) render below when requested, replacing the lobby's old
 * standalone invite card.
 */
export function PartyShellHeader({
  code,
  inviteUrl,
  showInviteDetails = false,
  disablePhonetic = false,
}: PartyShellHeaderProps) {
  const [copied, setCopied] = useState(false);

  const copyInvite = async () => {
    if (inviteUrl === null || inviteUrl === undefined) return;
    const ok = await writeToClipboard(inviteUrl);
    if (ok) {
      setCopied(true);
      toast.success("Invite link copied.");
      window.setTimeout(() => setCopied(false), 2_000);
    } else {
      toast.error("Couldn't copy the link — select it below and copy manually.");
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
          {inviteUrl !== null && inviteUrl !== undefined && showInviteDetails ? (
            <div className="mt-3 flex w-full flex-col items-center gap-3">
              <PartyInviteQr inviteUrl={inviteUrl} size={112} />
              <div className="flex w-full max-w-md flex-col gap-2">
                <Button variant="secondary" onClick={() => void copyInvite()}>
                  {copied ? (
                    <>
                      <Check className="h-4 w-4" aria-hidden="true" />
                      Copied
                    </>
                  ) : (
                    <>
                      <Copy className="h-4 w-4" aria-hidden="true" />
                      Copy invite link
                    </>
                  )}
                </Button>
              </div>
              <p className="text-center text-xs text-base-content/60">
                The invite link is the fastest way in; the four-letter code works too (you approve
                each person).
              </p>
            </div>
          ) : null}
        </>
      ) : null}
    </header>
  );
}
