import { Link } from "@tanstack/react-router";
import { Copy, FlaskConical, PartyPopper, Pencil, Trash2 } from "lucide-react";
import type { SavedGame } from "@rocketcrab/core";
import { Button, buttonStyles } from "../ui/Button";
import { Card } from "../ui/Card";

export interface GameCardProps {
  game: SavedGame;
  onDuplicate: () => void;
  onDelete: () => void;
  /** Disable row actions while another row mutation is in flight. */
  busy?: boolean;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString(undefined, { dateStyle: "medium" });
}

/** Test-status badge for a saved game. */
function TestStatusBadge({ game }: { game: SavedGame }) {
  if (game.lastTestedAt === undefined) {
    return <span className="badge badge-ghost badge-sm">Not tested</span>;
  }
  return (
    <span
      className={
        game.lastTestSucceeded ? "badge badge-success badge-sm" : "badge badge-error badge-sm"
      }
    >
      {game.lastTestSucceeded ? "Tests passed" : "Tests failed"} · {formatDate(game.lastTestedAt)}
    </span>
  );
}

/**
 * Library card for one saved game: metadata plus edit / test / duplicate /
 * delete actions. Edit and Test land on the U4 editor and U6 arena routes;
 * delete is confirmed by the caller (U2 acceptance: delete requires
 * confirmation).
 */
export function GameCard({ game, onDuplicate, onDelete, busy = false }: GameCardProps) {
  return (
    <Card
      title={game.title}
      description={game.description}
      actions={
        <>
          <Link
            to="/games/$gameId/edit"
            params={{ gameId: game.id }}
            className={buttonStyles("outline", "md")}
          >
            <Pencil className="h-4 w-4" aria-hidden="true" />
            Edit
          </Link>
          <Link
            to="/games/$gameId/test"
            params={{ gameId: game.id }}
            className={buttonStyles("secondary", "md")}
          >
            <FlaskConical className="h-4 w-4" aria-hidden="true" />
            Test
          </Link>
          <Link
            to="/party"
            search={{ gameId: game.id, mode: game.mode ?? "state", title: game.title }}
            className={buttonStyles("primary", "md")}
            title="Create a party from this game and play it with friends"
          >
            <PartyPopper className="h-4 w-4" aria-hidden="true" />
            Play
          </Link>
          <Button variant="ghost" onClick={onDuplicate} disabled={busy}>
            <Copy className="h-4 w-4" aria-hidden="true" />
            Duplicate
          </Button>
          <Button variant="danger" onClick={onDelete} disabled={busy}>
            <Trash2 className="h-4 w-4" aria-hidden="true" />
            Delete
          </Button>
        </>
      }
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs font-semibold text-base-content/60">
        <span>Updated {formatDate(game.updatedAt)}</span>
        <span>{formatBytes(game.sourceBytes)}</span>
        {game.mode ? <span className="badge badge-ghost badge-sm">{game.mode} mode</span> : null}
        <TestStatusBadge game={game} />
        <span className="font-mono" title={`Source SHA-256: ${game.sourceHash}`}>
          {game.sourceHash.slice(0, 12)}…
        </span>
      </div>
    </Card>
  );
}
