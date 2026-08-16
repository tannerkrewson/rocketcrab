import { Link } from "@tanstack/react-router";
import {
  BookOpen,
  Check,
  Copy,
  Gamepad2,
  LogOut,
  PartyPopper,
  Pencil,
  Play,
  QrCode,
  Share2,
  Users,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { writeToClipboard } from "../../lib/editor/clipboard";
import type { PartyEngineState, PartyMemberView, PartyNotice } from "../../lib/party/engine";
import { getSavedPlayerName } from "../../lib/party/identity";
import { Button, buttonStyles } from "../ui/Button";
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
  /** Retained for PartyExperience compatibility: the lobby no longer edits
   *  names inline (2t1.9) — the pencil opens /join?edit=name instead. */
  onEditName: (name: string) => void;
  /** 2t1.1: notify the shell when the lobby enters/leaves browse mode so
   *  the full-size party header can hide (GameBrowser owns the compact
   *  dimmed brand row while browsing). */
  onBrowseModeChange?: (browsing: boolean) => void;
  /** 5cl.7: open straight into browse mode (details-page back returns
   *  here via /party?browse=1; GameBrowser restores the category). */
  initialBrowsing?: boolean;
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

/** Comma-separated role labels for a player tile ("You, Host" style, 10.8).
 *  Users only ever see "host" (rocketcrab-rfk): the greeter IS the host —
 *  the creator is installed as the initial rendezvous greeter — so a host
 *  peer's tile reads "Host", never "Greeter". The greeter concept stays
 *  diagnostic-only (diagnostics panel + engine state). */
function roleLabels(member: PartyMemberView, isCreator: boolean): string {
  const labels: string[] = [];
  if (member.isSelf) labels.push("You");
  if (member.isSelf && isCreator) labels.push("Host");
  if (member.isGreeter && !member.isSelf) labels.push("Host");
  return labels.join(", ");
}

/**
 * Tiny transfer-state indicator inside a player tile (10.8 / 11.9,
 * redesigned 5cl.9): only genuinely operational states show — an
 * in-flight transfer bar, a failure, or an incompatibility. The always-
 * green "Game ready" badge is gone (has-the-game is the default end
 * state, and readiness belongs to the start flow, which the start button
 * + blocked reason already communicate), and the quiet "Waiting for
 * game" gap is gone too (5cl.9): waiting/none tiles render nothing. The
 * connection dot carries presence.
 */
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
    case "failed":
      return <span className="text-[10px] font-bold text-error">Failed</span>;
    case "incompatible":
      return <span className="text-[10px] font-bold text-error">Incompatible</span>;
    case "waiting":
    case "none":
      // 5cl.9: no status text while waiting — the connection dot carries
      // presence and the transfer bar appears only once it is moving.
      return null;
    case "complete":
      return null;
  }
}

/** True for engine end notices (5cl.9): the lobby shows NO "game ended"
 *  alert at all — the ended-state banner is gone, and raw ended notices
 *  are filtered out of the notice banner below. */
function isEndedNotice(message: string): boolean {
  return message.startsWith("The game ended");
}

/** Alert level classes for lobby notices (outline-styled per 9fv.11.3). */
const NOTICE_ALERT_LEVELS: Record<PartyNotice["level"], string> = {
  error: "alert-error",
  warn: "alert-warning",
  info: "alert-info",
};

/** True when the platform's native share sheet can take the invite URL
 *  (rocketcrab-ucz): both `navigator.share` and `navigator.canShare` must
 *  exist and accept the payload — jsdom and desktop browsers without Web
 *  Share hide the button entirely. */
