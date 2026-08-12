import { Link } from "@tanstack/react-router";
import {
  Check,
  Crown,
  Gamepad2,
  Loader2,
  LogOut,
  PartyPopper,
  Pencil,
  Play,
  ShieldQuestion,
  Users,
  X,
} from "lucide-react";
import { useState } from "react";
import type { PartyEngineState, PartyMemberView } from "../../lib/party/engine";
import { useSavedGames } from "../../lib/games/queries";
import { Button, buttonStyles } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { ErrorPanel } from "../ui/ErrorPanel";
import { LoadingState } from "../ui/LoadingState";
import { PartyDiagnosticsPanel } from "./PartyDiagnostics";

export interface PartyLobbyProps {
  state: PartyEngineState;
  onApprove: (memberId: string) => void;
  onReject: (memberId: string) => void;
  onStart: (force: boolean) => void;
  onLeave: () => void;
  onRefreshDiagnostics: () => void;
  /** Pick a saved game for a party that was started without one (7.6). */
  onPickGame: (gameId: string) => void;
  /** Apply an edited player name (7.5). */
  onEditName: (name: string) => void;
}

function connectionBadge(member: PartyMemberView) {
  if (!member.connected) {
    return <span className="badge badge-error badge-sm">Disconnected</span>;
  }
  return <span className="badge badge-success badge-sm">Connected</span>;
}

function transferBadge(member: PartyMemberView) {
  switch (member.transferState) {
    case "complete":
      return <span className="badge badge-success badge-sm">Game ready</span>;
    case "transferring":
      return (
        <span className="badge badge-info badge-sm" title={member.transferDetail ?? undefined}>
          <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
          Transferring
        </span>
      );
    case "failed":
      return (
        <span className="badge badge-error badge-sm" title={member.transferDetail ?? undefined}>
          Failed
        </span>
      );
    case "incompatible":
      return (
        <span className="badge badge-error badge-sm" title={member.transferDetail ?? undefined}>
          Incompatible
        </span>
      );
    case "waiting":
    case "none":
      return <span className="badge badge-ghost badge-sm">Waiting for game</span>;
  }
}

function readyBadge(member: PartyMemberView) {
  return member.ready ? (
    <span className="badge badge-accent badge-sm">Ready</span>
  ) : (
    <span className="badge badge-ghost badge-sm">Not ready</span>
  );
}

/**
 * The party lobby (P4): the large four-letter code, QR + invite link,
 * the player list with per-player transfer and ready state, the current
 * greeter, the current internal authority (DIAGNOSTIC ONLY), start /
 * force-start / leave controls, and connection diagnostics. The party
 * creator, greeter, and authority are deliberately shown as separate roles.
 */
