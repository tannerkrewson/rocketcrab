import { writeToClipboard } from "../../lib/editor/clipboard";
import { partyCodeUrl, phoneticCode } from "../../lib/party/party-code";
import { toast } from "../../lib/toast";
import { BrandHeader } from "../layout/BrandHeader";
import { BrandLogo } from "../layout/BrandLogo";

export async function copyPartyCodeUrl(code: string): Promise<void> {
  if (await writeToClipboard(partyCodeUrl(code))) toast.success("Party link copied.");
  else toast.danger("Couldn't copy the link — try again.");
}

/**
 * The party brand row. With a party code it becomes the party's address,
 * `rocketcrab.com/abcd`: tap to copy it, read the spelling below aloud.
 * Attributes never name the code; session replay records them.
 */
export function PartyShellHeader({ code = null }: { code?: string | null }) {
  if (code === null) {
    return (
      <header className="flex justify-center py-3">
        <BrandHeader />
      </header>
    );
  }
  return (
    <header className="flex flex-col items-center py-3">
      <div className="flex items-center justify-center gap-2" data-testid="browser-brand-row">
        <BrandLogo />
        <button
          type="button"
          aria-label="Copy the party link"
          title="Copy the party link"
          className="font-title rounded-lg text-xl font-black text-foreground transition-transform active:scale-95 focus-visible:outline-2 focus-visible:outline-focus motion-reduce:transition-none"
          onClick={() => void copyPartyCodeUrl(code)}
        >
          rocketcrab<span className="text-primary">.com</span>/{code}
        </button>
      </div>
      <p className="-mt-1 text-sm italic text-foreground/70">({phoneticCode(code)})</p>
    </header>
  );
}