function canNativeShare(url: string | null): boolean {
  if (
    url === null ||
    typeof navigator === "undefined" ||
    typeof navigator.share !== "function" ||
    typeof navigator.canShare !== "function"
  ) {
    return false;
  }
  try {
    return navigator.canShare({ url });
  } catch {
    return false;
  }
}

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
  onBrowseModeChange,
  initialBrowsing = false,
}: PartyLobbyProps) {
  const [forceDialog, setForceDialog] = useState(false);
  // 7.43: "Browse games" swaps the lobby for the shared browse UI (pick
  // mode) until the host picks a game or goes back. 5cl.7: the details-
  // page back button can land here already in browse mode (initialBrowsing).
  const [browsing, setBrowsing] = useState(initialBrowsing);
  // 2t1.1: tell the shell when browse mode toggles so it can hide the
  // full-size party header (GameBrowser's compact dimmed brand row takes
  // over while browsing).
  useEffect(() => {
    onBrowseModeChange?.(browsing);
  }, [browsing, onBrowseModeChange]);
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

  // 2t1.9: the player is asked for a name only once they're in the lobby
  // (and only if they never set one) — the prompt opens the same
  // name-editing page as the pencil (/join?edit=name).
  const needsName = getSavedPlayerName() === null;

  // 2t1.9 + 5cl.9: role-aware no-game message — the host must pick a
  // game, guests wait for the HOST BY NAME. The engine exposes no creator
  // member id; the creator is installed as the initial rendezvous greeter
  // (createParty passes its own memberId as initialGreeterMemberId), so
  // greeterMemberId is the best available signal for who the host is. If
  // the greeter is somehow not a member, fall back to the generic wording.
  const hostName =
    state.members.find((member) => member.memberId === state.greeterMemberId)?.displayName ?? null;
  let noGameMessage = "As the host, you must select a game.";
  if (state.role !== "creator") {
    noGameMessage =
      hostName === null
        ? "Waiting for the host to select a game"
        : `Waiting for ${hostName} to select a game`;
  }

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

  // 11.8 / 5cl.9: the notice banner shows the LATEST relevant notice only
  // (a capped, deduped set from the engine) — never a growing list of
  // identical alerts. End notices are filtered out (no "game ended" alert
  // at all, 5cl.9) and once the game ended the notice banner hides
  // entirely.
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

  // rocketcrab-ucz: native share of the invite URL. Cancelling the share
  // sheet (AbortError / not-allowed) is not an error — silently ignore it.
  const shareInvite = async () => {
    if (state.inviteUrl === null || typeof navigator.share !== "function") return;
    try {
      await navigator.share({ title: "Play rocketcrab with me!", url: state.inviteUrl });
    } catch {
      // The user dismissed the sheet or the platform refused — the lobby's
      // Copy URL affordance stays available either way.
    }
  };

  // rocketcrab-ucz: the native Share button only exists where the platform
  // supports it (feature-detected — hidden in jsdom and non-Web-Share
  // browsers); the copy + QR affordances stay for everyone.
  const showShareButton = canNativeShare(state.inviteUrl);

  if (browsing) {
    // 10.9: browse mode — selecting a game ALWAYS opens its details page
    // (/game/$gameId, saved games included); the pick happens there and
    // returns to /party. The lobby never sets the game directly.
    // 2t1.9: the shared GameBrowser owns its own back navigation (its
    // unified "back" button) — the lobby's redundant "Back to lobby"
    // button is gone.
    return (
      <div className="mx-auto flex w-full max-w-xl flex-col gap-4">
        <section aria-label="Pick a game" className="flex flex-col gap-3">
          <GameBrowser compact onBack={() => setBrowsing(false)} inParty />
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
          ACTION: Copy URL / QR (+ native Share where supported, ucz). */}
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
            variant="default"
            soft
            size="md"
            onClick={() => setQrOpen(true)}
            disabled={state.inviteUrl === null}
          >
            <QrCode className="h-4 w-4" aria-hidden="true" />
            QR Code
          </Button>
          {showShareButton ? (
            <Button
              variant="default"
              soft
              size="md"
              onClick={() => void shareInvite()}
              title="Share the invite link with a friend"
            >
              <Share2 className="h-4 w-4" aria-hidden="true" />
              Share
            </Button>
          ) : null}
        </div>
        {/* 5cl.2: the separate "Copy short link" affordance is gone —
            copying always copies the LONG secret URL. The short URL still
            works as an entry point (join-by-code); it just isn't what
            gets copied. */}
      </section>
      {/* 10.6: the welcome card — the lobby's main heading. A soft ambient
          glow behind the content, then what's selected and whose turn it
          is to act. Guests see the host-starting copy; when nothing is
          selected the card says so with a role-aware message (2t1.9). */}
      <section
        aria-label="Welcome"
        className="relative flex flex-col items-center gap-3 overflow-hidden rounded-box border-2 border-base-300 bg-base-100 p-5 text-center"
      >
        {/* 2t1.9: the idle glow is a wide ambient background BEHIND the
            card content (absolute, clipped by the card); the text sits on
            top of it. */}
        <IdleParticles />
        <div className="relative flex flex-col items-center gap-3">
          <h2 className="text-xl font-black">Welcome to rocketcrab!</h2>
          {state.game !== null ? (
            <>
              <p className="text-sm font-semibold text-base-content/70">
                {/* rocketcrab-ack: only the host says "You've selected" —
                    guests see the host's name, e.g. "Bob has selected". */}
                {state.role === "creator"
                  ? "You've selected"
                  : `${hostName ?? "The host"} has selected`}
              </p>
              <p className="text-2xl font-black text-primary">{state.game.title}</p>
              <p className="text-sm text-base-content/70">
                {state.role === "creator"
                  ? "As the host, you have to start the game!"
                  : "Waiting for the host to start the game…"}
              </p>
              <Button variant="default" soft size="md" onClick={() => setDetailsOpen(true)}>
                <BookOpen className="h-4 w-4" aria-hidden="true" />
                What is {state.game.title}?
              </Button>
            </>
          ) : (
            <p className="text-sm font-semibold text-base-content/70">{noGameMessage}</p>
          )}
        </div>
      </section>
      {/* 2t1.9: the name prompt — the player is only asked for a name once
          they are IN the lobby, and only when they never set one (the old
          join-time name step is gone). Opens the same /join?edit=name page
          as the pencil. */}
      {needsName ? (
        <section
          aria-label="Set your name"
          className="flex flex-wrap items-center justify-center gap-3 rounded-box border-2 border-primary/40 bg-base-100 p-4"
        >
          <p className="text-sm font-semibold">
            You haven&apos;t set a name yet — friends see you as{" "}
            <span className="font-black">{state.displayName}</span>.
          </p>
          <Link to="/join" search={{ edit: "name" }} className={buttonStyles("primary", "md")}>
            <Pencil className="h-4 w-4" aria-hidden="true" />
            Set your name
          </Link>
        </section>
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
                  variant="danger"
                  soft
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
          quiet control at the bottom of the page. rocketcrab-b73: START is
          host-only — joiners get no Start game / Start anyway buttons and
          no blocked-reason alert; browsing is host-only too, so a joiner
          has no path to pick or start a game from the lobby. */}
      <section className="flex flex-wrap items-center justify-center gap-2">
        {state.role === "creator" ? (
          <Button variant="secondary" size="lg" onClick={() => setBrowsing(true)}>
            <Gamepad2 className="h-5 w-5" aria-hidden="true" />
            Browse games
          </Button>
        ) : null}
        {state.role === "creator" ? (
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
        ) : null}
        {state.role === "creator" && state.canForceStart ? (
          <Button variant="default" soft size="lg" onClick={() => setForceDialog(true)}>
            <PartyPopper className="h-5 w-5" aria-hidden="true" />
            Start anyway
          </Button>
        ) : null}
      </section>
      {/* The blocked-reason copy (10.7): shown as a styled warning alert;
          the "Pick a game before starting the party." message is gone —
          the welcome card covers the no-game case. The ended case shows
          no alert at all (5cl.9), and joiners never see it (b73 — the
          reason is the host's start gate). */}
      {state.role === "creator" &&
      state.game !== null &&
      state.endedReason === null &&
      !state.canStart &&
      !state.canForceStart &&
      state.startBlockedReason !== null ? (
        <div role="alert" className="alert alert-outline alert-warning mx-auto w-fit">
          <span className="text-sm font-semibold">{state.startBlockedReason}</span>
        </div>
      ) : null}
      {/* 10.8 / 11.9, redesigned 2t1.9 + 5cl.9: the player grid — compact
          rows that use the tile width instead of stacking everything
          vertically: presence dot + name (+ role label / transfer detail)
          on the left, transfer state + actions (pencil / kick) on the
          right, a per-player border color, and ONE meaningful status: the
          connection dot + the transfer state (progress bar / failure). The
          name is larger with roomier padding (5cl.9) and the "Waiting for
          game" gap is gone. The pencil is a LINK to the shared
          name-editing page (/join?edit=name) — the in-tile edit form is
          gone (2t1.9). */}
      <details
        className="collapse collapse-arrow rounded-box border-2 border-base-300 bg-base-100"
        open
      >
        <summary className="collapse-title flex items-center gap-2 text-sm font-black text-base-content/60">
          Players ({state.members.length})
        </summary>
        <div className="collapse-content">
          <ul className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            {state.members.map((member, index) => {
              const roleLabel = roleLabels(member, state.role === "creator");
              return (
                <li
                  key={member.memberId}
                  data-testid={`party-member-${member.memberId}`}
                  className={`flex min-w-0 items-center gap-3 rounded-box border-2 bg-base-100 p-3.5 ${playerBorderColor(index)}`}
                >
                  {/* Presence + identity on the left. */}
                  <div className="flex min-w-0 flex-1 items-center gap-2.5">
                    {member.connected ? (
                      <span
                        title="Connected"
                        className="inline-block h-2.5 w-2.5 shrink-0 rounded-full bg-success"
                        aria-hidden="true"
                      />
                    ) : (
                      <span
                        title="Disconnected"
                        className="inline-block h-2.5 w-2.5 shrink-0 rounded-full bg-error"
                        aria-hidden="true"
                      />
                    )}
                    <div className="min-w-0">
                      <p className="truncate text-lg font-black leading-tight">
                        {member.displayName}
                      </p>
                      {roleLabel !== "" ? (
                        <p className="truncate text-xs font-semibold text-base-content/60">
                          {roleLabel}
                        </p>
                      ) : null}
                      {member.transferDetail !== null && member.transferState !== "complete" ? (
                        <p
                          className="truncate text-xs leading-tight text-base-content/50"
                          title={member.transferDetail}
                        >
                          {member.transferDetail}
                        </p>
                      ) : null}
                    </div>
                  </div>
                  {/* Transfer state + actions on the right. */}
                  <div className="flex shrink-0 items-center gap-1.5">
                    {transferIndicator(member)}
                    {member.isSelf ? (
                      /* 2t1.9: the pencil opens the shared name-editing page
                         (/join?edit=name) instead of an inline form. */
                      <Link
                        to="/join"
                        search={{ edit: "name" }}
                        className={buttonStyles("default", "md", "btn-xs", true)}
                        aria-label="Edit your name"
                        title="Edit your name"
                      >
                        <Pencil className="h-3 w-3" aria-hidden="true" />
                      </Link>
                    ) : null}
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
          bottom of the page. 2t1.9: when the current user is the ONLY
          player left, leaving ends the party — the button says so. */}
      <div className="flex justify-center">
        <Button variant="danger" size="md" onClick={onLeave}>
          <LogOut className="h-4 w-4" aria-hidden="true" />
          {state.members.length === 1 ? "End party" : "Leave party"}
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
            <Button variant="default" soft onClick={() => setQrOpen(false)}>
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
              <Button variant="default" soft onClick={() => setForceDialog(false)}>
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
