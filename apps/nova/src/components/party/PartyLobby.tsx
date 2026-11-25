import { Link } from "@tanstack/react-router";
import { Copy, Gamepad2, LogOut, PartyPopper, Pencil, Play, QrCode, Share2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Alert } from "@heroui/react";
import { toast } from "../../lib/toast";
import { writeToClipboard } from "../../lib/editor/clipboard";
import type { PartyEngineState, PartyMemberView, PartyNotice } from "../../lib/party/engine";
import { InstallAppButton } from "../layout/InstallAppButton";
import { useAppInstallAvailable } from "../../lib/app-install";
import { Button, buttonStyles } from "../ui/Button";
import { GameBrowser } from "./GameBrowser";
import { NameEntry } from "./NameEntry";
import { Dialog } from "../ui/Dialog";
import { PartyInviteQr } from "./PartyInviteQr";
import { SaveSharedGame } from "./SaveSharedGame";
import { clearBrowseContext } from "../../lib/browse/back-context";

export interface PartyLobbyProps {
  state: PartyEngineState;
  onStart: (force: boolean) => void;
  onLeave: () => void;
  /** Host-only removal; callers must confirm first. */
  onKickMember: (memberId: string) => void;
  /** Rename the local player (from the lobby's rename dialog). */
  onEditName: (name: string) => void;
  /** Restore browse mode when returning from game details. */
  initialBrowsing?: boolean;
  /** Title of the game the party just finished, while it is still selected. */
  playedTitle?: string | null;
}

function roleLabels(member: PartyMemberView, isCreator: boolean): string {
  const labels: string[] = [];
  if (member.isSelf) labels.push("You");
  if (member.isSelf && isCreator) labels.push("Host");
  if (member.isHost && !member.isSelf) labels.push("Host");
  return labels.join(", ");
}

/** Show active transfers and failures; readiness belongs to the start gate. */
function transferIndicator(member: PartyMemberView) {
  switch (member.transferState) {
    case "transferring":
      return (
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round((member.transferProgress ?? 0) * 100)}
          aria-label="Game transfer progress"
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
      return null;
    case "complete":
      return null;
  }
}

/** Filter end notices out of the lobby banner. */
function isEndedNotice(message: string): boolean {
  return message.startsWith("The game ended");
}

/** Membership notices use temporary toasts rather than persistent alerts. */
function isMembershipNotice(message: string): boolean {
  return message.endsWith("joined the party.") || message.endsWith("was removed from the party.");
}

const NOTICE_ALERT_STATUS: Record<PartyNotice["level"], "danger" | "warning" | "accent"> = {
  error: "danger",
  warn: "warning",
  info: "accent",
};

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

