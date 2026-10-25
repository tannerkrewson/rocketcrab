import { Link } from "@tanstack/react-router";
import { Copy, Gamepad2, LogOut, PartyPopper, Pencil, Play, QrCode, Share2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Alert } from "@heroui/react";
import { toast } from "../../lib/toast";
import { writeToClipboard } from "../../lib/editor/clipboard";
import type { PartyEngineState, PartyMemberView, PartyNotice } from "../../lib/party/engine";
import { getSavedPlayerName } from "../../lib/party/identity";
import { Button, buttonStyles } from "../ui/Button";
import { GameBrowser } from "./GameBrowser";
import { IdleParticles } from "./IdleParticles";
import { PartyDiagnosticsPanel } from "./PartyDiagnostics";
import { PartyInviteQr } from "./PartyInviteQr";
import { clearBrowseContext } from "../../lib/browse/back-context";

export interface PartyLobbyProps {
  state: PartyEngineState;
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
  "border-accent",
  "border-success",
  "border-warning",
  "border-danger",
] as const;

function playerBorderColor(index: number): string {
  return PLAYER_BORDER_COLORS[index % PLAYER_BORDER_COLORS.length] ?? "border-primary";
}

function roleLabels(member: PartyMemberView, isCreator: boolean): string {
  const labels: string[] = [];
  if (member.isSelf) labels.push("You");
  if (member.isSelf && isCreator) labels.push("Host");
  if (member.isHost && !member.isSelf) labels.push("Host");
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
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round((member.transferProgress ?? 0) * 100)}
          aria-label={`Game transfer progress for ${member.displayName}`}
          className="h-1.5 w-16 overflow-hidden rounded-full bg-surface-tertiary"
        >
          <div
            className="h-full bg-accent transition-[width]"
            style={{ width: `${Math.round((member.transferProgress ?? 0) * 100)}%` }}
          />
        </div>
      );
    case "failed":
      return <span className="text-[10px] font-bold text-danger">Failed</span>;
    case "incompatible":
      return <span className="text-[10px] font-bold text-danger">Incompatible</span>;
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

/** 2z9: membership notices ("X joined the party." / "X was removed from
 *  the party.") are TEMPORARY smart toasts — the same sonner system the
 *  URL copy uses — never persistent banner alerts. */
function isMembershipNotice(message: string): boolean {
  return message.endsWith("joined the party.") || message.endsWith("was removed from the party.");
}

