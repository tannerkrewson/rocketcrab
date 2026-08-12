/**
 * The party engine (P4): the shell-owned state machine behind the lobby and
 * the game-launch flow.
 *
 * One engine per page (the {@link partyEngine} singleton), so route
 * remounts never kill a party or leak Trystero rooms (engineering rule 22):
 * the engine owns the P2 {@link PartySession} (create / join-by-code /
 * join-by-invite), the P3 {@link GameSourceCoordinator} (game transfer
 * status per player), the S1 {@link NovaSession} attached to the already-
 * joined private transport, the local runtime frame (U3), and the
 * ready → start → end lifecycle. The UI is a pure projection of the state
 * snapshot.
 *
 * Roles (ADR-0004/0007): the party creator, the rendezvous greeter, and the
 * current internal authority are SEPARATE roles. The engine only reports
 * them; S3 formalizes authority. Party secrets (the session secret and the
 * derived room/password) live in {@link PartySession} memory and never
 * enter game runtime messages (the game plane rides `nova.protocol`; party
 * control rides `nova.party`; game source rides `nova.source`).
 *
 * Transport-neutral for tests: the same engine runs over
 * {@link TrysteroTransport} in production and over the in-memory hub with
 * injected seams (fake clock, fake runtime bridge) in deterministic tests.
 */
import type { GameMode, MemberId, PartyCode } from "@rocketcrab/protocol";
import type { TransportConnectionState } from "@rocketcrab/core";
import {
  GameSourceCoordinator,
  PartyError,
  buildInviteUrl,
  createParty,
  joinPartyByCode,
  joinPartyByInvite,
  type GameSourceTransferEvent,
  type JoinRequestInfo,
  type PartyEvent,
  type PartySession,
  type PartyTransportFactory,
  type Scheduler,
} from "@rocketcrab/party";
import type { NovaAction, NovaSessionEvent } from "@rocketcrab/nova-api";
import { createNovaSession } from "@rocketcrab/nova-api";
import { RuntimeHostClient, type ChannelPort, type RuntimeHostEvent } from "../runtime-host";
import { arenaApiCallSchemas } from "../arena/api-calls";
import { runtimeOriginForMainOrigin } from "../runtime-origin";
import { localPartyIdentity, updatePartyDisplayName } from "./identity";
import { browserLifecycleSource, type PartyLifecycleSource } from "./lifecycle";
import { clearPartyRecovery, savePartyRecovery } from "./party-recovery";
import { createTrysteroPartyTransportFactory } from "./transport-factory";

/** Runtime-bridge test seams (no-op in production; mirror U6's arena). */
export interface PartyRuntimeSeams {
  createChannel?: () => { port1: ChannelPort; port2: unknown };
  waitForFrameLoad?: (iframe: HTMLIFrameElement) => Promise<void>;
  bootstrapTimeoutMs?: number;
}

/** Injectable secret derivation (deterministic tests). */
export type PartySecretDerivation = (secret: string) => Promise<{
  readonly secret: string;
  readonly roomId: string;
  readonly password: string;
  readonly sessionId: string;
}>;

/** The lobby's view of one party member. */
export interface PartyMemberView {
  readonly memberId: MemberId;
  readonly displayName: string;
  readonly isSelf: boolean;
  readonly connectionId: string | null;
  readonly connected: boolean;
  readonly isGreeter: boolean;
  /** P3 game-source transfer status (per player). */
  readonly transferState:
    | "none"
    | "waiting"
    | "transferring"
    | "complete"
    | "failed"
    | "incompatible";
  /** Transfer fraction in [0, 1], or null when not transferring. */
  readonly transferProgress: number | null;
  /** Human detail: byte progress or the failure reason. */
  readonly transferDetail: string | null;
  /** True once the player's game loaded + registered (S1 ready lifecycle). */
  readonly ready: boolean;
}

/** A pending admission request shown to the greeter for approval. */
export interface JoinRequestView extends JoinRequestInfo {
  readonly id: string;
}

/** Connection diagnostics (adapter-specific when available). */
export interface PartyDiagnostics {
  readonly connectionState: TransportConnectionState;
  readonly selfConnectionId: string;
  readonly room: string;
  readonly sessionId: string | null;
  readonly relays: Array<{ url: string; readyState: number; connected: boolean }> | null;
  readonly joinErrors: Array<{ category: string; message: string }> | null;
  readonly peers: Array<{ memberId: string; connectionId: string; displayName?: string }>;
  readonly lastQuality: Array<{ memberId: string; pingMs: number | null; sampledAt: number }>;
}

/** One lobby notice (non-blocking; a failed peer never freezes the lobby). */
export interface PartyNotice {
  readonly id: string;
  readonly level: "info" | "warn" | "error";
  readonly message: string;
}

export type PartyPhase =
  | "idle"
  | "creating"
  | "joining"
  | "lobby"
  | "starting"
  | "playing"
  | "reconnecting"
  | "error";

/** The full engine snapshot the UI projects. */
export interface PartyEngineState {
  readonly phase: PartyPhase;
  /** Human-readable progress for the creating/joining phases. */
  readonly phaseDetail: string | null;
  /** Reconnect attempts since the last connected state (reconnect UX). */
  readonly reconnectAttempts: number;
  readonly role: "creator" | "joiner" | null;
  readonly code: PartyCode | null;
  readonly memberId: MemberId;
  readonly displayName: string;
  readonly game: { gameId: string; title: string; mode: GameMode } | null;
  readonly members: readonly PartyMemberView[];
  readonly pendingJoinRequests: readonly JoinRequestView[];
  readonly greeterMemberId: MemberId | null;
  readonly amGreeter: boolean;
  /** Current internal authority — DIAGNOSTIC ONLY (S3 formalizes). */
  readonly authorityMemberId: MemberId | null;
  readonly inviteUrl: string | null;
  readonly connectionState: TransportConnectionState;
  readonly canStart: boolean;
  readonly canForceStart: boolean;
  readonly startBlockedReason: string | null;
  /** Set after the game ended; the lobby returns with this banner. */
  readonly endedReason: string | null;
  readonly diagnostics: PartyDiagnostics | null;
  readonly notices: readonly PartyNotice[];
  readonly lastError: string | null;
}

/** Engine configuration (defaults to the real Trystero + runtime bridge). */
export interface PartyEngineConfig {
  transportFactory?: PartyTransportFactory;
  runtimeOrigin?: string;
  seams?: PartyRuntimeSeams;
  /** Player identity override (tests run several engines on one page). */
  identity?: { memberId: string; displayName: string };
  /** Party-layer scheduler (deterministic tests). */
  schedule?: Scheduler;
  /** Page-lifecycle events (default: real browser events; tests inject). */
  lifecycle?: PartyLifecycleSource;
  /** Party-layer secret derivation (deterministic tests). */
  derive?: PartySecretDerivation;
  /** Forwarded to the party layer (tests/UX tuning). */
  collisionListenMs?: number;
  collisionRetries?: number;
  discoveryTimeoutMs?: number;
  /** Fail-fast "no party here" window for code joins (default 7 s; 7.10). */
  earlyMissTimeoutMs?: number;
  admissionTimeoutMs?: number;
  advertIntervalMs?: number;
  /** Adapter diagnostics (Trystero getDiagnostics); duck-typed when present. */
  diagnostics?: () => unknown;
}