/** Lobby controls and player state; internal host/authority roles stay in diagnostics. */
export function PartyLobby({
  state,
  onStart,
  onLeave,
  onKickMember,
  onEditName,
  initialBrowsing = false,
  playedTitle = null,
}: PartyLobbyProps) {
  const installAvailable = useAppInstallAvailable();
  const [startHelpOpen, setStartHelpOpen] = useState(false);
  const [forceDialog, setForceDialog] = useState(false);
  const [kickPending, setKickPending] = useState<string | null>(null);
  const [browsing, setBrowsing] = useState(initialBrowsing);
  const [qrOpen, setQrOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);

  // A Nova game from someone else can be saved to this player's games.
  const sharedGame =
    state.game?.kind !== "nova"
      ? undefined
      : state.sharedGames.find((game) => game.gameId === state.game?.gameId);

  const hostName =
    state.members.find((member) => member.memberId === state.hostMemberId)?.displayName ?? null;
  let noGameMessage = "As the host, you must select a game.";
  if (!state.amHost) {
    noGameMessage =
      hostName === null
        ? "Waiting for the host to select a game"
        : `Waiting for ${hostName} to select a game`;
  }

  // Keep only the latest relevant notice; membership changes toast separately.
  const latestNotice =
    state.endedReason !== null || state.notices.length === 0
      ? null
      : ([...state.notices]
          .reverse()
          .find(
            (notice) => !isEndedNotice(notice.message) && !isMembershipNotice(notice.message),
          ) ?? null);

  // Remember toasted ids so local re-renders cannot repeat membership notifications.
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

  const shareInvite = async () => {
    if (state.inviteUrl === null || typeof navigator.share !== "function") return;
    try {
      await navigator.share({ title: "Play rocketcrab with me!", url: state.inviteUrl });
    } catch {
      // The user dismissed the sheet or the platform refused — the lobby's
      // Copy URL affordance stays available either way.
    }
  };

  const showShareButton = canNativeShare(state.inviteUrl);

  if (renaming) {
    return (
      <NameEntry
        showHeader={false}
        initialName={state.displayName}
        submitLabel="Save"
        onSubmit={(name) => {
          onEditName(name);
          setRenaming(false);
        }}
        backAction={
          <Button variant="tertiary" size="lg" onClick={() => setRenaming(false)}>
            Cancel
          </Button>
        }
      />
    );
  }

  if (browsing) {
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
      {/* Render only safe invite text; the secret remains in the URL fragment
          and is encoded by the QR, never printed on the page. */}

      <section
        aria-label="Invite your friends"
        className="glass flex flex-col items-center gap-3 rounded-2xl p-5 text-center"
      >
        <h2 className="text-lg font-black">Get your friends to join!</h2>
        <div className="button-row">
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
      <section
        aria-label={playedTitle !== null ? "Thanks for playing" : "Welcome"}
        className="glass flex flex-col items-center justify-center gap-3 rounded-2xl p-5 text-center"
      >
        {playedTitle !== null ? (
          <>
            <h2 className="text-xl font-black">
              Thanks for playing <span className="text-primary">{playedTitle}</span> on rocketcrab!
            </h2>
            <p className="text-sm text-foreground/70">
              {installAvailable
                ? `Get the app to play ${playedTitle} and more, right from your home screen.`
                : "Play it again, or browse for your next game."}
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              <InstallAppButton />
              {sharedGame !== undefined ? <SaveSharedGame game={sharedGame} /> : null}
            </div>
          </>
        ) : state.game !== null ? (
          <>
            <p className="text-sm font-semibold text-foreground/70">
              {state.amHost ? "You've selected" : `${hostName ?? "The host"} has selected`}
            </p>
            <p className="text-2xl font-black text-primary">{state.game.title}</p>
            <p className="text-sm text-foreground/70">
              {state.amHost
                ? "As the host, you have to start the game!"
                : "Waiting for the host to start the game…"}
            </p>
            {/* Wraps on narrow phones instead of squeezing both labels. */}
            <div className="flex flex-wrap justify-center gap-2">
              <Link
                to="/game/$gameId"
                params={{ gameId: state.game.gameId }}
                search={{ from: "party" }}
                onClick={clearBrowseContext}
                className={buttonStyles("default", "md", undefined, true)}
              >
                What is {state.game.title}?
              </Link>
              {sharedGame !== undefined ? <SaveSharedGame game={sharedGame} /> : null}
            </div>
          </>
        ) : (
          <>
            <h2 className="text-xl font-black">Welcome to rocketcrab!</h2>
            <p className="text-sm font-semibold text-foreground/70">{noGameMessage}</p>
          </>
        )}
      </section>

      <section className="button-row self-center">
        {/* Everyone can browse; only the host can pick (guests are told so). */}
        <Button
          variant="secondary"
          size="lg"
          onClick={() => {
            // Always open at the top-level menu; only returning from a
            // game's details page restores the last category.
            clearBrowseContext();
            setBrowsing(true);
          }}
        >
          <Gamepad2 className="h-5 w-5" aria-hidden="true" />
          Browse games
        </Button>
        {state.amHost ? (
          <Button
            variant="primary"
            size="lg"
            aria-label={state.canStart ? undefined : "Start game requirements"}
            aria-haspopup={state.canStart ? undefined : "dialog"}
            className={!state.canStart ? "opacity-60" : undefined}
            onPress={() => {
              if (state.canStart) onStart(false);
              else setStartHelpOpen(true);
            }}
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
      <Dialog
        open={startHelpOpen}
        onClose={() => setStartHelpOpen(false)}
        title={state.canStart ? "Ready to start" : "Can't start yet"}
        className="sm:max-w-sm"
      >
        <p>
          {state.startBlockedReason ??
            (state.canStart
              ? "Everyone is ready. You can start the game now."
              : "Wait for the party to be ready, then try again.")}
        </p>
      </Dialog>
      {state.playerLimitNotice !== null && state.endedReason === null ? (
        <Alert status="warning" className="mx-auto w-fit" data-testid="player-limit-notice">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Description className="text-sm font-semibold">
              {state.playerLimitNotice}
            </Alert.Description>
          </Alert.Content>
        </Alert>
      ) : null}
      {playedTitle === null ? <InstallAppButton className="self-center" /> : null}
      <details className="glass group rounded-2xl" open>
        <summary className="flex cursor-pointer list-none items-center gap-2 p-4 text-sm font-black text-foreground/60">
          Players ({state.members.length})
        </summary>
        <div className="p-4 pt-0">
          <ul className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            {state.members.map((member) => {
              const roleLabel = roleLabels(member, state.amHost);
              const connectionLabel = member.connected ? "Connected" : "Disconnected";
              return (
                <li
                  key={member.memberId}
                  data-testid={`party-member-${member.memberId}`}
                  className="flex min-w-0 items-center gap-3 rounded-2xl bg-surface-secondary p-3"
                >
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <span
                      role="img"
                      aria-label={connectionLabel}
                      title={connectionLabel}
                      className={`size-2 shrink-0 rounded-full ${member.connected ? "bg-success" : "bg-danger"}`}
                    />
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
                  <div className="flex shrink-0 items-center gap-1.5">
                    {transferIndicator(member)}
                    {member.isSelf ? (
                      <Button
                        variant="default"
                        soft
                        size="sm"
                        isIconOnly
                        // Lighter than the pill it sits on, so it reads as a
                        // raised control rather than a hole in the card.
                        className="bg-white/12 hover:bg-white/20"
                        onClick={() => setRenaming(true)}
                        aria-label="Edit your name"
                        title="Edit your name"
                      >
                        <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                      </Button>
                    ) : null}
                    {state.amHost && !member.isSelf ? (
                      <Button
                        variant="danger"
                        size="sm"
                        soft
                        onClick={() => setKickPending(member.memberId)}
                      >
                        <X className="h-3 w-3" aria-hidden="true" />
                        <span className="sr-only">Kick {member.displayName}</span>
                      </Button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      </details>
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
      <div className="flex justify-center">
        <Button variant="default" soft size="md" onClick={onLeave}>
          <LogOut className="h-4 w-4" aria-hidden="true" />
          {state.members.length === 1 ? "End party" : "Leave party"}
        </Button>
      </div>

      <Dialog
        open={qrOpen && state.inviteUrl !== null}
        onClose={() => setQrOpen(false)}
        title="Scan to join the party"
        className="max-w-md"
      >
        <div className="flex flex-col items-center gap-3 pb-2">
          {state.inviteUrl !== null ? <PartyInviteQr inviteUrl={state.inviteUrl} /> : null}
          <p className="text-center text-sm text-foreground/70">
            Point a phone&apos;s camera at the code, then tap the link that appears.
          </p>
        </div>
      </Dialog>
      {forceDialog ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Start before everyone is ready"
        >
          <div className="flex w-full max-w-sm flex-col gap-4 rounded-2xl bg-overlay p-5 shadow-overlay">
            <p className="font-black">Start before everyone is ready?</p>
            <p className="text-sm text-foreground/70">
              Every player has the game, but not everyone has reported ready. Starting now means
              some players may miss the start signal. They can still rejoin.
            </p>
            <div className="button-row self-end">
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
      <div className="flex w-full max-w-sm flex-col gap-4 rounded-2xl bg-overlay p-5 shadow-overlay">
        <p className="font-black">Kick {memberName} from the party?</p>
        <p className="text-sm">
          This removes them for now, not permanently. They can rejoin with the same private invite.
        </p>
        <p className="text-sm text-foreground/70">
          {memberName} will be removed from the party and will have to rejoin with the invite link.
        </p>
        <div className="button-row self-end">
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
