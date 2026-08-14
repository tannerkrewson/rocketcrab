import {
  ArrowLeft,
  BookOpen,
  Check,
  Clock3,
  Copy,
  Gamepad2,
  LogOut,
  PartyPopper,
  Pencil,
  Play,
  QrCode,
  Users,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { writeToClipboard } from "../../lib/editor/clipboard";
import type { PartyEngineState, PartyMemberView, PartyNotice } from "../../lib/party/engine";
import { Button } from "../ui/Button";
import { GameBrowser } from "./GameBrowser";
import { IdleParticles } from "./IdleParticles";
import { PartyDiagnosticsPanel } from "./PartyDiagnostics";
import { PartyGameDetailsModal } from "./PartyGameDetails";
import { PartyInviteQr } from "./PartyInviteQr";

export interface PartyLobbyProps {
  state: PartyEngineState;
  onApprove: (memberId: string) => void;
  onReject: (memberId: string) => void;
  onStart: (force: boolean) => void;
  onLeave: () => void;
  onRefreshDiagnostics: () => void;
  /** Kick a member from the party (host only, 7.29). */
  onKickMember: (memberId: string) => void;
  /** Apply an edited player name (7.5). */
  onEditName: (name: string) => void;
}

/** Per-player tile border colors (10.8): each player gets a distinct color. */
const PLAYER_BORDER_COLORS = [
  "border-primary",
  "border-secondary",
  "border-accent",
  "border-info",
  "border-success",
  "border-warning",
  "border-error",
] as const;

function playerBorderColor(index: number): string {
  return PLAYER_BORDER_COLORS[index % PLAYER_BORDER_COLORS.length] ?? "border-primary";
}

/** Comma-separated role labels for a player tile ("You, Host" style, 10.8). */
function roleLabels(member: PartyMemberView, isCreator: boolean): string {
  const labels: string[] = [];
  if (member.isSelf) labels.push("You");
  if (member.isSelf && isCreator) labels.push("Host");
  if (member.isGreeter && !member.isSelf) labels.push("Greeter");
  return labels.join(", ");
}

/** Tiny transfer-state indicator inside a player tile (10.8). */
function transferIndicator(member: PartyMemberView) {
  switch (member.transferState) {
    case "transferring":
      return (
        <progress
          className="progress progress-info h-1.5 w-16"
          value={member.transferProgress ?? 0}
          max={1}
          aria-label={`Game transfer progress for ${member.displayName}`}
        />
      );
    case "complete":
      return <span className="text-[10px] font-bold text-success">Game ready</span>;
    case "failed":
      return <span className="text-[10px] font-bold text-error">Failed</span>;
    case "incompatible":
      return <span className="text-[10px] font-bold text-error">Incompatible</span>;
    case "waiting":
    case "none":
      return <span className="text-[10px] font-bold text-base-content/40">Waiting for game</span>;
  }
}

/**
 * Unified copy for the ended-state banner (11.8): every "game ended"
 * variant (host_closed / user_exit / error / unknown) reads the same way,
 * with correct copy per reason — one banner owns all of them.
 */
function endedBannerText(reason: string): string {
  switch (reason) {
    case "host_closed":
      return "The game ended — the host closed it. The party is still open; leave when you're done.";
    case "error":
      return "The game ended due to an error. The party is still open — leave when you're done.";
    default:
      return "The game ended. The party is still open — leave when you're done.";
  }
}

/** True for engine end notices — owned by the ended-state banner (11.8). */
function isEndedNotice(message: string): boolean {
  return message.startsWith("The game ended");
}

/** Alert level classes for lobby notices (outline-styled per 9fv.11.3). */
const NOTICE_ALERT_LEVELS: Record<PartyNotice["level"], string> = {
  error: "alert-error",
  warn: "alert-warning",
  info: "alert-info",
};

/**
 * The party lobby (P4): the invite card (Copy URL / QR in a modal), the
 * welcome card with the selected game, the classic 2-column player grid
 * with per-player state, start / force-start / leave controls, and
 * connection diagnostics. Greeter and authority stay diagnostic (10.7) —
 * they live in the diagnostics panel and the engine state, not the lobby.
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
  // 10.6: "What is GameName?" opens an in-lobby details overlay.
  const [detailsOpen, setDetailsOpen] = useState(false);

  const greeterName =
    state.members.find((member) => member.memberId === state.greeterMemberId)?.displayName ??
    state.greeterMemberId ??
    null;
  // 10.7: greeter + authority are diagnostic (S3 formalizes authority); the
  // lobby itself does not show them — they stay accessible in the
  // diagnostics panel and the engine state.
  const authorityName =
    state.members.find((member) => member.memberId === state.authorityMemberId)?.displayName ??
    state.authorityMemberId ??
    null;

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

  // 11.8: the notice banner shows the LATEST relevant notice only (a
  // capped, deduped set from the engine) — never a growing list of
  // identical alerts. Once the game ended, the ended-state banner owns the
  // status area and the notice banner hides entirely.
  const latestNotice =
    state.endedReason !== null || state.notices.length === 0
      ? null
      : ([...state.notices].reverse().find((notice) => !isEndedNotice(notice.message)) ?? null);

  const copyInvite = async () => {
    if (state.inviteUrl === null) return;
    const ok = await writeToClipboard(state.inviteUrl);
    if (ok) {
      toast.success("Invite link copied.");
    } else {
      toast.error("Couldn't copy the link — try again.");
    }
  };

  if (browsing) {
    // 10.9: browse mode — selecting a game ALWAYS opens its details page
    // (/game/$gameId, saved games included); the pick happens there and
    // returns to /party. The lobby never sets the game directly.
    return (
      <div className="mx-auto flex w-full max-w-xl flex-col gap-4">
        <section aria-label="Pick a game" className="flex flex-col gap-3">
          <button
            type="button"
            className="btn btn-outline btn-sm w-fit"
            onClick={() => setBrowsing(false)}
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Back to lobby
          </button>
          <GameBrowser compact />
        </section>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-4">
      {/* 10.5: the invite card — get your friends in via URL or QR. The QR
          is NOT shown on the page; it opens in a modal. Only the origin +
          code are ever rendered (ADR-0011: the session secret stays in the
          URL fragment, never on the page). */}
      {/* 11.6: the title (origin + code) lives in the party shell header as
          ONE string — the invite card never renders it again (the code is
          never shown separately from the title). The card is the invite
          ACTION: Copy URL / QR only. */}
      <section
        aria-label="Invite your friends"
        className="flex flex-col items-center gap-3 rounded-box border-2 border-base-300 bg-base-100 p-5 text-center"
      >
        <h2 className="text-lg font-black">Get your friends to join!</h2>
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
      {/* 10.6: the welcome card — the lobby's main heading. A simple idle
          animation, then what's selected and whose turn it is to act.
          Guests see the host-starting copy; when nothing is selected the
          card just says so (the old empty-state sentence is gone). */}
      <section
        aria-label="Welcome"
        className="flex flex-col items-center gap-3 overflow-hidden rounded-box border-2 border-base-300 bg-base-100 p-5 text-center"
      >
        <IdleParticles />
        <h2 className="text-xl font-black">Welcome to rocketcrab!</h2>
        {state.game !== null ? (
          <>
            <p className="text-sm font-semibold text-base-content/70">You&apos;ve selected</p>
            <p className="text-2xl font-black text-primary">{state.game.title}</p>
            <p className="text-sm text-base-content/70">
              {state.role === "creator"
                ? "As the host, you have to start the game!"
                : "Waiting for the host to start the game…"}
            </p>
            <Button variant="outline" size="md" onClick={() => setDetailsOpen(true)}>
              <BookOpen className="h-4 w-4" aria-hidden="true" />
              What is {state.game.title}?
            </Button>
          </>
        ) : (
          <p className="text-sm text-base-content/70">No game selected yet</p>
        )}
      </section>
      {/* 11.8: ONE unified ended-state banner — every "game ended" variant
          (host_closed / user_exit / error) reads the same way with copy per
          reason; the engine's raw ended notices are filtered out of the
          notice banner below (this banner owns that state). */}
      {state.endedReason !== null ? (
        <div role="alert" className="alert alert-outline alert-info">
          <span className="text-sm font-semibold">{endedBannerText(state.endedReason)}</span>
        </div>
      ) : null}
      {/* 10.7: the greeter and authority role badges are gone from the
          lobby (diagnostic only) — see the diagnostics panel below. */}
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
      {/* 10.7: the action row (Browse games left, Start game right) sits
          ABOVE the players box, horizontally centered — leave is its own
          quiet control at the bottom of the page. */}
      <section className="flex flex-wrap items-center justify-center gap-2">
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
      </section>
      {/* The blocked-reason copy (10.7): shown as a styled warning alert;
          the "Pick a game before starting the party." message is gone —
          the welcome card covers the no-game case. The ended case is
          covered by the unified ended banner above (11.8). */}
      {state.game !== null &&
      state.endedReason === null &&
      !state.canStart &&
      !state.canForceStart &&
      state.startBlockedReason !== null ? (
        <div role="alert" className="alert alert-outline alert-warning mx-auto w-fit">
          <span className="text-sm font-semibold">{state.startBlockedReason}</span>
        </div>
      ) : null}
      {/* 10.8: the classic player grid — 2 columns of rounded tiles, each
          with a centered name, a pencil (own tile = edit name), a small
          role-labels line ("You, Host" style), a per-player border color,
          and tiny status indicators (connection, ready, transfer). */}
      <details
        className="collapse collapse-arrow rounded-box border-2 border-base-300 bg-base-100"
        open
      >
        <summary className="collapse-title flex items-center gap-2 text-sm font-black uppercase tracking-widest text-base-content/60">
          Players ({state.members.length})
        </summary>
        <div className="collapse-content">
          <ul className="grid grid-cols-2 gap-3">
            {state.members.map((member, index) => {
              const roleLabel = roleLabels(member, state.role === "creator");
              return (
                <li
                  key={member.memberId}
                  data-testid={`party-member-${member.memberId}`}
                  className={`flex min-w-0 flex-col items-center gap-1.5 rounded-box border-2 bg-base-100 p-3 text-center ${playerBorderColor(index)}`}
                >
                  {member.isSelf && editingName ? (
                    <form
                      className="flex w-full flex-col items-center gap-2"
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
                        className="input input-bordered input-sm w-full"
                      />
                      <div className="flex gap-2">
                        <Button variant="primary" size="md" type="submit">
                          Save
                        </Button>
                        <Button variant="outline" size="md" onClick={() => setEditingName(false)}>
                          Cancel
                        </Button>
                      </div>
                    </form>
                  ) : (
                    <>
                      <div className="flex w-full items-center justify-end gap-1.5 text-base-content/60">
                        {member.connected ? (
                          <span
                            title="Connected"
                            className="inline-block h-2 w-2 rounded-full bg-success"
                            aria-hidden="true"
                          />
                        ) : (
                          <span
                            title="Disconnected"
                            className="inline-block h-2 w-2 rounded-full bg-error"
                            aria-hidden="true"
                          />
                        )}
                        <span title={member.ready ? "Ready" : "Not ready"}>
                          {member.ready ? (
                            <Check className="h-3.5 w-3.5 text-success" aria-hidden="true" />
                          ) : (
                            <Clock3 className="h-3.5 w-3.5" aria-hidden="true" />
                          )}
                        </span>
                        {transferIndicator(member)}
                        {state.role === "creator" && !member.isSelf ? (
                          <button
                            type="button"
                            className="btn btn-xs text-error"
                            onClick={() => onKickMember(member.memberId)}
                            aria-label={`Kick ${member.displayName}`}
                          >
                            <X className="h-3 w-3" aria-hidden="true" />
                          </button>
                        ) : null}
                      </div>
                      <div className="flex min-w-0 items-center justify-center gap-1.5">
                        <p className="truncate font-black">{member.displayName}</p>
                        {member.isSelf ? (
                          <button
                            type="button"
                            className="btn btn-xs"
                            aria-label="Edit your name"
                            onClick={() => {
                              setNameDraft(state.displayName);
                              setEditingName(true);
                            }}
                          >
                            <Pencil className="h-3 w-3" aria-hidden="true" />
                          </button>
                        ) : null}
                      </div>
                      {roleLabel !== "" ? (
                        <p className="text-xs font-semibold text-base-content/60">{roleLabel}</p>
                      ) : null}
                      {member.transferDetail !== null && member.transferState !== "complete" ? (
                        <p
                          className="text-[10px] leading-tight text-base-content/50"
                          title={member.transferDetail}
                        >
                          {member.transferDetail}
                        </p>
                      ) : null}
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      </details>
      {/* Notices (11.8): ONE compact status banner showing the latest
          relevant notice instead of a growing list of identical alerts.
          Colored alerts are outline-styled, never solid (9fv.11.3). */}
      {latestNotice !== null ? (
        <div
          role="alert"
          className={`alert alert-outline ${NOTICE_ALERT_LEVELS[latestNotice.level]} mx-auto w-fit`}
        >
          <span className="text-sm font-semibold">{latestNotice.message}</span>
        </div>
      ) : null}
      <PartyDiagnosticsPanel
        diagnostics={state.diagnostics}
        onRefresh={onRefreshDiagnostics}
        greeterName={greeterName}
        authorityName={authorityName}
      />
      {/* 10.7: Leave party is a smaller, centered control at the very
          bottom of the page. */}
      <div className="flex justify-center">
        <Button variant="danger" size="md" onClick={onLeave}>
          <LogOut className="h-4 w-4" aria-hidden="true" />
          Leave party
        </Button>
      </div>
      {/* The QR invite modal (10.5): the QR lives here, not on the lobby.
          The full invite URL is encoded in the QR only; the label under it
          is the safe origin + code form. */}{" "}
      {detailsOpen ? (
        <PartyGameDetailsModal game={state.game} onClose={() => setDetailsOpen(false)} />
      ) : null}
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
