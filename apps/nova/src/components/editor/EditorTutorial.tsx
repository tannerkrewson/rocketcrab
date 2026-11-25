import { PartyPopper, Users, Wrench } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";

const STORAGE_KEY = "nova:editor-tutorial-dismissed:v1";

/** True until the player closes the tutorial once (then it only opens on request). */
export function shouldAutoOpenTutorial(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === null;
  } catch {
    return true;
  }
}

export function markTutorialSeen(): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, "1");
  } catch {
    // localStorage unavailable (private mode): it opens again next visit.
  }
}

function Step({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent/20 text-accent-soft-foreground"
        aria-hidden="true"
      >
        {icon}
      </span>
      <div className="min-w-0">
        <p className="font-black">{title}</p>
        <p className="text-sm leading-relaxed text-foreground/75">{children}</p>
      </div>
    </li>
  );
}

/** How the editor works, as a modal over the editor. Reopened from the header's help button. */
export function EditorTutorial({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onClose={onClose} title="How the Nova editor works" className="theme-nova">
      <div className="flex flex-col gap-5" data-testid="editor-tutorial">
        <ol className="flex flex-col gap-4">
          <Step icon={<Users className="h-4 w-4" />} title="Test it">
            The <b>Test</b> tab plays your game as several players side by side, so you can see how
            it behaves in a real party.
          </Step>
          <Step icon={<Wrench className="h-4 w-4" />} title="Fix problems">
            If something breaks, <b>Copy for AI</b> on the problems bar and paste that back to your
            AI. Paste its new version here.
          </Step>
          <Step icon={<PartyPopper className="h-4 w-4" />} title="Save and play">
            <b>Save</b> keeps it in My games. <b>Play with friends</b> saves it and starts a party.
          </Step>
        </ol>
        <Button variant="primary" className="self-end" onClick={onClose}>
          Got it
        </Button>
      </div>
    </Dialog>
  );
}
