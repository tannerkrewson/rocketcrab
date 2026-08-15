import { ScrollText } from "lucide-react";
import { useRef } from "react";
import { toast } from "sonner";
import { writeToClipboard } from "../../lib/editor/clipboard";
import { buildMasterPrompt, buildMasterPromptWithGame } from "../../lib/prompt/master-prompt";
import { buttonStyles } from "../ui/Button";

export interface PromptExportMenuProps {
  /** The current editor source, embedded in the "Prompt + my game" copy. */
  source: string;
  /** The current game title (omitted when blank). */
  title?: string;
}

/**
 * The "Copy prompt" dropdown (Task 3): copies either the raw master prompt
 * or the master prompt extended with the current game source, using the
 * same writeToClipboard + toast pattern as the Build page.
 */
export function PromptExportMenu({ source, title }: PromptExportMenuProps) {
  const detailsRef = useRef<HTMLDetailsElement | null>(null);

  const copy = async (text: string, successMessage: string) => {
    const ok = await writeToClipboard(text);
    if (ok) {
      toast.success(successMessage);
    } else {
      toast.error("Couldn't copy the prompt — your browser may need clipboard permission.");
    }
    // Close the dropdown after the action.
    detailsRef.current?.removeAttribute("open");
  };

  return (
    <details ref={detailsRef} className="dropdown dropdown-end" data-testid="prompt-export-menu">
      <summary
        className={buttonStyles("default", "md", undefined, true)}
        title="Copy the master prompt, or the prompt plus your current game code"
      >
        <ScrollText className="h-4 w-4" aria-hidden="true" />
        Copy prompt
      </summary>
      <ul className="dropdown-content menu z-50 w-64 rounded-box border-2 border-base-300 bg-base-100 p-2 shadow-lg">
        <li>
          <button
            type="button"
            onClick={() =>
              void copy(buildMasterPrompt(), "Master prompt copied to your clipboard.")
            }
          >
            Master prompt
          </button>
        </li>
        <li>
          <button
            type="button"
            onClick={() =>
              void copy(
                buildMasterPromptWithGame(source, title),
                "Prompt with your game copied to your clipboard.",
              )
            }
          >
            Prompt + my game
          </button>
        </li>
      </ul>
    </details>
  );
}