export function PartyLobby({
  state,
  onApprove,
  onReject,
  onStart,
  onLeave,
  onRefreshDiagnostics,
  onPickGame,
  onEditName,
}: PartyLobbyProps) {
  const [forceDialog, setForceDialog] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(state.displayName);

  const greeterName =
    state.members.find((member) => member.memberId === state.greeterMemberId)?.displayName ??
    state.greeterMemberId ??
    "—";

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
      {/* Classic-style party status card (7.4): what's selected and whose
          turn it is to act — the lobby's main heading. */}
      <header
        className="flex flex-wrap items-center gap-3 rounded-box border-2 border-base-300 bg-base-100 p-4"
        aria-label="Party status"
      >
        <div className="min-w-0 flex-1">
          <p className="text-xl font-black">
            {state.game !== null ? (
              state.role === "creator" ? (
                <>
                  You&apos;ve selected: <span className="text-primary">“{state.game.title}”</span>
                </>
              ) : (
                <>“{state.game.title}” has been selected</>
              )
            ) : (
              "Welcome to Rocketcrab!"
            )}
          </p>
          <p className="text-sm text-base-content/70">
            {state.game !== null
              ? state.role === "creator"
                ? "As the host, you have to start the game!"
                : "Waiting for the host to start…"
              : state.role === "creator"
                ? "As the host, you must select the game!"
                : "Waiting for the host to select a game…"}
          </p>
        </div>
        <span
          className="badge badge-ghost badge-sm"
          title={`Connection state: ${state.connectionState}`}
        >
          {state.connectionState}
        </span>
      </header>

      {/* Player name, editable (7.5 — classic parity: the name is asked
          before the lobby and can be changed at any time). */}
      <section className="flex flex-wrap items-center gap-2 text-sm font-semibold text-base-content/70">
        <span>
          You are playing as{" "}
          <span className="font-black text-base-content">{state.displayName}</span>
        </span>
        {editingName ? null : (
          <button
            type="button"
            className="btn btn-ghost btn-xs"
            onClick={() => {
              setNameDraft(state.displayName);
              setEditingName(true);
            }}
          >
            <Pencil className="h-3 w-3" aria-hidden="true" />
            Edit name
          </button>
        )}
      </section>
      {editingName ? (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const trimmed = nameDraft.trim();
            if (trimmed.length > 0) {
              onEditName(trimmed);
            }
            setEditingName(false);
          }}
        >
          <input
            type="text"
            value={nameDraft}
            onChange={(event) => setNameDraft(event.target.value)}
            maxLength={24}
            aria-label="Your player name"
            className="input input-bordered input-sm min-w-40 flex-1"
          />
          <Button variant="primary" size="md" type="submit">
            Save
          </Button>
          <Button variant="ghost" size="md" onClick={() => setEditingName(false)}>
            Cancel
          </Button>
        </form>
      ) : null}

      {/* No game selected yet (7.6): the host picks one via the action
          row's Browse games button; joiners wait. */}
      {state.game === null ? (
        <section
          className="flex flex-wrap items-center gap-3 rounded-box border-2 border-dashed border-base-300 bg-base-100 p-4"
          aria-label="No game selected"
        >
          <p className="min-w-0 flex-1 text-sm font-semibold text-base-content/70">
            {state.role === "creator"
              ? "No game yet — pick one from your saved games to start playing."
              : "Waiting for the host to pick a game…"}
          </p>
        </section>
      ) : null}

      {state.endedReason !== null ? (
        <div className="rounded-box border-2 border-accent bg-accent/10 p-3 text-sm font-semibold">
          The game ended{state.endedReason === undefined ? "." : ` (${state.endedReason}).`} The
          party is still open — leave when you&apos;re done.
        </div>
      ) : null}

      {/* The big code + invite (QR, URL, copy) now live in the classic
          party shell header (7.22) rendered by PartyExperience. */}

      {/* Roles: greeter + authority are separate (ADR-0004/0007). */}
      <section className="flex flex-wrap items-center gap-2 text-sm font-semibold text-base-content/70">
        <span className="badge badge-ghost badge-sm" title="Rendezvous greeter (ADR-0004)">
          <Crown className="mr-1 h-3 w-3" aria-hidden="true" />
          Greeter: {greeterName}
          {state.amGreeter ? " · you" : ""}
        </span>
        <span
          className="badge badge-ghost badge-sm"
          title="Current internal authority — diagnostic only; S3 formalizes authority"
        >
          <ShieldQuestion className="mr-1 h-3 w-3" aria-hidden="true" />
          Authority (diagnostic):{" "}
          {state.members.find((member) => member.memberId === state.authorityMemberId)
            ?.displayName ?? "—"}
        </span>
      </section>

      {/* Join requests (greeter only). */}
      {state.amGreeter && state.pendingJoinRequests.length > 0 ? (
        <section
          className="flex flex-col gap-2 rounded-box border-2 border-primary/40 bg-base-100 p-4"
          aria-label="Join requests"
        >
          <p className="flex items-center gap-2 text-sm font-black">
            <Users className="h-4 w-4" aria-hidden="true" />
            Someone wants to join
          </p>
          <ul className="flex flex-col gap-2">
            {state.pendingJoinRequests.map((request) => (
              <li key={request.id} className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 flex-1 truncate font-bold">
                  {request.displayName || request.memberId}
                </span>
                <span className="font-mono text-xs text-base-content/60">{request.memberId}</span>
                <Button
                  variant="primary"
                  size="md"
                  onClick={() => onApprove(request.memberId)}
                  title="Admit this player"
                >
                  <Check className="h-4 w-4" aria-hidden="true" />
                  Approve
                </Button>
                <Button
                  variant="ghost"
                  size="md"
                  onClick={() => onReject(request.memberId)}
                  title="Refuse this player"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                  Reject
                </Button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* Player list with per-player transfer + ready status. */}
      {/* Classic collapsible Players card (7.4): badge count + per-player
          rows with transfer/ready state. Open by default. */}
      <details
        className="collapse collapse-arrow rounded-box border-2 border-base-300 bg-base-100"
        open
      >
        <summary className="collapse-title flex items-center gap-2 text-sm font-black uppercase tracking-widest text-base-content/60">
          Players ({state.members.length})
        </summary>
        <div className="collapse-content">
          <ul className="flex flex-col gap-2">
            {state.members.map((member) => (
              <li
                key={member.memberId}
                className="flex flex-col gap-2 rounded-box border-2 border-base-300 bg-base-100 p-3"
                data-testid={`party-member-${member.memberId}`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-black">
                    {member.displayName}
                    {member.isSelf ? <span className="text-base-content/50"> (you)</span> : null}
                  </span>
                  {member.isGreeter ? (
                    <span className="badge badge-secondary badge-sm" title="Rendezvous greeter">
                      Greeter
                    </span>
                  ) : null}
                  {connectionBadge(member)}
                  {transferBadge(member)}
                  {readyBadge(member)}
                </div>
                {member.transferProgress !== null && member.transferState === "transferring" ? (
                  <div className="flex items-center gap-2">
                    <progress
                      className="progress progress-info w-full"
                      value={member.transferProgress}
                      max={1}
                      aria-label={`Game transfer progress for ${member.displayName}`}
                    />
                    <span className="shrink-0 text-xs font-semibold text-base-content/60">
                      {member.transferDetail ?? `${Math.round(member.transferProgress * 100)}%`}
                    </span>
                  </div>
                ) : member.transferDetail !== null ? (
                  <p className="text-xs text-base-content/60">{member.transferDetail}</p>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      </details>

      {/* Notices (a failed peer never freezes the lobby). */}
      {state.notices.length > 0 ? (
        <ul className="flex flex-col gap-1 text-xs" aria-label="Lobby notices">
          {state.notices.map((notice) => (
            <li
              key={notice.id}
              className={
                notice.level === "error"
                  ? "text-error"
                  : notice.level === "warn"
                    ? "text-warning"
                    : "text-base-content/60"
              }
            >
              {notice.message}
            </li>
          ))}
        </ul>
      ) : null}

      {/* Classic action row (7.4): Browse games (host) + Start game, with
          force-start and leave alongside. */}
      <section className="flex flex-wrap items-center gap-2">
        {state.role === "creator" ? (
          <Button variant="secondary" size="lg" onClick={() => setPickerOpen(true)}>
            <Gamepad2 className="h-5 w-5" aria-hidden="true" />
            Browse games
          </Button>
        ) : null}
        <Button
          variant="primary"
          size="lg"
          disabled={!state.canStart}
          onClick={() => onStart(false)}
          title={state.startBlockedReason ?? "Start the game once every player is ready"}
        >
          <Play className="h-5 w-5" aria-hidden="true" />
          Start game
        </Button>
        {state.canForceStart ? (
          <Button variant="outline" size="lg" onClick={() => setForceDialog(true)}>
            <PartyPopper className="h-5 w-5" aria-hidden="true" />
            Start anyway
          </Button>
        ) : null}
        {state.canStart || state.canForceStart ? null : state.startBlockedReason !== null ? (
          <span className="text-xs font-semibold text-base-content/60">
            {state.startBlockedReason}
          </span>
        ) : null}
        <div className="flex-1" />
        <Button variant="danger" size="lg" onClick={onLeave}>
          <LogOut className="h-5 w-5" aria-hidden="true" />
          Leave party
        </Button>
      </section>

      <PartyDiagnosticsPanel diagnostics={state.diagnostics} onRefresh={onRefreshDiagnostics} />

      <div className="flex justify-center">
        <Link to="/library" className={buttonStyles("ghost")}>
          Back to games
        </Link>
      </div>

      {forceDialog ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Start before everyone is ready"
        >
          <div className="flex w-full max-w-sm flex-col gap-4 rounded-box border-2 border-base-300 bg-base-100 p-5">
            <p className="font-black">Start before everyone is ready?</p>
            <p className="text-sm text-base-content/70">
              Every player has the game, but not everyone has reported ready. Starting now means
              some players may miss the start signal. They can still rejoin.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setForceDialog(false)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={() => {
                  setForceDialog(false);
                  onStart(true);
                }}
              >
                Start anyway
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {pickerOpen ? (
        <Dialog open onClose={() => setPickerOpen(false)} title="Pick a game">
          <GamePicker
            onPick={(gameId) => {
              setPickerOpen(false);
              onPickGame(gameId);
            }}
          />
        </Dialog>
      ) : null}
    </div>
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong.";
}

/** Saved-game list for the lobby's pick-a-game dialog (7.6). */
function GamePicker({ onPick }: { onPick: (gameId: string) => void }) {
  const gamesQuery = useSavedGames();
  if (gamesQuery.isLoading) {
    return <LoadingState label="Loading your games…" />;
  }
  if (gamesQuery.isError) {
    return <ErrorPanel title="Couldn't load your games" message={errorMessage(gamesQuery.error)} />;
  }
  const games = gamesQuery.data ?? [];
  if (games.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-4 text-center">
        <p className="text-sm text-base-content/70">
          No saved games yet — create one in the editor first.
        </p>
        <Link to="/build" className={buttonStyles("primary", "md")}>
          Build a game
        </Link>
      </div>
    );
  }
  return (
    <ul className="flex max-h-96 flex-col gap-2 overflow-y-auto" aria-label="Saved games">
      {games.map((game) => (
        <li key={game.id}>
          <button
            type="button"
            onClick={() => onPick(game.id)}
            className="flex w-full items-center justify-between gap-2 rounded-box border border-base-300 bg-base-200 px-3 py-2 text-left hover:border-primary"
          >
            <span className="min-w-0 flex-1 truncate font-bold">{game.title}</span>
            <span className="badge badge-ghost badge-sm">{game.mode ?? "state"}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
