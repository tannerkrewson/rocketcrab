import { writeToClipboard } from "../../lib/editor/clipboard";
import { partyCodeUrl, phoneticCode } from "../../lib/party/party-code";
import { toast } from "../../lib/toast";
import { BrandHeader } from "../layout/BrandHeader";
import { BrandLogo } from "../layout/BrandLogo";

export async function copyPartyCodeUrl(code: string): Promise<void> {
  if (await writeToClipboard(partyCodeUrl(code))) toast.success("Party link copied.");
  else toast.danger("Couldn't copy the link — try again.");
}

/** The compact brand row for party pages without an address (name step, loading). */
export function PartyShellHeader() {
  return (
    <header className="flex justify-center py-3">
      <BrandHeader />
    </header>
  );
}

/**
 * The party's address, `rocketcrab.com/abcd`, laid out like the home title:
 * logo on top, the address as wide as the screen allows (capped at the home
 * title's size) so friends can read it off a held-up phone, and its spelling
 * below. Tap to copy. Before the code arrives it shows the bare brand, and
 * the spelling line keeps its height so nothing jumps.
 * Attributes never name the code; session replay records them.
 */
export function PartyAddressHeader({ code }: { code: string | null }) {
  const address = (
    <>
      rocketcrab<span className="text-primary">.com</span>
      {code === null ? null : `/${code}`}
    </>
  );
  // Inconsolata glyphs are 0.5em wide, so 19 characters span 9.5em: size the
  // text to the header's width (container units) with a little margin.
  const size = "font-title text-[2.5rem] font-black leading-none text-[min(10cqi,3rem)]";
  return (
    <header
      className="@container mx-auto flex w-full max-w-xl flex-col items-center gap-3 py-3 text-center"
      data-testid="browser-brand-row"
    >
      <BrandLogo />
      {code === null ? (
        <p className={size}>{address}</p>
      ) : (
        <button
          type="button"
          aria-label="Copy the party link"
          title="Copy the party link"
          className={`${size} rounded-lg text-foreground transition-transform active:scale-95 focus-visible:outline-2 focus-visible:outline-focus motion-reduce:transition-none`}
          onClick={() => void copyPartyCodeUrl(code)}
        >
          {address}
        </button>
      )}
      <p className="text-lg italic text-foreground/70">
        {code === null ? " " : `(${phoneticCode(code)})`}
      </p>
    </header>
  );
}
