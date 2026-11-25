import { Link } from "@tanstack/react-router";
import { Copy, Ellipsis, PartyPopper, Pencil, Trash2 } from "lucide-react";
import { useRef } from "react";
import type { SavedGame } from "@rocketcrab/core";
import { buttonStyles } from "../ui/Button";

export interface GameCardProps {
  game: SavedGame;
  onDuplicate: () => void;
  onDelete: () => void;
  /** Disable row actions while another row mutation is in flight. */
  busy?: boolean;
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/**
 * A saved game in My games: its title, one quiet line of context, and the
 * two things people do with it (play, edit). Duplicate and Delete sit in a
 * small menu. The caller must confirm deletion before invoking onDelete.
 */
export function GameCard({ game, onDuplicate, onDelete, busy = false }: GameCardProps) {
  const menuRef = useRef<HTMLDetailsElement | null>(null);
  const closeMenu = () => menuRef.current?.removeAttribute("open");

  const details = [`Edited ${formatDate(game.updatedAt)}`];
  if (game.copiedFrom?.sharedBy) details.push(`from ${game.copiedFrom.sharedBy}`);

  return (
    <article className="glass flex flex-col gap-4 rounded-2xl p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <Link
            to="/game/$gameId"
            params={{ gameId: game.id }}
            className="truncate text-xl font-black hover:underline"
          >
            {game.title}
          </Link>
          <p className="text-sm font-semibold text-foreground/50">
            {details.join(" · ")}
            {game.lastTestSucceeded === false ? (
              <span className="text-warning"> · Last test failed</span>
            ) : null}
          </p>
        </div>
        <details ref={menuRef} className="relative shrink-0">
          <summary
            className={buttonStyles("default", "sm", "list-none", true)}
            aria-label={`More actions for ${game.title}`}
            title="More actions"
          >
            <Ellipsis className="h-4 w-4" aria-hidden="true" />
          </summary>
          <ul
            role="menu"
            className="absolute right-0 z-50 mt-1 flex w-44 list-none flex-col gap-0.5 rounded-2xl bg-overlay p-1.5 shadow-overlay"
          >
            <li>
              <button
                type="button"
                role="menuitem"
                disabled={busy}
                className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm font-bold hover:bg-surface-secondary disabled:opacity-50"
                onClick={() => {
                  closeMenu();
                  onDuplicate();
                }}
              >
                <Copy className="h-4 w-4" aria-hidden="true" />
                Duplicate
              </button>
            </li>
            <li>
              <button
                type="button"
                role="menuitem"
                disabled={busy}
                className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm font-bold hover:bg-surface-secondary disabled:opacity-50"
                onClick={() => {
                  closeMenu();
                  onDelete();
                }}
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
                Delete
              </button>
            </li>
          </ul>
        </details>
      </div>
      <div className="button-row">
        <Link
          to="/party"
          search={{ gameId: game.id, title: game.title }}
          className={buttonStyles("primary", "md")}
          title="Start a party with this game"
        >
          <PartyPopper className="h-4 w-4" aria-hidden="true" />
          Start party
        </Link>
        <Link
          to="/games/$gameId/edit"
          params={{ gameId: game.id }}
          className={buttonStyles("default", "md", undefined, true)}
        >
          <Pencil className="h-4 w-4" aria-hidden="true" />
          Edit
        </Link>
      </div>
    </article>
  );
}