/** The game the party is playing, as the coordinator reports it. */
interface PartyGame {
  readonly gameId: string;
  readonly title: string;
  readonly mode: GameMode;
}

/** Transfer bookkeeping per member (send side) or for self (receive side). */
interface TransferState {
  fraction: number;
  bytesTransferred: number;
  totalBytes: number;
  state: PartyMemberView["transferState"];
  detail: string | null;
}

interface PendingApproval {
  readonly request: JoinRequestInfo;
  resolve: (approved: boolean) => void;
}

const MAX_NOTICES = 12;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

let noticeCounter = 0;

function makeNotice(level: PartyNotice["level"], message: string): PartyNotice {
  noticeCounter += 1;
  return { id: `notice-${noticeCounter}`, level, message };
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

/** The game the local player will boot (host source or received source). */
export interface PartySourceSpec {
  readonly gameId: string;
  readonly title: string;
  readonly mode: GameMode;
  readonly source: string;
  readonly apiVersion?: number;
}

interface PartyEngineDefaults {
  transportFactory: PartyTransportFactory;
  runtimeOrigin: string;
  seams: PartyRuntimeSeams;
  collisionListenMs: number;
  collisionRetries: number;
  discoveryTimeoutMs: number;
  earlyMissTimeoutMs: number;
  admissionTimeoutMs: number;
  advertIntervalMs: number;
}

/** How long the resume health probe waits for one peer's ping (M1). */
const PARTY_HEALTH_PROBE_TIMEOUT_MS = 2_000;
/** First auto-reconnect retry delay after a failed attempt (M1). */
const RECONNECT_RETRY_BASE_MS = 5_000;
/** Auto-reconnect retry backoff cap (M1). */
const RECONNECT_RETRY_CAP_MS = 30_000;

/** Injectable scheduler for engine-owned timers (defaults to setTimeout). */
function defaultScheduler(callback: () => void, delayMs: number): () => void {
  const id = setTimeout(callback, delayMs);
  return () => {
    clearTimeout(id);
  };
}

/** The last setup attempt, so the error screen can retry it (7.10). */
type LastSetup =
  | { kind: "create"; input: PartySourceSpec | undefined }
  | { kind: "join-code"; code: string }
  | { kind: "join-invite"; input: { secret: string; code?: string } };

/** A stable member identity (ADR-0007); defaults to the page identity. */
interface PartyMemberIdentity {
  readonly memberId: string;
  displayName: string;
}

export class PartyEngine {
  private readonly defaults: PartyEngineDefaults;
  private identity: PartyMemberIdentity;
  private readonly schedule?: Scheduler;
  private readonly scheduleFn: Scheduler;
  private readonly derive?: PartySecretDerivation;
  private readonly diagnosticsProvider?: () => unknown;
  private readonly lifecycle: PartyLifecycleSource;
  private readonly lifecycleUnsubscribers: Array<() => void> = [];

  private readonly listeners = new Set<(state: PartyEngineState) => void>();
  private party: PartySession | null = null;
  private coordinator: GameSourceCoordinator | null = null;
  private session: ReturnType<typeof createNovaSession> | null = null;
  private unsubSession: (() => void) | null = null;
  private unsubParty: (() => void) | null = null;
  private unsubTransport: Array<() => void> = [];
  private unsubCoordinator: (() => void) | null = null;

  private runtime: RuntimeHostClient | null = null;
  private container: HTMLElement | null = null;
  private pendingSource: PartySourceSpec | null = null;
  private frameStarted = false;
  private registered = false;

  private pendingApprovals = new Map<MemberId, PendingApproval>();
  private transfers = new Map<MemberId, TransferState>();
  private game: PartyGame | null = null;
  private selfVerified = false;
  private endedReason: string | null = null;
  private leaving = false;
  private notices: PartyNotice[] = [];
  private lastError: string | null = null;
  private lastSetup: LastSetup | null = null;
  private lastDiagnostics: unknown = null;

  private phase: PartyPhase = "idle";
  private phaseDetail: string | null = null;
  private connectionState: TransportConnectionState = "idle";
  /** True once this shell's game started (survives reconnects; M1). */
  private gameStarted = false;

  // M1 lifecycle bookkeeping (ADR-0012/B6).
  private pageWasHidden = false;
  private offline = false;
  private reconnectAttempts = 0;
  private reconnectRetryTimer: (() => void) | null = null;

  constructor(config: PartyEngineConfig = {}) {
    this.defaults = {
      transportFactory: config.transportFactory ?? createTrysteroPartyTransportFactory(),
      runtimeOrigin: config.runtimeOrigin ?? defaultRuntimeOrigin(),
      seams: config.seams ?? {},
      collisionListenMs: config.collisionListenMs ?? 2_000,
      collisionRetries: config.collisionRetries ?? 4,
      discoveryTimeoutMs: config.discoveryTimeoutMs ?? 20_000,
      earlyMissTimeoutMs: config.earlyMissTimeoutMs ?? 7_000,
      admissionTimeoutMs: config.admissionTimeoutMs ?? 30_000,
      advertIntervalMs: config.advertIntervalMs ?? 5_000,
    };
    this.identity = config.identity ?? localPartyIdentity();
    this.schedule = config.schedule;
    this.scheduleFn = config.schedule ?? defaultScheduler;
    this.derive = config.derive;
    this.diagnosticsProvider = config.diagnostics;
    this.lifecycle = config.lifecycle ?? browserLifecycleSource();
    this.subscribeLifecycle();
  }

  // ------------------------------------------------------------------
  // Public surface
  // ------------------------------------------------------------------

  /** The current state snapshot. */
  getState(): PartyEngineState {
    const party = this.party;
    const identity = this.identity;
    const members = this.buildMembers();
    const allReady = members.length > 0 && members.every((member) => member.ready);
    const allVerified =
      members.length > 0 &&
      members.every((member) =>
        member.isSelf ? this.selfVerified : this.isSourceVerified(member.memberId),
      );
    const anyFailed = members.some(
      (member) => member.transferState === "failed" || member.transferState === "incompatible",
    );
    const ended = this.session?.isEnded() ?? false;
    const inLobby = this.phase === "lobby";

    let startBlockedReason: string | null = null;
    if (!inLobby) {
      startBlockedReason = "The party is not in the lobby yet.";
    } else if (this.game === null) {
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
      const waiting = members.find((member) => !this.isSourceVerified(member.memberId));
      startBlockedReason =
        waiting === undefined
          ? "Waiting for the game to reach every player."
          : `Waiting for ${waiting.displayName} to receive the game.`;
    } else if (!allReady) {
      startBlockedReason = "Waiting for every player's game to load and register.";
    }

    return {
      phase: this.phase,
      phaseDetail: this.phaseDetail,
      reconnectAttempts: this.reconnectAttempts,
      role: party?.role ?? null,
      code: party?.code ?? null,
      memberId: identity.memberId,
      displayName: identity.displayName,
      game: this.game,
      members,
      pendingJoinRequests: [...this.pendingApprovals.values()].map((entry) => ({
        ...entry.request,
        id: `join-request-${entry.request.memberId}`,
      })),
      greeterMemberId: party?.greeterMemberId ?? null,
      amGreeter: party?.amGreeter ?? false,
      authorityMemberId: this.computeAuthorityMemberId(members),
      inviteUrl: this.buildInviteUrl(),
      connectionState: this.connectionState,
      canStart: inLobby && this.game !== null && !ended && !anyFailed && allVerified && allReady,
      canForceStart:
        inLobby && this.game !== null && !ended && !anyFailed && allVerified && !allReady,
      startBlockedReason,
      endedReason: this.endedReason,
      diagnostics: this.buildDiagnostics(),
      notices: [...this.notices],
      lastError: this.lastError,
    };
  }

  /** Subscribe to state snapshots; returns an unsubscribe function. */
  onState(handler: (state: PartyEngineState) => void): () => void {
    this.listeners.add(handler);
    handler(this.getState());
    return () => {
      this.listeners.delete(handler);
    };
  }

  /** True while a party session (or one being established) exists. */
  isActive(): boolean {
    return this.phase !== "idle" || this.party !== null;
  }

  /** The container hosting the local runtime frame (bound by the UI). */
  setContainer(element: HTMLElement | null): void {
    if (element === this.container) {
      return;
    }
    if (this.container !== null && element !== null && this.runtime !== null) {
      // The UI remounted a fresh container (route change): rebuild the
      // frame so the game keeps running in the new spot.
      this.runtime.dispose();
      this.runtime = null;
      this.frameStarted = false;
      this.registered = false;
    }
    this.container = element;
    void this.maybeBootFrame();
  }

  // ------------------------------------------------------------------
  // Party entry points
  // ------------------------------------------------------------------

  /**
   * Create a party from a game source (saved game or current editor
   * source). Resolves when the party is live and the lobby is ready.
   */
  /**
   * Create a party. With a game ({@link PartySourceSpec}) the host registers
   * and announces it immediately (the classic start-from-editor flow);
   * without one the host lands in the lobby with no game selected and can
   * pick one later via {@link selectGame} (7.6 — classic start-a-party flow).
   */
  async createParty(input?: PartySourceSpec): Promise<void> {
    this.prepareSetup();
    const identity = this.identity;
    this.lastSetup = { kind: "create", input };
    this.phase = "creating";
    this.phaseDetail = "Generating your room code…";
    this.lastError = null;
    this.emit();
    try {
      const party = await createParty({
        memberId: identity.memberId,
        displayName: identity.displayName,
        transportFactory: this.defaults.transportFactory,
        partyName: "Nova party",
        gameTitle: input?.title ?? "Nova party",
        onJoinRequest: (request) => this.queueApproval(request),
        collisionListenMs: this.defaults.collisionListenMs,
        collisionRetries: this.defaults.collisionRetries,
        advertIntervalMs: this.defaults.advertIntervalMs,
        ...(this.schedule !== undefined ? { schedule: this.schedule } : {}),
        ...(this.derive !== undefined ? { derive: this.derive } : {}),
      });
      // The user cancelled while the room was being created: drop the
      // session instead of resurrecting a party behind their back.
      if (this.leaving) {
        await party.leave().catch(() => undefined);
        return;
      }
      await this.establish(party);
      this.game =
        input === undefined ? null : { gameId: input.gameId, title: input.title, mode: input.mode };
      this.phase = "lobby";
      this.phaseDetail = null;
      this.lastSetup = null;
      this.saveRecovery();
      this.emit();
      // The host holds the verified source from the start; register and
      // announce it, then boot the local runtime frame.
      if (input !== undefined) {
        this.registerSource(input);
      }
    } catch (error) {
      this.failSetup(error);
    }
  }

  /** Join a party by its four-letter code. */
  async joinByCode(code: string): Promise<void> {
    this.prepareSetup();
    const identity = this.identity;
    this.lastSetup = { kind: "join-code", code };
    this.phase = "joining";
    this.phaseDetail = `Joining party ${code.toUpperCase()}…`;
    this.lastError = null;
    this.emit();
    try {
      const party = await joinPartyByCode({
        code,
        memberId: identity.memberId,
        displayName: identity.displayName,
        transportFactory: this.defaults.transportFactory,
        onJoinRequest: (request) => this.queueApproval(request),
        discoveryTimeoutMs: this.defaults.discoveryTimeoutMs,
        earlyMissTimeoutMs: this.defaults.earlyMissTimeoutMs,
        admissionTimeoutMs: this.defaults.admissionTimeoutMs,
        advertIntervalMs: this.defaults.advertIntervalMs,
        ...(this.schedule !== undefined ? { schedule: this.schedule } : {}),
        ...(this.derive !== undefined ? { derive: this.derive } : {}),
      });
      // The user cancelled while joining: drop the session instead of
      // resurrecting a party behind their back.
      if (this.leaving) {
        await party.leave().catch(() => undefined);
        return;
      }
      await this.establish(party);
      this.phase = "lobby";
      this.phaseDetail = null;
      this.lastSetup = null;
      this.saveRecovery();
      this.emit();
      void this.coordinator
        ?.refresh()
        .catch((error: unknown) =>
          this.addNotice("warn", `Could not ask the party for the game: ${errorMessage(error)}`),
        );
    } catch (error) {
      this.failSetup(error);
    }
  }

  /** Join a party from an invite-link secret (ADR-0011). */
  async joinByInvite(input: { secret: string; code?: string }): Promise<void> {
    this.prepareSetup();
    const identity = this.identity;
    this.lastSetup = { kind: "join-invite", input };
    this.phase = "joining";
    this.phaseDetail = "Joining the party from your invite…";
    this.lastError = null;
    this.emit();
    try {
      const party = await joinPartyByInvite({
        secret: input.secret,
        ...(input.code !== undefined ? { code: input.code } : {}),
        memberId: identity.memberId,
        displayName: identity.displayName,
        transportFactory: this.defaults.transportFactory,
        onJoinRequest: (request) => this.queueApproval(request),
        advertIntervalMs: this.defaults.advertIntervalMs,
        ...(this.schedule !== undefined ? { schedule: this.schedule } : {}),
        ...(this.derive !== undefined ? { derive: this.derive } : {}),
      });
      // The user cancelled while joining: drop the session instead of
      // resurrecting a party behind their back.
      if (this.leaving) {
        await party.leave().catch(() => undefined);
        return;
      }
      await this.establish(party);
      this.phase = "lobby";
      this.phaseDetail = null;
      this.lastSetup = null;
      this.saveRecovery();
      this.emit();
      void this.coordinator
        ?.refresh()
        .catch((error: unknown) =>
          this.addNotice("warn", `Could not ask the party for the game: ${errorMessage(error)}`),
        );
    } catch (error) {
      this.failSetup(error);
    }
  }

  /**
   * Pick a game for a party that was started without one (7.6). The caller
   * loads the saved game from the repository and passes the source here;
   * the host then registers/announces it and boots the local frame.
   */
  async selectGame(input: PartySourceSpec): Promise<void> {
    if (this.phase !== "lobby" || this.party === null) {
      return;
    }
    this.game = { gameId: input.gameId, title: input.title, mode: input.mode };
    this.emit();
    this.registerSource(input);
  }

  /**
   * Update this player's display name (7.5): persists it for next time and
   * applies it locally immediately. Peers see the new name on their next
   * handshake/rejoin (the transport bakes names into the handshake).
   */
  setDisplayName(name: string): void {
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      return;
    }
    updatePartyDisplayName(trimmed);
    this.identity = { ...this.identity, displayName: trimmed };
    this.emit();
  }

  /**
   * Re-run the last setup attempt (create / join-by-code / join-by-invite)
   * after a failure. Used by the error screen's retry (7.10) — the previous
   * flow called leave instead, which toasted "you left the party" over the
   * navbar and left a blank page.
   */
  retrySetup(): void {
    const last = this.lastSetup;
    if (last === null || this.party !== null) {
      return;
    }
    if (last.kind === "create") {
      void this.createParty(last.input);
    } else if (last.kind === "join-code") {
      void this.joinByCode(last.code);
    } else {
      void this.joinByInvite(last.input);
    }
  }

  /**
   * Clear a failed setup and return to the entry UI. Unlike leave, this
   * never toasts or tears down anything (there is nothing to tear down).
   */
  dismissError(): void {
    if (this.phase !== "error") {
      return;
    }
    this.lastError = null;
    this.phase = "idle";
    this.phaseDetail = null;
    this.notices = [];
    this.emit();
  }

  // ------------------------------------------------------------------
  // Lobby controls
  // ------------------------------------------------------------------

  /** The greeter approves or rejects one pending join request. */
  respondToJoinRequest(memberId: MemberId, approved: boolean): void {
    const pending = this.pendingApprovals.get(memberId);
    if (pending === undefined) {
      return;
    }
    this.pendingApprovals.delete(memberId);
    pending.resolve(approved);
    this.addNotice(
      approved ? "info" : "warn",
      approved
        ? `${this.displayNameOf(memberId)} was admitted to the party.`
        : `${this.displayNameOf(memberId)} was not admitted.`,
    );
    this.emit();
  }

  /**
   * Start the game. All members must be ready; `force` starts once every
   * member has verified the game source even if some are not ready yet
   * (starting is never allowed before the source is verified).
   */
  startGame(force = false): void {
    const state = this.getState();
    if (!force && !state.canStart) {
      this.addNotice("warn", state.startBlockedReason ?? "The party is not ready to start.");
      this.emit();
      return;
    }
    if (force && !state.canForceStart && !state.canStart) {
      this.addNotice("warn", state.startBlockedReason ?? "The party is not ready to start.");
      this.emit();
      return;
    }
    this.phase = "starting";
    this.phaseDetail = null;
    this.emit();
    this.session?.start();
    // The session's local "start" event flips the phase to playing.
  }

  /**
   * Emergency party teardown: end the game for EVERYONE and return to the
   * lobby (T6/T21 — the stop control lives outside the game frame).
   */
  endGame(reason: "user_exit" | "host_closed" | "error" = "host_closed"): void {
    this.session?.end(reason);
    this.runtime?.destroy(reason);
    this.runtime = null;
    this.frameStarted = false;
    this.registered = false;
  }

  /**
   * Leave the party cleanly: destroy the runtime frame, detach every
   * listener, dispose the coordinator and session, and leave BOTH Trystero
   * rooms (rule 22). Resolves once cleanup completes.
   */
  async leaveParty(): Promise<void> {
    if (!this.isActive()) {
      return;
    }
    this.leaving = true;
    for (const pending of this.pendingApprovals.values()) {
      pending.resolve(false);
    }
    this.pendingApprovals.clear();
    this.runtime?.destroy("user_exit");
    this.runtime = null;
    this.frameStarted = false;
    this.registered = false;
    if (this.unsubSession !== null) {
      this.unsubSession();
      this.unsubSession = null;
    }
    this.session?.dispose();
    this.session = null;
    this.unsubCoordinator?.();
    this.unsubCoordinator = null;
    this.coordinator?.dispose();
    this.coordinator = null;
    for (const unsubscribe of this.unsubTransport) {
      unsubscribe();
    }
    this.unsubTransport = [];
    this.unsubParty?.();
    this.unsubParty = null;
    const party = this.party;
    this.party = null;
    if (party !== null) {
      await party.leave().catch(() => undefined);
    }
    this.pendingSource = null;
    this.game = null;
    this.transfers.clear();
    this.selfVerified = false;
    this.endedReason = null;
    this.notices = [];
    this.lastError = null;
    this.lastSetup = null;
    this.phase = "idle";
    this.phaseDetail = null;
    this.gameStarted = false;
    this.reconnectAttempts = 0;
    this.offline = false;
    this.pageWasHidden = false;
    this.cancelReconnectRetry();
    clearPartyRecovery();
    this.leaving = false;
    this.emit();
  }

  /**
   * Reconnect after the party connection dropped (reconnect screen, M1).
   * Also handles the F11 case: a backgrounded phone whose WebRTC link iOS
   * killed silently — the transport still reports "connected", so the
   * engine forces a fresh connection (suspend + resume) to rejoin cleanly
   * instead of sitting on a stale handle.
   */
  async reconnect(): Promise<void> {
    const transport = this.party?.privateTransport;
    if (transport === undefined || this.leaving) {
      return;
    }
    this.reconnectAttempts += 1;
    this.phase = "reconnecting";
    this.phaseDetail = `Reconnecting… (attempt ${this.reconnectAttempts})`;
    this.emit();
    const party = this.party;
    if (party === null) {
      return;
    }
    try {
      if (transport.connectionState === "connected") {
        // A link that looks alive but whose peers stopped answering (the
        // backgrounded-phone case): force a fresh connection id (F11).
        await transport.suspend();
      }
      if (transport.connectionState === "suspended") {
        await transport.resume();
      } else if (
        transport.connectionState === "idle" ||
        transport.connectionState === "disconnected"
      ) {
        // A failed attempt tore the room down (relay_unreachable / join
        // timeout while temporarily offline): re-join the private room from
        // the party material with a fresh connection.
        await transport.join({
          room: party.material.roomId,
          sessionId: party.material.sessionId,
        });
      } else {
        // Mid-join (joining): the connection:state handler settles the phase.
        return;
      }
      // The transport "connection:state" handler settles the phase.
    } catch (error) {
      this.addNotice("error", `Reconnect failed: ${errorMessage(error)}`);
      this.phaseDetail = `Reconnect failed (attempt ${this.reconnectAttempts}) — will retry automatically.`;
      this.emit();
      this.scheduleReconnectRetry();
    }
  }

  /** Refresh adapter diagnostics (relay state, join errors, pings). */
  async refreshDiagnostics(): Promise<void> {
    const transport = this.party?.privateTransport;
    this.lastDiagnostics = this.diagnosticsProvider?.() ?? null;
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

  // ------------------------------------------------------------------
  // M1 lifecycle handling (ADR-0012/B6)
  // ------------------------------------------------------------------

  /** Subscribe to the page-lifecycle events (once per engine). */
  private subscribeLifecycle(): void {
    this.lifecycleUnsubscribers.push(
      this.lifecycle.onVisibilityChange((hidden) => {
        if (hidden) {
          this.handlePageHidden();
        } else {
          this.handlePageResumed();
        }
      }),
      this.lifecycle.onPageHide(() => this.handlePageHidden()),
      this.lifecycle.onPageShow(() => this.handlePageResumed()),
      this.lifecycle.onOnline(() => this.handleOnline()),
      this.lifecycle.onOffline(() => this.handleOffline()),
    );
  }

  /** The page went to the background (Mobile Safari suspends it). */
  private handlePageHidden(): void {
    this.pageWasHidden = true;
    // Timers are unreliable while hidden (B6): cancel any pending retry so
    // a reconnect burst never fires on resume; the resume probe re-decides.
    this.cancelReconnectRetry();
  }

  /**
   * The page came back (foreground / pageshow): re-sync the runtime frame
   * and verify the party connection is actually alive. A backgrounded
   * phone's WebRTC can die without the transport noticing (F11); the
   * health probe detects that and rejoins with a fresh connection.
   */
  private handlePageResumed(): void {
    this.pageWasHidden = false;
    if (this.leaving) {
      return;
    }
    if (!this.isInPartyPhase(this.phase)) {
      return;
    }
    this.recoverRuntimeAfterResume();
    void this.checkPartyConnectionAfterResume();
  }

  /** The browser reports the network went away (`offline`). */
  private handleOffline(): void {
    if (this.leaving || !this.isInPartyPhase(this.phase)) {
      return;
    }
    this.offline = true;
    if (this.phase === "reconnecting") {
      this.scheduleReconnectRetry();
    } else {
      this.enterReconnecting("You're offline. Nova will reconnect when the network returns.");
    }
  }

  /** The network came back (`online`): retry immediately. */
  private handleOnline(): void {
    this.offline = false;
    if (this.leaving || this.phase !== "reconnecting") {
      return;
    }
    this.addNotice("info", "You're back online — reconnecting.");
    void this.reconnect();
  }

  /** True for phases where the party connection matters. */
  private isInPartyPhase(phase: PartyPhase): boolean {
    return (
      phase === "lobby" || phase === "starting" || phase === "playing" || phase === "reconnecting"
    );
  }

  /**
   * After a background/foreground cycle the runtime frame may have been
   * suspended or killed by the OS; reload it when it is gone or wedged.
   */
  private recoverRuntimeAfterResume(): void {
    const runtime = this.runtime;
    if (runtime === null || this.leaving) {
      return;
    }
    const diagnostic = runtime.diagnose();
    if (diagnostic.ready && !diagnostic.unresponsive) {
      return;
    }
    this.addNotice(
      "warn",
      "Your game's runtime was suspended while the page was away — reloading it.",
    );
    this.emit();
    void runtime.restart().catch((error: unknown) => {
      this.addNotice("error", `The game could not be reloaded: ${errorMessage(error)}`);
      this.emit();
    });
  }

  /**
   * Verify the party connection after a resume. Transports that report
   * suspended/disconnected already entered the reconnect flow via their
   * connection:state handler; transports that still report connected but
   * whose peers stopped answering (F11 — iOS killed the WebRTC link while
   * backgrounded) get a fresh connection.
   */
  private async checkPartyConnectionAfterResume(): Promise<void> {
    const transport = this.party?.privateTransport;
    if (transport === undefined || this.leaving) {
      return;
    }
    if (transport.connectionState === "suspended" || transport.connectionState === "disconnected") {
      this.enterReconnecting(
        "Your connection was suspended while the page was in the background. Reconnecting…",
      );
      void this.reconnect();
      return;
    }
    if (transport.connectionState !== "connected") {
      return; // joining: the state handler settles it
    }
    const peers = transport.peers;
    if (peers.length === 0) {
      return; // solo member: nothing to probe
    }
    const ping = (
      transport as unknown as { ping?: (connectionId: string) => Promise<number | null> }
    ).ping;
    if (typeof ping !== "function") {
      return; // transports without pings report connection state honestly
    }
    const answers = await Promise.all(
      peers.map((peer) => this.probePeer(ping, transport, peer.connectionId)),
    );
    if (answers.some((alive) => alive)) {
      return; // at least one peer answers: the connection is healthy
    }
    this.addNotice(
      "warn",
      "Your phone's connection went quiet in the background — reconnecting with a fresh connection.",
    );
    this.enterReconnecting("Your connection went quiet in the background. Reconnecting…");
    void this.reconnect();
  }

  /** Ping one peer with a hard timeout; true = the peer answered. */
  private probePeer(
    ping: (connectionId: string) => Promise<number | null>,
    transport: unknown,
    connectionId: string,
  ): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (alive: boolean): void => {
        if (settled) {
          return;
        }
        settled = true;
        cancel();
        resolve(alive);
      };
      const cancel = this.scheduleFn(() => finish(false), PARTY_HEALTH_PROBE_TIMEOUT_MS);
      void Promise.resolve(ping.call(transport, connectionId))
        .then((pingMs) => finish(pingMs !== null))
        .catch(() => finish(false));
    });
  }

  /** Auto-retry the reconnect with backoff (cancelled on success/leave). */
  private scheduleReconnectRetry(): void {
    if (this.leaving) {
      return;
    }
    this.cancelReconnectRetry();
    const delayMs = Math.min(
      RECONNECT_RETRY_CAP_MS,
      RECONNECT_RETRY_BASE_MS * 2 ** Math.max(0, this.reconnectAttempts - 1),
    );
    this.reconnectRetryTimer = this.scheduleFn(() => {
      this.reconnectRetryTimer = null;
      if (this.leaving || this.phase !== "reconnecting") {
        return;
      }
      this.addNotice("info", "Retrying the connection automatically…");
      void this.reconnect();
    }, delayMs);
  }

  private cancelReconnectRetry(): void {
    if (this.reconnectRetryTimer !== null) {
      this.reconnectRetryTimer();
      this.reconnectRetryTimer = null;
    }
  }

  /**
   * Persist local recovery information (M1): code, invite secret, identity,
   * and the game — enough for a one-tap rejoin after a page reload.
   */
  private saveRecovery(): void {
    const party = this.party;
    if (party === null) {
      return;
    }
    savePartyRecovery({
      role: party.role,
      code: party.code,
      secret: party.secret,
      memberId: this.identity.memberId,
      displayName: this.identity.displayName,
      game:
        this.game === null
          ? null
          : { gameId: this.game.gameId, title: this.game.title, mode: this.game.mode },
    });
  }

  // ------------------------------------------------------------------
  // Setup internals
  // ------------------------------------------------------------------

  /** Wire the party session, coordinator, S1 session, and transport events. */
  private async establish(party: PartySession): Promise<void> {
    this.party = party;
    this.connectionState = party.privateTransport.connectionState;
    this.unsubParty = party.onEvent((event) => this.handlePartyEvent(event));
    this.unsubTransport = [
      party.privateTransport.on("connection:state", (state) => this.handleTransportState(state)),
    ];
    this.coordinator = new GameSourceCoordinator({
      transport: party.privateTransport,
    });
    this.unsubCoordinator = this.coordinator.subscribe((event) =>
      this.handleCoordinatorEvent(event),
    );
    const session = createNovaSession({
      transport: party.privateTransport,
      room: party.material.roomId,
      sessionId: party.material.sessionId,
      player: {
        memberId: this.identity.memberId,
        displayName: this.identity.displayName,
      },
      game: { gameId: "party", mode: "state" },
    });
    this.session = session;
    this.unsubSession = session.onSessionEvent((event) => this.handleSessionEvent(event));
    await session.attach();
  }

  /** The host registers the verified source and announces it to the party. */
  private registerSource(input: PartySourceSpec): void {
    this.pendingSource = input;
    void this.maybeBootFrame();
    const coordinator = this.coordinator;
    if (coordinator === null) {
      return;
    }
    void coordinator
      .setSource({
        gameId: input.gameId,
        title: input.title,
        apiVersion: input.apiVersion,
        mode: input.mode,
        source: input.source,
      })
      .then(() => {
        this.selfVerified = true;
        this.transfers.set(this.identity.memberId, {
          fraction: 1,
          bytesTransferred: input.source.length,
          totalBytes: input.source.length,
          state: "complete",
          detail: "You have the game",
        });
        this.emit();
      })
      .catch((error: unknown) => {
        this.addNotice("error", `Could not register the game: ${errorMessage(error)}`);
        this.emit();
      });
  }

  /** Queue a joiner's admission request for the greeter's approval. */
  private queueApproval(request: JoinRequestInfo): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      this.pendingApprovals.set(request.memberId, { request, resolve });
      this.emit();
    });
  }

  private failSetup(error: unknown): void {
    this.lastError = errorMessage(error);
    this.phase = "error";
    this.phaseDetail = null;
    this.emit();
  }

  // ------------------------------------------------------------------
  // Runtime frame
  // ------------------------------------------------------------------

  private async maybeBootFrame(): Promise<void> {
    if (this.frameStarted || this.runtime !== null || this.container === null) {
      return;
    }
    const source = this.pendingSource;
    if (source === null) {
      return;
    }
    this.frameStarted = true;
    const client = new RuntimeHostClient({
      runtimeOrigin: this.defaults.runtimeOrigin,
      container: this.container,
      onEvent: (event) => this.handleHostEvent(event),
      ...(this.defaults.seams.createChannel !== undefined
        ? { createChannel: this.defaults.seams.createChannel }
        : {}),
      ...(this.defaults.seams.waitForFrameLoad !== undefined
        ? { waitForFrameLoad: this.defaults.seams.waitForFrameLoad }
        : {}),
      ...(this.defaults.seams.bootstrapTimeoutMs !== undefined
        ? { bootstrapTimeoutMs: this.defaults.seams.bootstrapTimeoutMs }
        : {}),
    });
    this.runtime = client;
    try {
      await client.load({
        gameId: source.gameId,
        gameMode: source.mode,
        gameSource: source.source,
        player: {
          memberId: this.identity.memberId,
          displayName: this.identity.displayName,
        },
        gameTitle: source.title,
        sessionId: this.party?.material.sessionId,
      });
    } catch (error) {
      this.runtime = null;
      this.frameStarted = false;
      this.registered = false;
      const message = errorMessage(error);
      this.addNotice("error", `Your game could not start: ${message}`);
      this.emit();
    }
  }

  private handleHostEvent(event: RuntimeHostEvent): void {
    switch (event.type) {
      case "registration":
        this.registered = true;
        this.addNotice("info", "Your game loaded and registered.");
        // Ready = the game loaded + registered (P4 deliverable); the game's
        // own nova.ready() call is also routed (idempotent in the session).
        this.session?.ready();
        this.emit();
        break;
      case "apiCall":
        this.routeApiCall(event.message);
        break;
      case "error":
        this.addNotice(
          "error",
          `Runtime error (${event.message.category}): ${event.message.message}`,
        );
        this.emit();
        break;
      case "fatal":
        this.addNotice("error", event.message);
        this.emit();
        break;
      case "unresponsive":
        this.addNotice("warn", "Your game stopped answering — it may be wedged.");
        this.emit();
        break;
      case "responsive":
        this.addNotice("info", "Your game is responsive again.");
        this.emit();
        break;
      case "port-closed":
        this.addNotice("warn", "Your game's runtime channel closed — reloading it.");
        this.emit();
        if (this.runtime !== null && !this.leaving) {
          void this.runtime.restart().catch((error: unknown) => {
            this.addNotice("error", `The game could not be reloaded: ${errorMessage(error)}`);
            this.emit();
          });
        }
        break;
      case "ready":
      case "metadata":
      case "console":
      case "lifecycle":
        break; // handled by the runtime; not lobby-facing in P4
    }
  }

  /** Route the game's Nova API calls into the attached session (U6 parity). */
  private routeApiCall(message: { method: string; payload: unknown }): void {
    const session = this.session;
    if (session === null) {
      return;
    }
    const payload = message.payload as Record<string, unknown>;
    switch (message.method) {
      case "ready":
        if (arenaApiCallSchemas.ready.safeParse(payload).success) {
          session.ready();
        }
        break;
      case "dispatch": {
        const parsed = arenaApiCallSchemas.dispatch.safeParse(payload);
        if (parsed.success) {
          void session
            .dispatch(parsed.data.action as NovaAction, parsed.data.actionId)
            .catch((error: unknown) =>
              this.addNotice("error", `nova.dispatch() failed: ${errorMessage(error)}`),
            );
        }
        break;
      }
      case "raw.createChannel": {
        const parsed = arenaApiCallSchemas["raw.createChannel"].safeParse(payload);
        if (parsed.success) {
          try {
            session.createRawChannel(parsed.data.spec);
          } catch (error) {
            this.addNotice("error", `nova.raw.createChannel() failed: ${errorMessage(error)}`);
          }
        }
        break;
      }
      case "raw.send": {
        const parsed = arenaApiCallSchemas["raw.send"].safeParse(payload);
        if (parsed.success) {
          void session
            .sendRaw(parsed.data.name, parsed.data.payload, parsed.data.options ?? {})
            .catch((error: unknown) =>
              this.addNotice("error", `nova.raw.send() failed: ${errorMessage(error)}`),
            );
        }
        break;
      }
      case "raw.close": {
        const parsed = arenaApiCallSchemas["raw.close"].safeParse(payload);
        if (parsed.success) {
          try {
            session.closeRawChannel(parsed.data.name);
          } catch (error) {
            this.addNotice("error", `nova.raw.close() failed: ${errorMessage(error)}`);
          }
        }
        break;
      }
      case "simulation.register":
        if (arenaApiCallSchemas["simulation.register"].safeParse(payload).success) {
          session.registerSimulation();
        }
        break;
      case "simulation.sendInput": {
        const parsed = arenaApiCallSchemas["simulation.sendInput"].safeParse(payload);
        if (parsed.success) {
          try {
            session.sendSimulationInput(parsed.data.input);
          } catch (error) {
            this.addNotice("error", `nova.simulation.sendInput() failed: ${errorMessage(error)}`);
          }
        }
        break;
      }
    }
  }

  // ------------------------------------------------------------------
  // Event routing
  // ------------------------------------------------------------------

  private handlePartyEvent(event: PartyEvent): void {
    switch (event.type) {
      case "joinRequest":
        // Already queued by the approval policy; just refresh the UI.
        this.emit();
        break;
      case "admission":
        this.addNotice(
          event.decision === "approved" ? "info" : "warn",
          event.decision === "approved"
            ? `${this.displayNameOf(event.memberId)} joined the party.`
            : `${this.displayNameOf(event.memberId)} was not admitted (${event.reason ?? "rejected"}).`,
        );
        this.emit();
        break;
      case "memberJoined":
      case "memberLeft":
        this.emit();
        break;
      case "greeter":
        this.addNotice(
          "info",
          event.greeterMemberId === this.identity.memberId
            ? "You are now the party greeter (the four-letter code's host)."
            : `${this.displayNameOf(event.greeterMemberId)} is now the party greeter.`,
        );
        this.emit();
        break;
      case "collision":
        this.addNotice("warn", "Your code collided with another party; a new code was generated.");
        this.emit();
        break;
      case "error": {
        const error = event.error;
        if (error instanceof PartyError && error.code === "connection_lost") {
          this.enterReconnecting("The party connection was lost.");
          return;
        }
        this.addNotice("error", errorMessage(error));
        this.emit();
        break;
      }
    }
  }

  private handleTransportState(state: TransportConnectionState): void {
    this.connectionState = state;
    if (this.leaving) {
      return;
    }
    if (state === "suspended" || state === "disconnected") {
      if (this.phase !== "idle" && this.phase !== "joining" && this.phase !== "creating") {
        this.enterReconnecting("The party connection was lost. Reconnect to keep playing.");
      }
      return;
    }
    if (state === "connected") {
      this.reconnectAttempts = 0;
      this.offline = false;
      this.cancelReconnectRetry();
      // gameStarted (not session.isStarted()) decides the phase: followers
      // never broadcast start themselves, so isStarted() is false for them
      // even while their game is running (M1 restore-after-reconnect).
      this.phase = this.gameStarted ? "playing" : "lobby";
      this.phaseDetail = null;
      this.emit();
      // Re-announce the game after a rejoin so this member's coordinator
      // has current metadata and can request any missing source (M1).
      void this.coordinator
        ?.refresh()
        .catch((error: unknown) =>
          this.addNotice("warn", `Could not ask the party for the game: ${errorMessage(error)}`),
        );
    }
  }

  private enterReconnecting(detail: string): void {
    if (this.phase === "reconnecting") {
      return;
    }
    this.phase = "reconnecting";
    this.phaseDetail = detail;
    this.emit();
    this.scheduleReconnectRetry();
  }

  private handleCoordinatorEvent(event: GameSourceTransferEvent): void {
    switch (event.type) {
      case "metadata": {
        if (this.game === null) {
          this.game = {
            gameId: event.metadata.gameId,
            title: event.metadata.title ?? "Untitled game",
            mode: event.metadata.mode ?? "state",
          };
        }
        this.saveRecovery();
        this.emit();
        break;
      }
      case "transferStart": {
        this.recordTransfer(this.transferTarget(event), {
          state: "transferring",
          fraction: 0,
          detail: null,
        });
        this.emit();
        break;
      }
      case "progress": {
        this.recordTransfer(this.transferTarget(event), {
          state: "transferring",
          fraction: event.progress.fraction,
          detail: `${formatBytes(event.progress.bytesTransferred)} of ${formatBytes(event.progress.totalBytes)}`,
        });
        this.emit();
        break;
      }
      case "complete": {
        const target = this.transferTarget(event);
        this.recordTransfer(target, {
          state: "complete",
          fraction: 1,
          detail: "Game received",
        });
        if (event.direction === "receive") {
          // The peer who SENT us the game obviously holds a verified source;
          // mark its row complete so this player's start gate can open.
          this.markSourceVerified(event.memberId, "Sent you the game");
        }
        this.addNotice(
          "info",
          event.direction === "send"
            ? `${this.displayNameOf(target)} received the game.`
            : "You received the game.",
        );
        this.emit();
        break;
      }
      case "received": {
        this.selfVerified = true;
        this.recordTransfer(this.identity.memberId, {
          state: "complete",
          fraction: 1,
          detail: "Game received",
        });
        // The sender (the host) holds the verified source too.
        this.markSourceVerified(event.fromMemberId, "Sent you the game");
        // The joiner can now boot its runtime frame with the verified source.
        this.pendingSource = {
          gameId: event.gameId,
          title: this.game?.title ?? "Untitled game",
          mode: this.game?.mode ?? "state",
          source: event.source,
        };
        this.addNotice("info", "You received the game — starting it now.");
        this.emit();
        void this.maybeBootFrame();
        break;
      }
      case "verificationFailed": {
        this.recordTransfer(this.identity.memberId, {
          state: "failed",
          fraction: null,
          detail: event.errorMessage,
        });
        this.addNotice(
          "error",
          `Game verification failed for ${this.displayNameOf(this.identity.memberId)}: ${event.errorMessage}`,
        );
        this.emit();
        break;
      }
      case "cancelled": {
        const target = this.transferTarget(event);
        this.recordTransfer(target, {
          state: "failed",
          fraction: null,
          detail: event.reason ?? "cancelled",
        });
        this.addNotice(
          "warn",
          `Game transfer ${event.direction} for ${this.displayNameOf(target)} was cancelled${event.reason === undefined ? "." : ` (${event.reason}).`}`,
        );
        this.emit();
        break;
      }
      case "incompatible": {
        this.recordTransfer(this.identity.memberId, {
          state: "incompatible",
          fraction: null,
          detail: event.reason,
        });
        this.addNotice("error", `This build cannot run the game: ${event.reason}`);
        this.emit();
        break;
      }
      case "retry": {
        this.recordTransfer(this.transferTarget(event), {
          state: "transferring",
          fraction: null,
          detail: `Retrying transfer (attempt ${event.attempt})…`,
        });
        this.emit();
        break;
      }
      case "warning": {
        this.addNotice("warn", event.message);
        this.emit();
        break;
      }
      case "error": {
        this.handleTransferError(event.error);
        this.emit();
        break;
      }
    }
  }

  /**
   * The member whose lobby row shows a transfer event's state. Send-side
   * events concern the named member; receive-side events concern THIS
   * player (the joiner receiving from the host, or this player's own
   * verification failures).
   */
  private transferTarget(event: GameSourceTransferEvent): MemberId {
    const self = this.identity.memberId;
    switch (event.type) {
      case "progress":
        return event.progress.direction === "receive" ? self : event.progress.memberId;
      case "transferStart":
      case "complete":
      case "retry":
      case "cancelled":
        return event.direction === "receive" ? self : event.memberId;
      case "received":
      case "verificationFailed":
      case "incompatible":
        return self;
      default:
        return self; // never reached: every transfer event has a case
    }
  }

  private handleTransferError(error: { code: string; message: string }): void {
    // Host side: terminal receiver failures name the peer in the message
    // ("Peer <id> could not receive ..."). Joiner side: failures concern
    // this player's own receive transfer.
    const peerMatch = /^Peer (\S+) could not receive/u.exec(error.message);
    const memberId = peerMatch?.[1] ?? this.identity.memberId;
    this.recordTransfer(memberId, {
      state: "failed",
      fraction: null,
      detail: error.message,
    });
    this.addNotice("error", error.message);
  }

  private handleSessionEvent(event: NovaSessionEvent): void {
    switch (event.type) {
      case "connection":
        this.connectionState = "connected";
        break;
      case "start":
        this.gameStarted = true;
        this.phase = "playing";
        this.phaseDetail = null;
        this.addNotice("info", "The game started.");
        this.emit();
        break;
      case "end":
        this.gameStarted = false;
        this.endedReason = event.reason;
        this.phase = "lobby";
        this.phaseDetail = null;
        this.addNotice(
          "info",
          `The game ended${event.reason === undefined ? "." : ` (${event.reason}).`}`,
        );
        this.emit();
        break;
      case "playerJoined":
      case "playerLeft":
        this.emit();
        break;
      case "error":
        this.addNotice("error", `Nova error (${event.error.code}): ${event.error.message}`);
        this.emit();
        break;
      default:
        break; // raw/state/simulation events route to the frame only
    }
  }

  // ------------------------------------------------------------------
  // State helpers
  // ------------------------------------------------------------------

  private buildMembers(): PartyMemberView[] {
    const party = this.party;
    const identity = this.identity;
    const peers = party?.privateTransport.peers ?? [];
    const memberIds = party === null ? [identity.memberId] : party.members;
    const members: PartyMemberView[] = [];
    for (const memberId of memberIds) {
      const peer = peers.find((candidate) => candidate.memberId === memberId);
      const transfer = this.transfers.get(memberId);
      const isSelf = memberId === identity.memberId;
      let transferState: PartyMemberView["transferState"];
      let transferProgress: number | null;
      let transferDetail: string | null;
      if (isSelf) {
        if (this.selfVerified) {
          transferState = "complete";
          transferProgress = 1;
          transferDetail = "You have the game";
        } else if (transfer !== undefined) {
          transferState = transfer.state;
          transferProgress = transfer.fraction;
          transferDetail = transfer.detail;
        } else {
          transferState = "waiting";
          transferProgress = null;
          transferDetail = null;
        }
      } else if (transfer !== undefined) {
        transferState = transfer.state;
        transferProgress = transfer.fraction;
        transferDetail = transfer.detail;
      } else {
        transferState = "waiting";
        transferProgress = null;
        transferDetail = null;
      }
      members.push({
        memberId,
        displayName: this.displayNameOf(memberId),
        isSelf,
        connectionId: peer?.connectionId ?? null,
        connected: isSelf ? isConnectedState(this.connectionState) : peer !== undefined,
        isGreeter: memberId === party?.greeterMemberId,
        transferState,
        transferProgress,
        transferDetail,
        ready: this.session?.readyOf(memberId) ?? false,
      });
    }
    return members;
  }

  private displayNameOf(memberId: MemberId): string {
    const identity = this.identity;
    if (memberId === identity.memberId) {
      return identity.displayName;
    }
    const peer = this.party?.privateTransport.peers.find(
      (candidate) => candidate.memberId === memberId,
    );
    return peer?.displayName ?? memberId;
  }

  /**
   * Diagnostic-only authority view. After the game starts (S3) the real
   * authority comes from the state engine's diagnostics; before that (the
   * lobby) the engine has not announced yet, so fall back to the first ready
   * member — the same deterministic choice the initial election makes.
   * Greeter status is a separate role (ADR-0007) and never used here.
   */
  private computeAuthorityMemberId(members: readonly PartyMemberView[]): MemberId | null {
    const engineAuthority = this.session?.getStateModeDiagnostics().authorityMemberId ?? null;
    return engineAuthority ?? members.find((member) => member.ready)?.memberId ?? null;
  }

  private isSourceVerified(memberId: MemberId): boolean {
    if (memberId === this.identity.memberId) {
      return this.selfVerified;
    }
    return this.transfers.get(memberId)?.state === "complete";
  }

  /** Mark a member as holding a verified game source. */
  private markSourceVerified(memberId: MemberId, detail: string): void {
    const previous = this.transfers.get(memberId);
    const existing: TransferState = previous ?? {
      fraction: 1,
      bytesTransferred: 0,
      totalBytes: 0,
      state: "complete",
      detail: null,
    };
    this.transfers.set(memberId, {
      ...existing,
      state: "complete",
      fraction: 1,
      detail,
    });
  }

  private recordTransfer(
    memberId: MemberId,
    update: {
      state: PartyMemberView["transferState"];
      fraction: number | null;
      detail: string | null;
    },
  ): void {
    const previous = this.transfers.get(memberId);
    const existing: TransferState = previous ?? {
      fraction: 0,
      bytesTransferred: 0,
      totalBytes: 0,
      state: "waiting",
      detail: null,
    };
    const next: TransferState = {
      ...existing,
      state: update.state,
      fraction: update.fraction ?? existing.fraction,
      detail: update.detail,
    };
    this.transfers.set(memberId, next);
  }

  private buildInviteUrl(): string | null {
    const party = this.party;
    const code = party?.code;
    if (party === null || code === undefined || code === null) {
      return null;
    }
    try {
      return buildInviteUrl({
        baseUrl: `${defaultBaseUrl()}/join`,
        code,
        secret: party.secret,
      });
    } catch {
      return null;
    }
  }

  private buildDiagnostics(): PartyDiagnostics | null {
    const party = this.party;
    if (party === null) {
      return null;
    }
    const transport = party.privateTransport;
    const transportRoom = (transport as { roomName?: string }).roomName ?? "";
    const raw = this.diagnosticsProvider?.() ?? this.lastDiagnostics;
    const adapter = raw as {
      connectionState?: TransportConnectionState;
      selfConnectionId?: string;
      room?: string;
      sessionId?: string | null;
      relays?: Array<{ url: string; readyState: number; connected: boolean }> | null;
      joinErrors?: Array<{ category: string; message: string }> | null;
      peers?: Array<{ memberId: string; connectionId: string; displayName?: string }>;
      lastQuality?: Array<{ memberId: string; pingMs: number | null; sampledAt: number }>;
    } | null;
    return {
      connectionState: adapter?.connectionState ?? transport.connectionState,
      selfConnectionId: adapter?.selfConnectionId ?? transport.selfConnectionId,
      room: adapter?.room ?? transportRoom,
      sessionId: adapter?.sessionId ?? transport.sessionId,
      relays: adapter?.relays ?? null,
      joinErrors: adapter?.joinErrors ?? null,
      peers: adapter?.peers ?? transport.peers.map((peer) => ({ ...peer })),
      lastQuality: adapter?.lastQuality ?? [],
    };
  }

  private addNotice(level: PartyNotice["level"], message: string): void {
    this.notices = [...this.notices, makeNotice(level, message)].slice(-MAX_NOTICES);
  }

  private prepareSetup(): void {
    // A live party blocks a second setup; a leftover error phase (failed
    // join/create) does NOT — a retry must be able to start cleanly (7.10).
    if (this.party !== null || this.session !== null) {
      throw new PartyError(
        "invalid_state",
        "A party is already active on this page; leave it before starting another.",
      );
    }
    this.leaving = false;
    this.lastError = null;
    this.phase = "idle";
    this.phaseDetail = null;
    this.notices = [];
    this.emit();
  }

  private emit(): void {
    const state = this.getState();
    for (const handler of this.listeners) {
      handler(state);
    }
  }
}

/** The page's party engine (module-level so routes never kill a party). */
export const partyEngine = new PartyEngine();

function isConnectedState(state: TransportConnectionState): boolean {
  return state === "connected";
}

function defaultRuntimeOrigin(): string {
  if (typeof window === "undefined") {
    return "http://localhost:5174";
  }
  return runtimeOriginForMainOrigin(window.location.origin);
}

function defaultBaseUrl(): string {
  return typeof window === "undefined" ? "http://localhost:5173" : window.location.origin;
}
