import { CopyPlus, Ellipsis, ScrollText, Undo2 } from "lucide-react";
import { useRef, type ReactNode } from "react";
import { toast } from "../../lib/toast";
import { writeToClipboard } from "../../lib/editor/clipboard";
import { buildMasterPrompt, buildMasterPromptWithGame } from "../../lib/prompt/master-prompt";
import { buttonStyles } from "../ui/Button";

export interface EditorMoreMenuProps {
  /** The current editor source, embedded in "AI prompt + my game". */
  source: string;
  title?: string;
  /** Omitted when there is nothing to copy. */
  onSaveAsCopy?: () => void;
  /** Omitted when there are no unsaved changes to a saved game. */
  onDiscardChanges?: () => void;
}

function Item({
  icon,
  children,
  onClick,
  danger = false,
}: {
  icon: ReactNode;
  children: ReactNode;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <li>
      <button
        type="button"
        role="menuitem"
        className={`flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm font-bold hover:bg-surface-secondary ${danger ? "text-danger" : ""}`}
        onClick={onClick}
      >
        {icon}
        {children}
      </button>
    </li>
  );
}

/** The editor's secondary actions, kept out of the main toolbar. */
export function EditorMoreMenu({
  source,
  title,
  onSaveAsCopy,
  onDiscardChanges,
}: EditorMoreMenuProps) {
  const detailsRef = useRef<HTMLDetailsElement | null>(null);
  const close = () => detailsRef.current?.removeAttribute("open");

  const copy = async (text: string, successMessage: string) => {
    close();
    const ok = await writeToClipboard(text);
    if (ok) {
      toast.success(successMessage);
    } else {
      toast.danger("Couldn't copy the prompt — your browser may need clipboard permission.");
    }
  };

  return (
    <details ref={detailsRef} className="relative" data-testid="editor-more-menu">
      <summary
        className={buttonStyles("default", "md", "list-none", true)}
        aria-label="More actions"
        title="More actions"
      >
        <Ellipsis className="h-4 w-4" aria-hidden="true" />
        More
      </summary>
      <ul
        role="menu"
        className="absolute right-0 z-50 mt-1 flex w-64 list-none flex-col gap-0.5 rounded-2xl bg-overlay p-1.5 shadow-overlay"
      >
        <Item
          icon={<ScrollText className="h-4 w-4" aria-hidden="true" />}
          onClick={() => void copy(buildMasterPrompt(), "AI prompt copied to your clipboard.")}
        >
          Copy AI prompt
        </Item>
        {source.trim().length > 0 ? (
          <Item
            icon={<ScrollText className="h-4 w-4" aria-hidden="true" />}
            onClick={() =>
              void copy(
                buildMasterPromptWithGame(source, title),
                "AI prompt with your game copied to your clipboard.",
              )
            }
          >
            Copy AI prompt + my game
          </Item>
        ) : null}
        {onSaveAsCopy !== undefined ? (
          <Item
            icon={<CopyPlus className="h-4 w-4" aria-hidden="true" />}
            onClick={() => {
              close();
              onSaveAsCopy();
            }}
          >
            Save as a copy
          </Item>
        ) : null}
        {onDiscardChanges !== undefined ? (
          <Item
            danger
            icon={<Undo2 className="h-4 w-4" aria-hidden="true" />}
            onClick={() => {
              close();
              onDiscardChanges();
            }}
          >
            Discard unsaved changes
          </Item>
        ) : null}
      </ul>
    </details>
  );
}
