import {
  ArrowLeft,
  Check,
  Copy,
  Crown,
  Gamepad2,
  Loader2,
  LogOut,
  PartyPopper,
  Pencil,
  Play,
  QrCode,
  ShieldQuestion,
  Users,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import type { BrowseEntry } from "../../lib/browse";
import { writeToClipboard } from "../../lib/editor/clipboard";
import type { PartyEngineState, PartyMemberView } from "../../lib/party/engine";
import { Button } from "../ui/Button";
import { GameBrowser } from "./GameBrowser";
import { PartyDiagnosticsPanel } from "./PartyDiagnostics";
import { PartyInviteQr } from "./PartyInviteQr";

export interface PartyLobbyProps {
  state: PartyEngineState;
  onApprove: (memberId: string) => void;
  onReject: (memberId: string) => void;
  onStart: (force: boolean) => void;
  onLeave: () => void;
  onRefreshDiagnostics: () => void;
  /** Pick a saved game for a party that was started without one (7.6). */
  onPickGame: (gameId: string) => void;
  /** Pick a prebuilt classic/nova game via the shared browse UI (7.43). */
  onPickPrebuilt: (entry: BrowseEntry) => void;
  /** Kick a member from the party (host only, 7.29). */
  onKickMember: (memberId: string) => void;
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
 *
 * The lobby has no game preview (7.38 — classic parity); the host browses
 * games through the SHARED game browser (7.43) rendered inline in pick
 * mode, instead of the old bespoke picker dialog.
 */
export function PartyLobby({
  state,
  onApprove,
  onReject,
  onStart,
  onLeave,
  onRefreshDiagnostics,
  onPickGame,
  onPickPrebuilt,
  onKickMember,
  onEditName,
}: PartyLobbyProps) {
  const [forceDialog, setForceDialog] = useState(false);
  // 7.43: "Browse games" swaps the lobby for the shared browse UI (pick
  // mode) until the host picks a game or goes back.
  const [browsing, setBrowsing] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(state.displayName);
  // 10.5: the QR code lives behind a modal; the invite URL is never
  // rendered as text (only the origin + code page title is).
  const [qrOpen, setQrOpen] = useState(false);

  const greeterName =
    state.members.find((member) => member.memberId === state.greeterMemberId)?.displayName ??
    state.greeterMemberId ??
    "—";

  // The lobby page title: origin + four-letter code, e.g. "rocketcrab.com/abcd".
  // The full invite URL (with the session secret in the fragment) is never
  // shown on the page (ADR-0011 / 10.5).
  const pageTitle =
    state.code === null ? null : `${window.location.host}/${state.code.toLowerCase()}`;

  // 10.5: the browser tab reads the origin + code page title (never the
  // invite URL with its fragment secret). Restore on unmount.
  useEffect(() => {
    if (pageTitle === null) return;
    const previous = document.title;
    document.title = pageTitle;
    return () => {
      document.title = previous;
    };
  }, [pageTitle]);

  const copyInvite = async () => {
    if (state.inviteUrl === null) return;
    const ok = await writeToClipboard(state.inviteUrl);
    if (ok) {
      toast.success("Invite link copied.");
    } else {
      toast.error("Couldn't copy the link — try again.");
    }
  };

  const handlePickFromBrowse = (pick: () => void) => {
    setBrowsing(false);
    pick();
  };

  if (browsing) {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
        <section aria-label="Pick a game" className="flex flex-col gap-3">
          <button
            type="button"
            className="btn btn-outline btn-sm w-fit"
            onClick={() => setBrowsing(false)}
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Back to lobby
          </button>
          <GameBrowser
            compact
            onPick={(entry) => handlePickFromBrowse(() => onPickPrebuilt(entry))}
            onPickSaved={(gameId) => handlePickFromBrowse(() => onPickGame(gameId))}
          />
        </section>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
      {/* 10.5: the invite card — get your friends in via URL or QR. The QR
          is NOT shown on the page; it opens in a modal. Only the origin +
          code are ever rendered (ADR-0011: the session secret stays in the
          URL fragment, never on the page). */}
      <section
        aria-label="Invite your friends"
        className="flex flex-col items-center gap-3 rounded-box border-2 border-base-300 bg-base-100 p-5 text-center"
      >
        <h2 className="text-lg font-black">Get your friends to join!</h2>
        {pageTitle !== null ? (
          <p className="font-mono text-sm font-bold text-primary">{pageTitle}</p>
        ) : null}
        <div className="flex items-center justify-center gap-2">
          <Button variant="primary" size="md" onClick={() => void copyInvite()}>
            <Copy className="h-4 w-4" aria-hidden="true" />
            Copy URL
          </Button>
          <Button
            variant="outline"
            size="md"
            onClick={() => setQrOpen(true)}
            disabled={state.inviteUrl === null}
          >
            <QrCode className="h-4 w-4" aria-hidden="true" />
            QR Code
          </Button>
        </div>
      </section>

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
            className="btn btn-xs"
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
          <Button variant="outline" size="md" onClick={() => setEditingName(false)}>
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
                  variant="outline"
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
                  {state.role === "creator" && !member.isSelf ? (
                    <button
                      type="button"
                      className="btn btn-xs text-error"
                      onClick={() => onKickMember(member.memberId)}
                      title={`Remove ${member.displayName} from the party`}
                    >
                      <X className="h-3 w-3" aria-hidden="true" />
                      Kick
                    </button>
                  ) : null}
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
          <Button variant="secondary" size="lg" onClick={() => setBrowsing(true)}>
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

      {/* The QR invite modal (10.5): the QR lives here, not on the lobby.
          The full invite URL is encoded in the QR only; the label under it
          is the safe origin + code form. */}
      {qrOpen && state.inviteUrl !== null ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Party QR code"
        >
          <div className="flex w-full max-w-sm flex-col items-center gap-4 rounded-box border-2 border-base-300 bg-base-100 p-5">
            <p className="font-black">Scan to join the party</p>
            <PartyInviteQr inviteUrl={state.inviteUrl} size={200} label={pageTitle ?? undefined} />
            <Button variant="outline" onClick={() => setQrOpen(false)}>
              Close
            </Button>
          </div>
        </div>
      ) : null}

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
              <Button variant="outline" onClick={() => setForceDialog(false)}>
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
    </div>
  );
}
