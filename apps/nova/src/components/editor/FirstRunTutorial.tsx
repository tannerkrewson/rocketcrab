import { GraduationCap } from "lucide-react";
import { useState } from "react";
import { Button } from "../ui/Button";

const STORAGE_KEY = "nova:editor-tutorial-dismissed:v1";

/**
 * First-run tutorial for the consolidated editor (7.44): a dismissible card
 * that walks a brand-new user through the editor's four core actions —
 * write, run, test multiplayer, save. Dismissal is remembered per browser
 * (localStorage), so returning creators never see it again.
 */
export function FirstRunTutorial() {
  const [visible, setVisible] = useState(() => {
    try {
      return window.localStorage.getItem(STORAGE_KEY) === null;
    } catch {
      return true;
    }
  });

  const dismiss = () => {
    try {
      window.localStorage.setItem(STORAGE_KEY, "1");
    } catch {
      // localStorage unavailable (private mode): dismiss for this visit.
    }
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <div
      className="flex flex-col gap-3 rounded-box border-2 border-primary/40 bg-base-100 p-4"
      data-testid="first-run-tutorial"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <h2 className="flex items-center gap-2 text-lg font-black">
            <GraduationCap className="h-5 w-5 text-primary" aria-hidden="true" />
            New to Nova? Here's how the editor works
          </h2>
          <ol className="list-decimal space-y-1.5 pl-5 text-sm leading-relaxed text-base-content/80">
            <li>
              Write your game's HTML here — or copy the <b>master prompt</b> on the Build page and
              let an AI write the first draft.
            </li>
            <li>
              Press <b>Run</b> to apply your code to the live test arena below and check the errors
              panel for problems.
            </li>
            <li>
              The arena simulates several players on this page, so you can watch how the game
              behaves in a party as you build. Edit the code and press <b>Run</b> again to re-test.
            </li>
            <li>
              Press <b>Save</b> to keep your game, or <b>Play with friends</b> to launch a real
              party.
            </li>
          </ol>
        </div>
        <Button variant="primary" size="md" onClick={dismiss}>
          Got it
        </Button>
      </div>
    </div>
  );
}
