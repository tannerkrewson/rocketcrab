import type { MemberId } from "@rocketcrab/protocol";
import type { TransportConnectionState } from "@rocketcrab/core";
import { buildInviteUrl } from "@rocketcrab/party";
import type {
  PartyMemberView,
  PartyDiagnostics,
  PartyNotice,
  PartyEngineState,
} from "./engine-types";
import type { PartyEngineContext } from "./engine-context";
import type { PartyEngineServices } from "./engine-services";
import {
  MAX_NOTICES,
  makeNotice,
  leftNoticeMessage,
  isConnectedState,
  defaultBaseUrl,
} from "./engine-utils";
import { playerLimitNotice } from "./player-limits";

/** Lobby projections, diagnostics, bounded notices, and snapshot subscriptions. */
export class PartySnapshot {
  private readonly listeners = new Set<(state: PartyEngineState) => void>();

  private lastDiagnostics: unknown = null;

  constructor(
    private readonly state: PartyEngineContext,
    private readonly services: () => Pick<PartyEngineServices, "kinds" | "source">,
  ) {}

  getState(): PartyEngineState {
    const party = this.state.party;
    const identity = this.state.identity;
    const members = this.buildMembers();
    const allReady = members.length > 0 && members.every((member) => member.ready);
    const allVerified = this.services().kinds.current().allSourcesVerified(members);
    const anyFailed = members.some(
      (member) => member.transferState === "failed" || member.transferState === "incompatible",
    );
    const ended = this.state.session?.isEnded() ?? false;
    const inLobby = this.state.phase === "lobby";

    // Only lobby UI offers start; blocked reasons describe game gates rather than phase.
    let startBlockedReason: string | null = null;
    if (this.state.game === null) {
      startBlockedReason = "Pick a game before starting the party.";
    } else if (ended) {
      startBlockedReason = "The game ended; leave the party to play again.";
    } else if (anyFailed) {
      const failed = members.find(
        (member) => member.transferState === "failed" || member.transferState === "incompatible",
      );
      startBlockedReason =
        failed === undefined
          ? "A player could not receive the game."
          : `${failed.displayName} could not receive the game${failed.transferDetail === null ? "." : ` (${failed.transferDetail}).`}`;
    } else if (!allVerified) {
      const waiting = members.find(
        (member) => !this.services().source.isSourceVerified(member.memberId),
      );
      startBlockedReason =
        waiting === undefined
          ? "Waiting for the game to reach every player."
          : `Waiting for ${waiting.displayName} to receive the game.`;
    } else if (!allReady) {
      startBlockedReason = "Waiting for every player's game to load and register.";
    }

    return {
      phase: this.state.phase,
      phaseDetail: this.state.phaseDetail,
      joinStage: this.state.joinStage,
      reconnectAttempts: this.state.reconnectAttempts,
      role: party?.role ?? null,
      memberId: identity.memberId,
      displayName: identity.displayName,
      game: this.state.game,
      playerLimitNotice:
        this.state.game === null ? null : playerLimitNotice(members.length, this.state.game),
      members,
      hostMemberId: party?.hostMemberId ?? null,
      amHost: party?.amHost ?? false,
      authorityMemberId: this.computeAuthorityMemberId(members),
      inviteUrl: this.buildInviteUrl(),
      connectionState: this.state.connectionState,
      canStart:
        inLobby && this.state.game !== null && !ended && !anyFailed && allVerified && allReady,
      canForceStart:
        inLobby && this.state.game !== null && !ended && !anyFailed && allVerified && !allReady,
      startBlockedReason,
      endedReason: this.state.endedReason,
      removedReason: this.state.removedReason,
      runtimeLogs: this.state.runtimeLogs,
      diagnostics: this.buildDiagnostics(),
      signalingOutage: this.state.signalingOutageVisible,
      notices: [...this.state.notices],
      lastError: this.state.lastError,
      setupFailureCode: this.state.setupFailureCode,
      peerLink: this.state.peerLink.status,
      sharedGames: [...this.state.sharedGames.values()]
        .reverse()
        .map(({ source: _source, ...game }) => game),
    };
  }

  /** Subscribers receive the current snapshot immediately. */
  onState(handler: (state: PartyEngineState) => void): () => void {
    this.listeners.add(handler);
    handler(this.getState());
    return () => {
      this.listeners.delete(handler);
    };
  }

  /** Start-flow diagnostics, exposed on window.__NOVA_PARTY_DEBUG__ in dev/test builds. */
  debugSnapshot(): Record<string, unknown> {
    const state = this.getState();
    return {
      phase: state.phase,
      joinStage: state.joinStage,
      gameStarted: this.state.gameStarted,
      registered: this.state.registered,
      frameExists: this.state.runtime !== null,
      frameStartDelivered: this.state.frameStartDelivered,
      startRetryActive: this.state.cancelStartRetry !== null,
      startGaveUp: this.state.startGaveUp,
      session: this.state.session?.debugState() ?? null,
      authority: state.authorityMemberId,
      canStart: state.canStart,
      startBlockedReason: state.startBlockedReason,
      members: state.members.map((member) => ({
        id: member.memberId,
        isSelf: member.isSelf,
        connected: member.connected,
        transferState: member.transferState,
        ready: member.ready,
      })),
      notices: state.notices.map((notice) => notice.message),
      // Peers reached through the relay tunnel rather than direct WebRTC.
      relayedPeers: state.diagnostics?.peers.filter((peer) => peer.tunnelled === true).length ?? 0,
    };
  }