/** Notice level -> HeroUI alert status. */
const NOTICE_ALERT_STATUS: Record<PartyNotice["level"], "danger" | "warning" | "accent"> = {
  error: "danger",
  warn: "warning",
  info: "accent",
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
  onStart,
  onLeave,
  onRefreshDiagnostics,
  onKickMember,
  onBrowseModeChange,
  initialBrowsing = false,
}: PartyLobbyProps) {
  const [forceDialog, setForceDialog] = useState(false);
  // 2z9: kicking removes a player from the party — the X asks first (the
  // candidate memberId is held here until confirmed).
  const [kickPending, setKickPending] = useState<string | null>(null);
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
  const [qrOpen, setQrOpen] = useState(false);
  const hostNameForDiagnostics =
    state.members.find((member) => member.memberId === state.hostMemberId)?.displayName ??
    state.hostMemberId ??
    null;
  const authorityName =
    state.members.find((member) => member.memberId === state.authorityMemberId)?.displayName ??
    state.authorityMemberId ??
    null;

  // 2t1.9: the player is asked for a name only once they're in the lobby
  // (and only if they never set one) — the prompt opens the same
  // name-editing page as the pencil (/join?edit=name).
  const needsName = getSavedPlayerName() === null;

  const hostName =
    state.members.find((member) => member.memberId === state.hostMemberId)?.displayName ?? null;
  let noGameMessage = "As the host, you must select a game.";
  if (!state.amHost) {
    noGameMessage =
      hostName === null
        ? "Waiting for the host to select a game"
        : `Waiting for ${hostName} to select a game`;
  }

  const pageTitle = "Nova party";

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
  // entirely. 2z9: membership notices (joined / removed) are filtered out
  // too — they toast instead, below.
  const latestNotice =
    state.endedReason !== null || state.notices.length === 0
      ? null
      : ([...state.notices]
          .reverse()
          .find(
            (notice) => !isEndedNotice(notice.message) && !isMembershipNotice(notice.message),
          ) ?? null);

  // 2z9: membership notices use the same TEMPORARY smart toast system the
  // URL copy does (sonner) — one toast per notice, deduped by notice id so
  // re-renders never re-fire (the engine already collapses identical
  // repeats). The engine itself skips these while a member still has the
  // generated member-… id name, so no id-like text ever appears.
  const toastedNoticeIds = useRef<readonly string[]>([]);
  useEffect(() => {
    for (const notice of state.notices) {
      if (toastedNoticeIds.current.includes(notice.id)) continue;
      if (!isMembershipNotice(notice.message)) continue;
      toastedNoticeIds.current = [...toastedNoticeIds.current, notice.id];
      if (notice.level === "error") {
        toast.danger(notice.message);
      } else if (notice.level === "warn") {
        toast.warning(notice.message);
      } else {
        toast.info(notice.message);
      }
    }
  }, [state.notices]);

  const copyInvite = async () => {
    if (state.inviteUrl === null) return;
    const ok = await writeToClipboard(state.inviteUrl);
    if (ok) {
      toast.success("Invite link copied.");
    } else {
      toast.danger("Couldn't copy the link — try again.");
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

      <section
        aria-label="Invite your friends"
        className="flex flex-col items-center gap-3 rounded-2xl border-2 border-border bg-surface p-5 text-center"
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
      </section>
      {/* 10.6: the welcome card — the lobby's main heading. A soft ambient
          glow behind the content, then what's selected and whose turn it
          is to act. Guests see the host-starting copy; when nothing is
          selected the card says so with a role-aware message (2t1.9). */}
      <section
        aria-label="Welcome"
        className="relative flex flex-col items-center gap-3 overflow-hidden rounded-2xl border-2 border-border bg-surface p-5 text-center"
      >
        {/* 2t1.9: the idle glow is a wide ambient background BEHIND the
            card content (absolute, clipped by the card); the text sits on
            top of it. */}
        <IdleParticles />
        <div className="relative flex flex-col items-center gap-3">
          <h2 className="text-xl font-black">Welcome to rocketcrab!</h2>
          {state.game !== null ? (
            <>
              <p className="text-sm font-semibold text-foreground/70">
                {/* rocketcrab-ack: only the host says "You've selected" —
                    guests see the host's name, e.g. "Bob has selected". */}
                {state.amHost ? "You've selected" : `${hostName ?? "The host"} has selected`}
              </p>
              <p className="text-2xl font-black text-primary">{state.game.title}</p>
              <p className="text-sm text-foreground/70">
                {state.amHost
                  ? "As the host, you have to start the game!"
                  : "Waiting for the host to start the game…"}
              </p>
              <Link
                to="/game/$gameId"
                params={{ gameId: state.game.gameId }}
                search={{ from: "party" }}
                onClick={clearBrowseContext}
                className={buttonStyles("default", "md", undefined, true)}
              >
                What is {state.game.title}?
              </Link>
            </>
          ) : (
            <p className="text-sm font-semibold text-foreground/70">{noGameMessage}</p>
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
          className="flex flex-wrap items-center justify-center gap-3 rounded-2xl border-2 border-primary/40 bg-surface p-4"
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

      {/* 10.7: the action row (Browse games left, Start game right) sits
          ABOVE the players box, horizontally centered — leave is its own
          quiet control at the bottom of the page. rocketcrab-b73: START is
          host-only — joiners get no Start game / Start anyway buttons and
          no blocked-reason alert; browsing is host-only too, so a joiner
          has no path to pick or start a game from the lobby. */}
      <section className="flex flex-wrap items-center justify-center gap-2">
        {state.amHost ? (
          <Button variant="secondary" size="lg" onClick={() => setBrowsing(true)}>
            <Gamepad2 className="h-5 w-5" aria-hidden="true" />
            Browse games
          </Button>
        ) : null}
        {state.amHost ? (
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
        {state.amHost && state.canForceStart ? (
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
      {state.amHost &&
      state.game !== null &&
      state.endedReason === null &&
      !state.canStart &&
      !state.canForceStart &&
      state.startBlockedReason !== null ? (
        <Alert status="warning" role="alert" className="mx-auto w-fit">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Description className="text-sm font-semibold">
              {state.startBlockedReason}
            </Alert.Description>
          </Alert.Content>
        </Alert>
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
      <details className="group rounded-2xl border-2 border-border bg-surface" open>
        <summary className="flex cursor-pointer list-none items-center gap-2 p-4 text-sm font-black text-foreground/60">
          Players ({state.members.length})
        </summary>
        <div className="p-4 pt-0">
          <ul className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            {state.members.map((member, index) => {
              const roleLabel = roleLabels(member, state.amHost);
              return (
                <li
                  key={member.memberId}
                  data-testid={`party-member-${member.memberId}`}
                  className={`flex min-w-0 items-center gap-3 rounded-2xl border-2 bg-surface p-3.5 ${playerBorderColor(index)}`}
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
                        className="inline-block h-2.5 w-2.5 shrink-0 rounded-full bg-danger"
                        aria-hidden="true"
                      />
                    )}
                    <div className="min-w-0">
                      <p className="truncate text-lg font-black leading-tight">
                        {member.displayName}
                      </p>
                      {roleLabel !== "" ? (
                        <p className="truncate text-xs font-semibold text-foreground/60">
                          {roleLabel}
                        </p>
                      ) : null}
                      {member.transferDetail !== null && member.transferState !== "complete" ? (
                        <p
                          className="truncate text-xs leading-tight text-foreground/50"
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
                        className={buttonStyles("default", "sm", undefined, true)}
                        aria-label="Edit your name"
                        title="Edit your name"
                      >
                        <Pencil className="h-3 w-3" aria-hidden="true" />
                      </Link>
                    ) : null}
                    {state.amHost && !member.isSelf ? (
                      <button
                        type="button"
                        className={buttonStyles("danger", "sm", undefined, true)}
                        onClick={() => setKickPending(member.memberId)}
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
        <Alert
          status={NOTICE_ALERT_STATUS[latestNotice.level]}
          role="alert"
          className="mx-auto w-fit"
        >
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Description className="text-sm font-semibold">
              {latestNotice.message}
            </Alert.Description>
          </Alert.Content>
        </Alert>
      ) : null}
      <PartyDiagnosticsPanel
        diagnostics={state.diagnostics}
        onRefresh={onRefreshDiagnostics}
        hostNameForDiagnostics={hostNameForDiagnostics}
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

      {qrOpen && state.inviteUrl !== null ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Party QR code"
        >
          <div className="flex w-full max-w-sm flex-col items-center gap-4 rounded-2xl border-2 border-border bg-surface p-5">
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
          <div className="flex w-full max-w-sm flex-col gap-4 rounded-2xl border-2 border-border bg-surface p-5">
            <p className="font-black">Start before everyone is ready?</p>
            <p className="text-sm text-foreground/70">
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
      {/* 2z9: kicking asks first — a mis-tap would boot a player from the
          party (same confirm pattern as force-start above). */}
      {kickPending !== null ? (
        <PartyKickConfirm
          memberName={
            state.members.find((member) => member.memberId === kickPending)?.displayName ??
            kickPending
          }
          onCancel={() => setKickPending(null)}
          onConfirm={() => {
            setKickPending(null);
            onKickMember(kickPending);
          }}
        />
      ) : null}
    </div>
  );
}

/** 2z9: kick-confirmation dialog (host only) — mirrors the in-game
 *  shell's PartyKickConfirm so kicking always asks first. */
function PartyKickConfirm({
  memberName,
  onCancel,
  onConfirm,
}: {
  memberName: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Kick a player from the party"
    >
      <div className="flex w-full max-w-sm flex-col gap-4 rounded-2xl border-2 border-border bg-surface p-5">
        <p className="font-black">Kick {memberName} from the party?</p>
        <p className="text-sm">
          This removes them for now, not permanently. They can rejoin with the same private invite.
        </p>
        <p className="text-sm text-foreground/70">
          {memberName} will be removed from the party and will have to rejoin with the invite link.
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="default" soft onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="danger" onClick={onConfirm}>
            Kick player
          </Button>
        </div>
      </div>
    </div>
  );
}