  async refreshDiagnostics(): Promise<void> {
    const transport = this.state.party?.privateTransport;
    this.lastDiagnostics =
      this.state.diagnosticsProvider?.() ?? this.transportDiagnostics(transport) ?? null;
    if (transport !== null && transport !== undefined) {
      const sampler = (
        transport as unknown as {
          sampleQuality?: () => Promise<unknown>;
        }
      ).sampleQuality;
      if (typeof sampler === "function") {
        await sampler.call(transport).catch(() => undefined);
      }
    }
    this.emit();
  }

  noteMemberLeft(memberId: MemberId, displayName: string | undefined): void {
    if (this.state.removedMemberIds.delete(memberId)) return;
    if (displayName === undefined || displayName === memberId) return;
    this.addNotice("info", leftNoticeMessage(displayName));
  }

  dropLeftNotice(displayName: string | undefined): void {
    if (displayName === undefined) return;
    const message = leftNoticeMessage(displayName);
    this.state.notices = this.state.notices.filter((notice) => notice.message !== message);
  }

  buildMembers(): PartyMemberView[] {
    const party = this.state.party;
    const identity = this.state.identity;
    const peers = party?.privateTransport.peers ?? [];
    const memberIds = party === null ? [identity.memberId] : party.members;
    const members: PartyMemberView[] = [];
    for (const memberId of memberIds) {
      const peer = peers.find((candidate) => candidate.memberId === memberId);
      const isSelf = memberId === identity.memberId;
      members.push({
        memberId,
        displayName: this.displayNameOf(memberId),
        isSelf,
        connectionId: peer?.connectionId ?? null,
        connected: isSelf ? isConnectedState(this.state.connectionState) : peer !== undefined,
        isHost: memberId === party?.hostMemberId,
        ...this.services().kinds.current().memberStatus(memberId),
      });
    }
    return members;
  }

  displayNameOf(memberId: MemberId): string {
    const identity = this.state.identity;
    if (memberId === identity.memberId) {
      return identity.displayName;
    }
    return this.state.party?.getMemberName(memberId) ?? memberId;
  }

  /** Do not show raw member ids in membership notices. */
  hasDisplayName(memberId: MemberId): boolean {
    return this.displayNameOf(memberId) !== memberId;
  }

  /**
   * Until the state engine announces authority, show its first-ready-member fallback.
   * Greeter status is a separate role (ADR-0007), never an authority signal.
   */
  private computeAuthorityMemberId(members: readonly PartyMemberView[]): MemberId | null {
    const engineAuthority = this.state.session?.getStateModeDiagnostics().authorityMemberId ?? null;
    return engineAuthority ?? members.find((member) => member.ready)?.memberId ?? null;
  }

  private buildInviteUrl(): string | null {
    const party = this.state.party;
    if (party === null) {
      return null;
    }
    try {
      return buildInviteUrl({
        baseUrl: `${defaultBaseUrl()}/party`,
        secret: party.secret,
      });
    } catch {
      return null;
    }
  }

  private buildDiagnostics(): PartyDiagnostics | null {
    const party = this.state.party;
    if (party === null) {
      return null;
    }
    const transport = party.privateTransport;
    const transportRoom = (transport as { roomName?: string }).roomName ?? "";
    const raw =
      this.state.diagnosticsProvider?.() ??
      this.transportDiagnostics(transport) ??
      this.lastDiagnostics;
    const adapter = raw as {
      connectionState?: TransportConnectionState;
      selfConnectionId?: string;
      room?: string;
      sessionId?: string | null;
      signalingConnected?: boolean | null;
      joinErrors?: Array<{ category: string; message: string }> | null;
      peers?: Array<{
        memberId: string;
        connectionId: string;
        displayName?: string;
        tunnelled?: boolean;
      }>;
      lastQuality?: Array<{ memberId: string; pingMs: number | null; sampledAt: number }>;
    } | null;
    return {
      connectionState: adapter?.connectionState ?? transport.connectionState,
      selfConnectionId: adapter?.selfConnectionId ?? transport.selfConnectionId,
      room: adapter?.room ?? transportRoom,
      sessionId: adapter?.sessionId ?? transport.sessionId,
      signalingConnected: adapter?.signalingConnected ?? null,
      joinErrors: adapter?.joinErrors ?? null,
      peers: adapter?.peers ?? transport.peers.map((peer) => ({ ...peer })),
      lastQuality: adapter?.lastQuality ?? [],
      turn: this.state.turnStatus,
    };
  }

  /** getDiagnostics is optional; injected and in-memory transports may omit it. */
  private transportDiagnostics(transport: unknown): unknown | null {
    const getter = (transport as { getDiagnostics?: () => unknown } | undefined)?.getDiagnostics;
    return typeof getter === "function" ? (getter.call(transport) as unknown) : null;
  }

  addNotice(level: PartyNotice["level"], message: string): void {
    // Move repeats to the newest slot instead of accumulating duplicate alerts.
    const duplicateIndex = this.state.notices.findIndex(
      (notice) => notice.message === message && notice.level === level,
    );
    const deduped =
      duplicateIndex === -1
        ? this.state.notices
        : [
            ...this.state.notices.slice(0, duplicateIndex),
            ...this.state.notices.slice(duplicateIndex + 1),
          ];
    this.state.notices = [...deduped, makeNotice(level, message)].slice(-MAX_NOTICES);
  }

  emit(): void {
    const state = this.getState();
    this.services().source.syncSourceRetransmit(state);
    for (const handler of this.listeners) {
      handler(state);
    }
  }
}
