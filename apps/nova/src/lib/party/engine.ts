/**
 * The party engine: the shell-owned state machine behind the lobby and
 * the game-launch flow.
 *
 * One engine per page (the {@link partyEngine} singleton), so route
 * remounts never kill a party or leak Trystero rooms. The engine owns the
 * private invite PartySession, verified source distribution, NovaSession, the
 * local runtime, and the ready/start/end lifecycle.
 * The UI projects shell snapshots.
 *
 * Shell host and game authority are separate roles. The host is selected from
 * private-room membership; authority reconciliation belongs to nova-api.
 * Party secrets (including the derived room/password) live in {@link PartySession} memory and never
 * enter game runtime messages (the game plane rides `nova.protocol`; party
 * control rides `nova.party`; game source rides `nova.source`).
 *
 * Transport-neutral for tests: the same engine runs over
 * {@link TrysteroTransport} in production and over the in-memory hub with
 * injected seams (fake clock, fake runtime bridge) in deterministic tests.
 */
import { handshakeTimeoutMs } from "@rocketcrab/protocol";
import type { GameApiEvent, GameMode, MemberId } from "@rocketcrab/protocol";
import type { TransportConnectionState } from "@rocketcrab/core";
import {
  GameSourceCoordinator,
  PartyError,
  buildInviteUrl,
  createParty,
  joinPartyByInvite,
  type GameSourceTransferEvent,
  type PartyEvent,
  type PartySession,
  type PartyTransportFactory,
  type Scheduler,
} from "@rocketcrab/party";
import type { NovaAction, NovaSessionEvent } from "@rocketcrab/nova-api";
import {
  createNovaSession,
  LocalGameExecutor,
  LocalSimulationExecutor,
  type NovaGameContext,
  type NovaPlayer,
  type NovaSimulationExecutor,
  type NovaStateExecutor,
  type NovaStateStateResult,
  type NovaStateViewResult,
} from "@rocketcrab/nova-api";
import { RuntimeHostClient, type ChannelPort, type RuntimeHostEvent } from "../runtime-host";
import { arenaApiCallSchemas } from "../arena/api-calls";
import { toApiEvent } from "../arena/api-events";
import type { ArenaLogEntry } from "../arena/types";
import {
  createFrameSimulationExecutor,
  createFrameStateExecutor,
  type FrameSimulationExecutor,
  type FrameSimulationResponsePayload,
  type FrameStateExecutor,
  type FrameStateResponsePayload,
} from "../arena/state-executor";
import { runtimeOriginForMainOrigin } from "../runtime-origin";
import { findClassicGame, type ClassicGameConnectResult } from "../classic";
import {
  connectionErrorCategory,
  connectionErrorMessage,
  roomErrorCategory,
} from "./connection-errors";
import { localPartyIdentity, updatePartyDisplayName } from "./identity";
import { browserLifecycleSource, type PartyLifecycleSource } from "./lifecycle";
import { clearPartyRecovery, savePartyRecovery } from "./party-recovery";
import { createTrysteroPartyTransportFactory } from "./transport-factory";
import { SignalingOutage } from "./signaling-outage";
import {
  fetchTurnCredentials,
  turnCredsConfigured,
  TURN_CREDS_TTL_MS,
  type TurnCredentialsResult,
  type TurnServerConfigLike,
} from "./turn-creds";

/** Runtime-bridge test seams. */
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
  readonly isHost: boolean;
  /** Game-source transfer status (per player). */
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
  /** True once the player's game loaded + registered. */
  readonly ready: boolean;
}

/** Connection diagnostics (adapter-specific when available). */
export interface PartyDiagnostics {
  readonly connectionState: TransportConnectionState;
  readonly selfConnectionId: string;
  readonly room: string;
  readonly sessionId: string | null;
  /** Whether the room's signaling socket is open, or null if unknown. */
  readonly signalingConnected: boolean | null;
  readonly joinErrors: Array<{ category: string; message: string }> | null;
  readonly peers: Array<{
    memberId: string;
    connectionId: string;
    displayName?: string;
    /** True when the pair runs on the edge tunnel (PLAN.md §5, §7 stage 3). */
    tunnelled?: boolean;
  }>;
  readonly lastQuality: Array<{ memberId: string; pingMs: number | null; sampledAt: number }>;
  /**
   * TURN credential state: "configured" when minted
   * credentials were baked into the transports, "unavailable" when the mint
   * failed (the party proceeded without TURN), "disabled" when the build
   * pins no mint origin, and null while unknown (no setup attempted yet or
   * an injected test factory).
   */
  readonly turn: "configured" | "unavailable" | "disabled" | null;
}

/** One lobby notice (non-blocking; a failed peer never freezes the lobby). */
export interface PartyNotice {
  readonly id: string;
  readonly level: "info" | "warn" | "error";
  readonly message: string;
}

/**
 * Peer-link alert (PLAN.md §7): "connecting" while a peer connection switches
 * onto the edge tunnel; "failed" once a tunnelled pair fails terminally, which
 * stays until the user retries or leaves. Null otherwise, including every
 * healthy native pair. Trystero does not expose the peer on these hooks, so
 * the alert is generic and never names a player.
 */
export type PeerLinkStatus = "connecting" | "failed" | null;

export type PartyPhase =
  | "idle"
  | "creating"
  | "joining"
  | "lobby"
  | "starting"
  | "playing"
  | "reconnecting"
  | "removed"
  | "error";

/**
 * Where a code/invite join is inside the "joining" phase. Lets the loading
 * screen say something accurate instead of a generic "searching": the join
 * request is away and the host must approve, or the joiner
 * is admitted and waiting for a direct peer connection before the lobby
 * may appear. Null outside the joining phase.
 */
export type JoinStage = "discovering" | "connecting" | null;

/** The full engine snapshot the UI projects. */
export interface PartyEngineState {
  readonly phase: PartyPhase;
  /** Human-readable progress for the creating/joining phases. */
  readonly phaseDetail: string | null;
  /** Sub-stage while joining (see {@link JoinStage}). */
  readonly joinStage: JoinStage;
  /** Reconnect attempts since the last connected state (reconnect UX). */
  readonly reconnectAttempts: number;
  readonly role: "creator" | "joiner" | null;
  readonly memberId: MemberId;
  readonly displayName: string;
  readonly game: { gameId: string; title: string; mode: GameMode } | null;
  readonly members: readonly PartyMemberView[];
  readonly hostMemberId: MemberId | null;
  readonly amHost: boolean;
  /** Current internal authority — DIAGNOSTIC ONLY. */
  readonly authorityMemberId: MemberId | null;
  readonly inviteUrl: string | null;
  readonly connectionState: TransportConnectionState;
  readonly canStart: boolean;
  readonly canForceStart: boolean;
  readonly startBlockedReason: string | null;
  /** Set after the game ended; the lobby returns with this banner. */
  readonly endedReason: string | null;
  /**
   * Classic external iframe game for the party: the host creates
   * the room once and shares the URL spec so every player embeds the same
   * room with their own name. Null for Nova API games.
   */
  readonly classicGame: {
    readonly gameId: string;
    readonly title: string;
    readonly connectResult: ClassicGameConnectResult;
  } | null;
  /** Non-null when the host removed this member from the party. */
  readonly removedReason: string | null;
  /**
   * Bumped to remount the classic iframe.
   */
  readonly classicFrameEpoch: number;
  readonly diagnostics: PartyDiagnostics | null;
  readonly signalingOutage?: boolean;
  readonly notices: readonly PartyNotice[];
  readonly lastError: string | null;
  readonly setupFailureCode?: "room-full" | "decrypt-failed" | null;
  /** Generic peer-link alert (PLAN.md §7); see {@link PeerLinkStatus}. */
  readonly peerLink: PeerLinkStatus;
  /** Ring buffer of the game's runtime console output, for the in-game Logs panel. */
  readonly runtimeLogs: readonly ArenaLogEntry[];
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
  /** Wall-clock override for credential leases (deterministic tests). */
  now?: () => number;
  /** Page-lifecycle events (default: real browser events; tests inject). */
  lifecycle?: PartyLifecycleSource;
  /** Party-layer secret derivation (deterministic tests). */
  derive?: PartySecretDerivation;
  /**
   * How long an admitted code/invite joiner waits for the first private-room
   * peer before the join fails (default 15 s). Cross-network joins can signal
   * fine while no data channel opens without TURN, so the joiner must land on
   * a loading → error path instead of a fake empty lobby.
   */
  peerConnectTimeoutMs?: number;
  /** Adapter diagnostics (Trystero getDiagnostics); duck-typed when present. */
  diagnostics?: () => unknown;
  /**
   * TURN credential mint fetch. Defaults to the real
   * mint client ({@link fetchTurnCredentials}); tests inject a deterministic
   * stub. Only consulted when no `transportFactory` is injected (the real
   * Trystero path) — injected factories own transport construction.
   */
  turnCreds?: () => Promise<TurnCredentialsResult>;
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

const MAX_NOTICES = 8;
/**
 * The host re-sends its start request this often until the authority starts the
 * game, so a request the authority rejected (its view of source verification can
 * lag) is retried. After START_RETRY_TIMEOUT_MS the host gives up and returns to
 * the lobby with a notice.
 */
const START_RETRY_INTERVAL_MS = 2_000;
/**
 * While a member's game source is still waiting, the lobby asks the party for it
 * again this often. A source announcement or accept can be lost on a fresh link,
 * and asking again makes the members re-announce it.
 */
const SOURCE_RETRANSMIT_INTERVAL_MS = 2_000;
const START_RETRY_TIMEOUT_MS = 30_000;
const START_GIVE_UP_MESSAGE = "Couldn't start the game. Try again.";
const UNSAFE_TEARDOWN_MESSAGE =
  "Couldn't close the previous party safely. Reload the page before joining another party.";
/** Cap for the party game's runtime console ring buffer. */
const MAX_PARTY_LOG_ENTRIES = 200;

let partyLogCounter = 0;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

let noticeCounter = 0;

function makeNotice(level: PartyNotice["level"], message: string): PartyNotice {
  noticeCounter += 1;
  return { id: `notice-${noticeCounter}`, level, message };
}

function leftNoticeMessage(displayName: string): string {
  return `${displayName} left the party.`;
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

/**
 * A classic external iframe game selected for the party: the room
 * was created once in the host's browser and the URL spec is shared with
 * every member through the party plane.
 */
interface ClassicSelection {
  readonly gameId: string;
  readonly title: string;
  readonly connectResult: ClassicGameConnectResult;
}

/** The party-plane payload for a classic room announcement. */
type ClassicAnnouncement = Parameters<PartySession["announceClassicRoom"]>[0];

interface PartyEngineDefaults {
  /** Injected factory (tests/embedders) or null → build the Trystero factory lazily. */
  transportFactory: PartyTransportFactory | null;
  turnCreds: () => Promise<TurnCredentialsResult>;
  runtimeOrigin: string;
  seams: PartyRuntimeSeams;
  peerConnectTimeoutMs: number;
}

/** How long the resume health probe waits for one peer's ping. */
const PARTY_HEALTH_PROBE_TIMEOUT_MS = 2_000;
/** First auto-reconnect retry delay after a failed attempt. */
const RECONNECT_RETRY_BASE_MS = 5_000;
/** Auto-reconnect retry backoff cap. */
const RECONNECT_RETRY_CAP_MS = 30_000;
/**
 * How long an admitted joiner waits for a private-room peer before giving up.
 * Signaling can connect without any peer data channel ever opening (no TURN
 * across networks), so the joiner must NOT see a fake empty lobby: a loading
 * screen, then a clear error, is the honest outcome.
 */
const DEFAULT_PEER_CONNECT_TIMEOUT_MS = 15_000;
/**
 * How long a "Connecting to a player…" alert may stand without a pairing or a
 * failure (PLAN.md §7). A switched pair that closes quietly reports nothing,
 * so the alert must expire on its own. Matches the transport handshake timeout.
 */
const PEER_LINK_CONNECTING_WINDOW_MS = handshakeTimeoutMs;

/** Injectable scheduler for engine-owned timers (defaults to setTimeout). */
function defaultScheduler(callback: () => void, delayMs: number): () => void {
  const id = setTimeout(callback, delayMs);
  return () => {
    clearTimeout(id);
  };
}

/** The last setup attempt, so the error screen can retry it. */
type LastSetup =
  | { kind: "create"; input: PartySourceSpec | undefined }
  | { kind: "join-invite"; input: { secret: string } };

/** A stable member identity (ADR-0007); defaults to the page identity. */
interface PartyMemberIdentity {
  readonly memberId: string;
  displayName: string;
}

/**
 * The party's state executor: the NovaSession runs the game's state handlers
 * IN the runtime frame. The engine forwards `stateRequest` apiEvents into the
 * frame and correlates the `stateResponse` apiCalls back. When no runtime frame
 * exists (classic games, whose iframe the UI embeds directly, or a frame that
 * failed to boot), requests fall back to no-op semantics (empty `{}` state, no
 * views) so the start flow still completes instead of timing out on the frame
 * executor. `runtime()` is read at call time so a rebooted frame is always the
 * target.
 */
class PartyStateExecutor implements NovaStateExecutor {
  private readonly frame: FrameStateExecutor;
  private readonly local = new LocalGameExecutor(null);
  private readonly runtime: () => RuntimeHostClient | null;

  constructor(runtime: () => RuntimeHostClient | null) {
    this.runtime = runtime;
    this.frame = createFrameStateExecutor((event) => runtime()?.pushApiEvent(event));
  }

  createInitialState(input: {
    context: NovaGameContext;
    viewers: readonly NovaPlayer[];
  }): Promise<NovaStateStateResult> {
    return this.runtime() !== null
      ? this.frame.createInitialState(input)
      : this.local.createInitialState(input);
  }

  applyAction(input: {
    actionId: string;
    type: string;
    payload: unknown;
    state: unknown;
    context: NovaGameContext;
    viewers: readonly NovaPlayer[];
  }): Promise<NovaStateStateResult> {
    return this.runtime() !== null ? this.frame.applyAction(input) : this.local.applyAction(input);
  }

  computeView(input: { state: unknown; viewer: NovaPlayer }): Promise<NovaStateViewResult> {
    return this.runtime() !== null ? this.frame.computeView(input) : this.local.computeView(input);
  }

  /** Route a frame `stateResponse` apiCall back to its pending request. */
  handleResponse(payload: FrameStateResponsePayload): void {
    this.frame.handleResponse(payload);
  }

  dispose(): void {
    this.frame.dispose();
  }
}

/**
 * The party's simulation executor: forwards `simulationRequest` apiEvents to
 * the frame (the game's `serializeState` snapshot callback) and correlates
 * `simulationResponse`s. Falls back to the no-handler local executor when no
 * runtime frame exists (classic games, or a boot failure).
 */
class PartySimulationExecutor implements NovaSimulationExecutor {
  private readonly frame: FrameSimulationExecutor;
  private readonly local = new LocalSimulationExecutor(null);
  private readonly runtime: () => RuntimeHostClient | null;

  constructor(runtime: () => RuntimeHostClient | null) {
    this.runtime = runtime;
    this.frame = createFrameSimulationExecutor((event) => runtime()?.pushApiEvent(event));
  }

  serializeState(): Promise<
    | { readonly ok: true; readonly state: unknown }
    | { readonly ok: false; readonly code: string; readonly message: string }
  > {
    return this.runtime() !== null ? this.frame.serializeState() : this.local.serializeState();
  }

  /** Route a frame `simulationResponse` apiCall back to its request. */
  handleResponse(payload: FrameSimulationResponsePayload): void {
    this.frame.handleResponse(payload);
  }

  dispose(): void {
    this.frame.dispose();
  }
}

export class PartyEngine {
  private readonly defaults: PartyEngineDefaults;
  private identity: PartyMemberIdentity;
  private readonly schedule: Scheduler;
  /** Cancels the pending start-request retry, if any (see startGame). */
  private cancelStartRetry: (() => void) | null = null;
  /** Milliseconds of start-request retry left before the host gives up. */
  private startRetryRemainingMs = 0;
  /** Cancels the pending source re-request while a member's source is waiting. */
  private cancelSourceRetransmit: (() => void) | null = null;
  private readonly derive?: PartySecretDerivation;
  private readonly diagnosticsProvider?: () => unknown;
  private readonly lifecycle: PartyLifecycleSource;
  private readonly lifecycleUnsubscribers: Array<() => void> = [];

  /** Page-local mint result; reused while its 24 h lease is valid. */
  private turnCredsCache: {
    readonly turnConfig: readonly TurnServerConfigLike[];
    readonly expiresAt: number;
  } | null = null;
  private readonly now: () => number;
  /** Latest TURN credential outcome, surfaced in engine diagnostics. */
  private turnStatus: "configured" | "unavailable" | "disabled" | null = null;
  /** Generic peer-link alert (PLAN.md §7); see {@link PeerLinkStatus}. */
  private peerLink: PeerLinkStatus = null;
  private cancelPeerLinkWindow: (() => void) | null = null;
  /** Members removed by a kick: their leave is already announced, so skip the "left" notice. */
  private readonly removedMemberIds = new Set<MemberId>();

  private readonly listeners = new Set<(state: PartyEngineState) => void>();
  private party: PartySession | null = null;
  private signalingOutageVisible = false;
  private readonly signalingOutage: SignalingOutage;
  private unsubscribeSignaling: (() => void) | null = null;
  private setupAbort: AbortController | null = null;
  private pendingSetupTransport: { leave(): Promise<void> } | null = null;
  private leaveInFlight: Promise<void> | null = null;
  private cancelWaitingSetup: (() => void) | null = null;
  private teardownFailed = false;
  private signalingConnected: boolean | null = null;
  private readonly signalingListeners = new Set<(connected: boolean) => void>();
  private coordinator: GameSourceCoordinator | null = null;
  private session: ReturnType<typeof createNovaSession> | null = null;
  private unsubSession: (() => void) | null = null;
  private unsubParty: (() => void) | null = null;
  private unsubTransport: Array<() => void> = [];
  private unsubCoordinator: (() => void) | null = null;

  private runtime: RuntimeHostClient | null = null;
  private container: HTMLElement | null = null;
  private pendingSource: PartySourceSpec | null = null;
  private classic: ClassicSelection | null = null;
  private classicFrameEpoch = 0;
  private removedReason: string | null = null;
  private frameStarted = false;
  private registered = false;
  /**
   * Whether the current frame instance has received `start`. Reset when a new
   * frame boots, so each frame instance gets `start` exactly once.
   */
  private frameStartDelivered = false;
  /**
   * A reload was requested and the runtime has not reported it yet. Until then a
   * registration comes from the old frame: a reload keeps the same channel and
   * instance id, so the message itself cannot say which frame sent it.
   */
  private reloadPending = false;

  /**
   * Frame executors: the NovaSession runs the game's state and simulation
   * handlers IN the runtime frame, as the arena does.
   */
  private stateExecutor: PartyStateExecutor | null = null;
  private simulationExecutor: PartySimulationExecutor | null = null;
  /**
   * The last self state view forwarded to the frame. The lobby → playing phase
   * flip rebinds the frame container, which reboots the runtime frame; the
   * fresh frame misses the initial `state` event, so the view is replayed by
   * {@link pushSessionSnapshot} when the rebooted frame registers.
   */
  private lastStateApiEvent: GameApiEvent | null = null;

  private transfers = new Map<MemberId, TransferState>();
  private game: PartyGame | null = null;
  private selfVerified = false;
  /** The source hash `selfVerified` is for (see adoptSourceHash). */
  private selfVerifiedSha256: string | null = null;
  /** The source hash the party announces now; any other verification is stale. */
  private currentSourceSha256: string | null = null;
  /** The hash each remote member last verified, send- or receive-side. */
  private verifiedSha256 = new Map<MemberId, string>();
  private endedReason: string | null = null;
  private leaving = false;
  private notices: PartyNotice[] = [];
  private lastError: string | null = null;
  private setupFailureCode: "room-full" | "decrypt-failed" | null = null;
  private observedJoinFailure: "room-full" | "decrypt-failed" | null = null;
  private setupPeerAdmitted = false;
  private activeErrorScope: object | null = null;
  private lastSetup: LastSetup | null = null;
  /** Ring-buffer of the game's runtime console output. */
  private runtimeLogs: ArenaLogEntry[] = [];
  private lastDiagnostics: unknown = null;

  private phase: PartyPhase = "idle";
  private phaseDetail: string | null = null;
  /** Join sub-stage while phase === "joining". */
  private joinStage: JoinStage = null;
  private connectionState: TransportConnectionState = "idle";
  /** True once this shell's game started. */
  private gameStarted = false;
  /** The host's start request was given up after START_RETRY_TIMEOUT_MS (diagnostics). */
  private startGaveUp = false;

  // Page-lifecycle bookkeeping.
  private pageWasHidden = false;
  private reconnectAttempts = 0;
  private reconnectInFlight: Promise<void> | null = null;
  private resumeCheckInFlight = false;
  private reconnectRetryTimer: (() => void) | null = null;

  constructor(config: PartyEngineConfig = {}) {
    // Diagnostics for stalled parties: window.__NOVA_PARTY_DEBUG__() returns
    // debugSnapshot(). The condition is inline so production builds drop it.
    if (import.meta.env.DEV || import.meta.env.MODE === "test") {
      (globalThis as { __NOVA_PARTY_DEBUG__?: () => unknown }).__NOVA_PARTY_DEBUG__ = () =>
        this.debugSnapshot();
    }
    this.defaults = {
      transportFactory: config.transportFactory ?? null,
      turnCreds: config.turnCreds ?? fetchTurnCredentials,
      runtimeOrigin: config.runtimeOrigin ?? defaultRuntimeOrigin(),
      seams: config.seams ?? {},
      peerConnectTimeoutMs: config.peerConnectTimeoutMs ?? DEFAULT_PEER_CONNECT_TIMEOUT_MS,
    };
    this.identity = config.identity ?? localPartyIdentity();
    this.schedule = config.schedule ?? defaultScheduler;
    this.signalingOutage = new SignalingOutage(this.schedule, (visible) => {
      this.signalingOutageVisible = visible;
      this.emit();
    });
    this.now = config.now ?? (() => Date.now());
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
    // Classic games have no HTML source to transfer or verify and no
    // runtime to register: the shared room announcement IS the source, so the
    // transfer and ready gates don't apply.
    const classicActive = this.classic !== null;
    const allReady =
      classicActive || (members.length > 0 && members.every((member) => member.ready));
    const allVerified = this.allSourcesVerified(members, classicActive);
    const anyFailed = classicActive
      ? false
      : members.some(
          (member) => member.transferState === "failed" || member.transferState === "incompatible",
        );
    const ended = this.session?.isEnded() ?? false;
    const inLobby = this.phase === "lobby";

    // The start button is only offered in the lobby, so no "not in the lobby"
    // message is needed. Outside the lobby the remaining gates (no game / ended
    // / transfer problems / not verified / not ready) still apply.
    let startBlockedReason: string | null = null;
    if (this.game === null) {
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
      joinStage: this.joinStage,
      reconnectAttempts: this.reconnectAttempts,
      role: party?.role ?? null,
      memberId: identity.memberId,
      displayName: identity.displayName,
      game: this.game,
      members,
      hostMemberId: party?.hostMemberId ?? null,
      amHost: party?.amHost ?? false,
      authorityMemberId: this.computeAuthorityMemberId(members),
      inviteUrl: this.buildInviteUrl(),
      connectionState: this.connectionState,
      canStart: inLobby && this.game !== null && !ended && !anyFailed && allVerified && allReady,
      canForceStart:
        inLobby && this.game !== null && !ended && !anyFailed && allVerified && !allReady,
      startBlockedReason,
      endedReason: this.endedReason,
      classicGame:
        this.classic === null
          ? null
          : {
              gameId: this.classic.gameId,
              title: this.classic.title,
              connectResult: this.classic.connectResult,
            },
      removedReason: this.removedReason,
      classicFrameEpoch: this.classicFrameEpoch,
      runtimeLogs: this.runtimeLogs,
      diagnostics: this.buildDiagnostics(),
      signalingOutage: this.signalingOutageVisible,
      notices: [...this.notices],
      lastError: this.lastError,
      setupFailureCode: this.setupFailureCode,
      peerLink: this.peerLink,
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
    // The UI rebinds the frame container on the lobby<->playing phase flip
    // (the same frame div renders inside a different tree, so React detaches
    // the old ref with null before attaching the new element). A runtime still
    // bound to the previous container is stale, because its iframe was removed
    // with the old node. Tear it down and reboot the frame in the new spot when
    // a fresh element arrives. A plain detach (null) leaves the runtime alone;
    // the leave path owns it.
    if (element !== null && this.runtime !== null) {
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
   * pick one later via {@link selectGame}.
   */
  async createParty(input?: PartySourceSpec): Promise<void> {
    if (this.leaveInFlight !== null && !(await this.waitForLeaveBeforeSetup())) return;
    if (this.rejectUnsafeSetup()) return;
    this.prepareSetup();
    const setup = this.setupAbort!;
    const identity = this.identity;
    this.lastSetup = { kind: "create", input };
    this.phase = "creating";
    this.phaseDetail = "Creating your private invite…";
    this.lastError = null;
    this.emit();
    try {
      const party = await createParty({
        memberId: identity.memberId,
        displayName: identity.displayName,
        transportFactory: this.observeSignaling(await this.resolveTransportFactory(), setup),
        ...(this.derive !== undefined ? { derive: this.derive } : {}),
      });
      // The user cancelled while the room was being created: drop the
      // session instead of resurrecting a party behind their back.
      if (setup.signal.aborted) {
        await party.leave().catch(() => undefined);
        return;
      }
      this.pendingSetupTransport = null;
      // The host's game is known BEFORE the session attaches, so
      // `establish` bakes the real mode into the NovaSession (state vs
      // simulation drives the whole runtime path).
      this.game =
        input === undefined ? null : { gameId: input.gameId, title: input.title, mode: input.mode };
      await this.establish(party);
      if (setup.signal.aborted) return;
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
      await this.finishFailedSetup(setup, error);
    } finally {
      if (this.setupAbort === setup) this.setupAbort = null;
    }
  }

  /** Join a party from an invite-link secret (ADR-0011). */
  async joinByInvite(input: { secret: string }): Promise<void> {
    if (this.leaveInFlight !== null && !(await this.waitForLeaveBeforeSetup())) return;
    if (this.rejectUnsafeSetup()) return;
    this.prepareSetup();
    const setup = this.setupAbort!;
    const identity = this.identity;
    const normalizedInput = input;
    this.lastSetup = { kind: "join-invite", input: normalizedInput };
    this.phase = "joining";
    this.joinStage = "discovering";
    this.phaseDetail = "Joining the party from your invite…";
    this.lastError = null;
    this.emit();
    try {
      const party = await joinPartyByInvite({
        secret: normalizedInput.secret,
        memberId: identity.memberId,
        displayName: identity.displayName,
        transportFactory: this.observeSignaling(await this.resolveTransportFactory(), setup),
        ...(this.derive !== undefined ? { derive: this.derive } : {}),
      });
      // The user cancelled while joining: drop the session instead of
      // resurrecting a party behind their back.
      if (setup.signal.aborted) {
        await party.leave().catch(() => undefined);
        return;
      }
      this.pendingSetupTransport = null;
      await this.establish(party);
      if (setup.signal.aborted) return;
      // Same peer gate as the code join: a stale invite (host offline) must
      // never drop the joiner into a fake empty lobby.
      try {
        await this.waitForPeerConnect(party, setup.signal);
      } catch (error) {
        if (this.party === null) {
          return; // cancelled while waiting — leaveParty already cleaned up
        }
        const lastSetup = this.lastSetup;
        await this.leaveParty("idle", true).catch(() => undefined);
        if (setup.signal.aborted) return;
        this.lastSetup = lastSetup;
        throw error;
      }
      if (this.party === null) {
        return; // cancelled while waiting — leaveParty already cleaned up
      }
      this.observedJoinFailure = null;
      this.phase = "lobby";
      this.phaseDetail = null;
      this.joinStage = null;
      this.lastSetup = null;
      this.saveRecovery();
      this.emit();
      void this.coordinator
        ?.refresh()
        .catch((error: unknown) =>
          this.addNotice("warn", `Could not ask the party for the game: ${errorMessage(error)}`),
        );
      this.askForClassicRoom();
    } catch (error) {
      await this.finishFailedSetup(setup, error);
    } finally {
      if (this.setupAbort === setup) this.setupAbort = null;
    }
  }

  /**
   * Pick a game for a party that was started without one. The caller
   * loads the saved game from the repository and passes the source here;
   * the host then registers/announces it and boots the local frame.
   */
  async selectGame(input: PartySourceSpec): Promise<void> {
    if (this.phase !== "lobby" || this.party === null || !this.party.amHost) {
      return;
    }
    this.game = { gameId: input.gameId, title: input.title, mode: input.mode };
    // Switching from a classic game to a Nova game: drop the classic room
    // (and any stale runtime from an earlier pick) so the Nova source owns
    // the frame.
    this.classic = null;
    this.teardownRuntimeFrame();
    // Nothing verifies the new source yet: the previous game's verification
    // must not open the start gate. registerSource re-verifies on success.
    this.selfVerified = false;
    this.selfVerifiedSha256 = null;
    this.currentSourceSha256 = null;
    await this.replaceGameSession(this.party);
    this.emit();
    this.registerSource(input);
  }

  /**
   * Host picks a classic external iframe game: the room is created
   * ONCE in the host's browser and the URL spec is shared with the whole
   * party through the party plane, so every player embeds the same room
   * with their own name (classic parity). Rejects silently when the caller
   * is not the creator or the party is not in the lobby.
   */
  async selectClassicGame(gameId: string): Promise<void> {
    if (this.phase !== "lobby" || this.party === null || !this.party?.amHost) {
      return;
    }
    const game = findClassicGame(gameId);
    if (game === undefined) {
      this.addNotice("error", `Unknown classic game "${gameId}".`);
      this.emit();
      return;
    }
    const party = this.party;
    try {
      const connectResult = await game.connectToGame();
      // The party was left while its room was being created: drop the result
      // so it cannot reach the next party.
      if (this.party !== party) return;
      this.classic = { gameId, title: game.name, connectResult };
      this.game = { gameId, title: game.name, mode: "state" };
      this.selfVerified = true;
      this.selfVerifiedSha256 = null;
      this.currentSourceSha256 = null;
      this.registered = true;
      // No Nova runtime frame for classic games — the UI embeds the iframe
      // directly from state.classicGame. Drop any previous Nova source.
      this.teardownRuntimeFrame();
      await this.party.announceClassicRoom(this.classicAnnouncement());
    } catch (error) {
      if (this.party !== party) return;
      this.addNotice("error", `Couldn't set up ${game.name}: ${errorMessage(error)}`);
    }
    this.emit();
  }

  /** Reload only the local game frame. */
  reloadMyGame(): void {
    if (this.classic !== null) {
      // Classic iframes are remounted by the UI keyed on this epoch.
      this.classicFrameEpoch += 1;
    } else {
      this.reloadRuntimeFrame();
    }
    this.emit();
  }

  /**
   * Host: reload every player's game frame. Non-hosts
   * are ignored; every member (including the host) reloads its own frame.
   */
  reloadAllGames(): void {
    if (!this.party?.amHost || this.party === null) {
      return;
    }
    void this.party.announceReloadAll().catch(() => undefined);
    this.reloadMyGame();
  }

  /**
   * Host: remove a member from the party. Cooperative
   * in the peer-to-peer transport — the kicked member's client leaves on
   * receipt and the others observe its `peer:left`. Non-hosts are ignored.
   */
  kickMember(memberId: string): void {
    if (!this.party?.amHost || this.party === null || memberId === this.identity.memberId) {
      return;
    }
    void this.party
      .kickMember(memberId, "The host removed you from the party.")
      .catch(() => undefined);
    this.removedMemberIds.add(memberId);
    if (this.hasDisplayName(memberId)) {
      this.addNotice("warn", `${this.displayNameOf(memberId)} was removed from the party.`);
    }
    this.emit();
  }

  /** Leave the "you were removed" screen and return to the entry UI. */
  dismissRemoved(): void {
    this.removedReason = null;
    this.phase = "idle";
    this.emit();
  }

  /**
   * Update this player's display name: persists it for next time,
   * applies it locally immediately, and announces it to connected peers on
   * the party control plane so their lobbies update without a
   * rejoin. The local frame's `nova.player` is refreshed too.
   */
  setDisplayName(name: string): void {
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      return;
    }
    updatePartyDisplayName(trimmed);
    this.identity = { ...this.identity, displayName: trimmed };
    const party = this.party;
    if (party !== null) {
      void party.announceRename(trimmed).catch(() => undefined);
    }
    this.runtime?.pushApiEvent({
      kind: "identity",
      player: { id: this.identity.memberId, name: trimmed },
    });
    this.emit();
  }

  retrySetup(): void {
    const last = this.lastSetup;
    if (last === null || this.party !== null) {
      return;
    }
    if (last.kind === "create") {
      void this.createParty(last.input);
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
    this.setupFailureCode = null;
    this.observedJoinFailure = null;
    this.phase = "idle";
    this.phaseDetail = null;
    this.joinStage = null;
    this.notices = [];
    this.emit();
  }

  // ------------------------------------------------------------------
  // Lobby controls
  // ------------------------------------------------------------------

  /**
   * Start the game. All members must be ready; `force` starts once every
   * member has verified the game source even if some are not ready yet
   * (starting is never allowed before the source is verified).
   */
  startGame(force = false): void {
    if (!this.party?.amHost) return;
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
    // A fresh start clears the previous game's ended banner.
    this.endedReason = null;
    this.phase = "starting";
    this.phaseDetail = null;
    this.emit();
    this.session?.start();
    this.beginStartRetry();
    // The session's local "start" event flips the phase to playing.
  }

  /**
   * Read-only snapshot of everything a stalled start needs: the phase, the
   * session's start state and its elected authority, each member's source and
   * readiness, whether the frame exists and got start, and the start retry.
   * Dev and test builds only (see window.__NOVA_PARTY_DEBUG__).
   */
  debugSnapshot(): Record<string, unknown> {
    const state = this.getState();
    return {
      phase: state.phase,
      joinStage: state.joinStage,
      gameStarted: this.gameStarted,
      registered: this.registered,
      frameExists: this.runtime !== null,
      frameStartDelivered: this.frameStartDelivered,
      startRetryActive: this.cancelStartRetry !== null,
      startGaveUp: this.startGaveUp,
      session: this.session?.debugState() ?? null,
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
    };
  }

  /** Host: keep re-sending the start request until the authority starts the game. */
  private beginStartRetry(): void {
    this.stopStartRetry();
    this.startRetryRemainingMs = START_RETRY_TIMEOUT_MS;
    this.armStartRetry();
  }

  private armStartRetry(): void {
    this.cancelStartRetry = this.schedule(() => {
      this.cancelStartRetry = null;
      this.onStartRetryTick();
    }, START_RETRY_INTERVAL_MS);
  }

  private onStartRetryTick(): void {
    if (this.phase !== "starting") {
      this.stopStartRetry();
      return;
    }
    this.startRetryRemainingMs -= START_RETRY_INTERVAL_MS;
    if (this.startRetryRemainingMs <= 0) {
      // The authority never started the game: give up and say so.
      this.phase = "lobby";
      this.phaseDetail = null;
      this.startGaveUp = true;
      this.addNotice("warn", START_GIVE_UP_MESSAGE);
      this.emit();
      return;
    }
    this.session?.resendStartRequest();
    this.armStartRetry();
  }

  /** Re-ask for a waiting member's source every SOURCE_RETRANSMIT_INTERVAL_MS, in the lobby. */
  private syncSourceRetransmit(state: PartyEngineState): void {
    const waiting = state.members.some(
      (member) => !member.isSelf && member.transferState === "waiting",
    );
    if (!waiting || state.phase !== "lobby" || this.party === null) {
      this.stopSourceRetransmit();
      return;
    }
    if (this.cancelSourceRetransmit === null) this.armSourceRetransmit();
  }

  private armSourceRetransmit(): void {
    this.cancelSourceRetransmit = this.schedule(() => {
      this.cancelSourceRetransmit = null;
      const state = this.getState();
      const waiting = state.members.some(
        (member) => !member.isSelf && member.transferState === "waiting",
      );
      if (!waiting || state.phase !== "lobby" || this.party === null) return;
      void this.coordinator
        ?.refresh()
        .catch((error: unknown) =>
          this.addNotice("warn", `Could not ask the party for the game: ${errorMessage(error)}`),
        );
      this.armSourceRetransmit();
    }, SOURCE_RETRANSMIT_INTERVAL_MS);
  }

  private stopSourceRetransmit(): void {
    this.cancelSourceRetransmit?.();
    this.cancelSourceRetransmit = null;
  }

  /** Stop the start-request retry (the game started, ended, or the party is left). */
  private stopStartRetry(): void {
    this.cancelStartRetry?.();
    this.cancelStartRetry = null;
  }

  /**
   * Emergency party teardown: end the game for EVERYONE and return to the
   * lobby.
   */
  endGame(reason: "user_exit" | "host_closed" | "error" = "host_closed"): void {
    this.stopStartRetry();
    this.session?.end(reason);
    this.runtime?.destroy(reason);
    this.runtime = null;
    this.frameStarted = false;
    this.registered = false;
  }

  /**
   * Leave the party cleanly: destroy the runtime frame, detach every
   * listener, dispose the coordinator and session, and leave BOTH Trystero
   * rooms. Resolves once cleanup completes. `nextPhase` defaults
   * to idle; a kicked member leaves into the "removed" phase so the
   * UI never flashes the entry screen.
   */
  leaveParty(nextPhase: PartyPhase = "idle", preserveSetup = false): Promise<void> {
    this.stopStartRetry();
    this.stopSourceRetransmit();
    this.activeErrorScope = null;
    if (!preserveSetup) {
      this.observedJoinFailure = null;
      this.setupFailureCode = null;
      this.cancelWaitingSetup?.();
    }
    if (this.leaveInFlight !== null) {
      if (!preserveSetup) {
        this.setupAbort?.abort();
        this.setupAbort = null;
      }
      return this.leaveInFlight;
    }
    let resolve!: () => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<void>((onResolve, onReject) => {
      resolve = onResolve;
      reject = onReject;
    });
    this.leaveInFlight = promise;
    void this.runLeaveParty(nextPhase, preserveSetup).then(
      () => {
        if (this.leaveInFlight === promise) this.leaveInFlight = null;
        resolve();
      },
      (error: unknown) => {
        if (this.leaveInFlight === promise) this.leaveInFlight = null;
        reject(error);
      },
    );
    return promise;
  }

  private waitForLeaveBeforeSetup(): Promise<boolean> {
    const teardown = this.leaveInFlight;
    if (teardown === null) return Promise.resolve(true);
    this.cancelWaitingSetup?.();
    return new Promise<boolean>((resolve, reject) => {
      let settled = false;
      const finish = (proceed: boolean) => {
        if (settled) return;
        settled = true;
        if (this.cancelWaitingSetup === cancel) this.cancelWaitingSetup = null;
        resolve(proceed);
      };
      const cancel = () => finish(false);
      this.cancelWaitingSetup = cancel;
      void teardown.then(
        () => finish(true),
        (error: unknown) => {
          if (settled) return;
          settled = true;
          if (this.cancelWaitingSetup === cancel) this.cancelWaitingSetup = null;
          reject(error);
        },
      );
    });
  }

  private async runLeaveParty(nextPhase: PartyPhase, preserveSetup: boolean): Promise<void> {
    if (!this.isActive()) {
      return;
    }
    this.leaving = true;
    if (!preserveSetup) {
      this.setupAbort?.abort();
      this.setupAbort = null;
    }
    const pendingTransport = this.pendingSetupTransport;
    this.pendingSetupTransport = null;
    const pendingTeardown = pendingTransport?.leave().then(
      () => true,
      () => false,
    );
    this.stopObservingSignaling();
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
      try {
        await party.leave();
      } catch {
        this.teardownFailed = true;
      }
    }
    if ((await pendingTeardown) === false) this.teardownFailed = true;
    // frame executors are per-party; dispose them with the session.
    this.stateExecutor?.dispose();
    this.stateExecutor = null;
    this.simulationExecutor?.dispose();
    this.simulationExecutor = null;
    this.lastStateApiEvent = null;
    this.pendingSource = null;
    this.runtimeLogs = [];
    this.game = null;
    this.classic = null;
    this.transfers.clear();
    this.verifiedSha256.clear();
    this.selfVerified = false;
    this.selfVerifiedSha256 = null;
    this.currentSourceSha256 = null;
    this.endedReason = null;
    this.notices = [];
    this.removedMemberIds.clear();
    this.clearPeerLink();
    this.lastError = this.teardownFailed ? UNSAFE_TEARDOWN_MESSAGE : null;
    this.lastSetup = null;
    this.phase = this.teardownFailed ? "error" : nextPhase;
    this.phaseDetail = null;
    this.joinStage = null;
    this.gameStarted = false;
    this.reconnectAttempts = 0;
    this.pageWasHidden = false;
    this.reconnectInFlight = null;
    this.cancelReconnectRetry();
    clearPartyRecovery();
    this.leaving = false;
    this.emit();
  }

  /**
   * Reconnect after the party connection dropped.
   * Also handles a backgrounded phone whose WebRTC link iOS killed silently:
   * the transport still reports "connected", so the engine asks the transport for a fresh connection instead of sitting on a
   * stale handle. Single-flight: duplicate lifecycle events, retry timers and
   * user actions share one attempt.
   */
  reconnect(): Promise<void> {
    if (this.reconnectInFlight !== null) return this.reconnectInFlight;
    const attempt = this.runReconnect().finally(() => {
      if (this.reconnectInFlight === attempt) this.reconnectInFlight = null;
    });
    this.reconnectInFlight = attempt;
    return attempt;
  }

  private async runReconnect(): Promise<void> {
    const transport = this.party?.privateTransport;
    if (transport === undefined || this.leaving) {
      return;
    }
    this.clearPeerLink();
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
        // One primitive for a fresh connection id, including a link that looks
        // alive while the peers have stopped answering.
        await transport.reconnect();
      } else if (transport.connectionState === "suspended") {
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
      if (this.leaving || this.party !== party) return;
      this.addNotice("error", `Reconnect failed: ${connectionErrorMessage(error)}`);
      this.phaseDetail = `Reconnect failed (attempt ${this.reconnectAttempts}) — will retry automatically.`;
      this.emit();
      this.scheduleReconnectRetry();
    }
  }

  /** Clear the runtime console ring buffer (the in-game Logs panel). */
  clearRuntimeLogs(): void {
    if (this.runtimeLogs.length === 0) return;
    this.runtimeLogs = [];
    this.emit();
  }

  /** Refresh adapter diagnostics (relay state, join errors, pings). */
  async refreshDiagnostics(): Promise<void> {
    const transport = this.party?.privateTransport;
    this.lastDiagnostics =
      this.diagnosticsProvider?.() ?? this.transportDiagnostics(transport) ?? null;
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
  // Page lifecycle handling
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
    // Timers are unreliable while hidden: cancel any pending retry so
    // a reconnect burst never fires on resume; the resume probe re-decides.
    this.cancelReconnectRetry();
  }

  /**
   * The page came back (foreground / pageshow): re-sync the runtime frame
   * and verify the party connection is actually alive. A backgrounded
   * phone's WebRTC can die without the transport noticing; the
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
    this.checkPartyConnectionAfterResume();
  }

  /** The browser reports the network went away (`offline`). */
  private handleOffline(): void {
    if (this.leaving || !this.isInPartyPhase(this.phase)) {
      return;
    }
    if (this.phase === "reconnecting") {
      this.scheduleReconnectRetry();
    } else {
      this.enterReconnecting("You're offline. Nova will reconnect when the network returns.");
    }
  }

  /** The network came back (`online`): retry immediately. */
  private handleOnline(): void {
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
    this.resetFrameInstance();
    void runtime.restart().catch((error: unknown) => {
      this.addNotice("error", `The game could not be reloaded: ${errorMessage(error)}`);
      this.emit();
    });
  }

  /**
   * Verify the party connection after a resume. Transports that report
   * suspended/disconnected already entered the reconnect flow via their
   * connection:state handler; transports that still report connected but
   * whose peers stopped answering (iOS killed the WebRTC link while
   * backgrounded) get a fresh connection.
   */
  private checkPartyConnectionAfterResume(): void {
    // visibilitychange + pageshow both fire on resume; one probe is enough.
    if (this.resumeCheckInFlight) return;
    this.resumeCheckInFlight = true;
    void this.runResumeCheck().finally(() => {
      this.resumeCheckInFlight = false;
    });
  }

  private async runResumeCheck(): Promise<void> {
    const transport = this.party?.privateTransport;
    if (transport === undefined || this.leaving) {
      return;
    }
    if (transport.connectionState === "suspended" || transport.connectionState === "disconnected") {
      this.enterReconnecting(
        "Your connection was suspended while the page was in the background. Reconnecting…",
      );
      this.cancelReconnectRetry();
      void this.reconnect();
      return;
    }
    if (transport.connectionState !== "connected") {
      // Idle: a failed attempt tore the room down while hidden, and hiding
      // cancelled its retry timer. Nothing else will retry, so re-decide here.
      if (transport.connectionState === "idle" && this.phase === "reconnecting") {
        this.cancelReconnectRetry();
        void this.reconnect();
      }
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
    this.cancelReconnectRetry();
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
      const cancel = this.schedule(() => finish(false), PARTY_HEALTH_PROBE_TIMEOUT_MS);
      void Promise.resolve(ping.call(transport, connectionId))
        .then((pingMs) => finish(pingMs !== null))
        .catch(() => finish(false));
    });
  }

  // ------------------------------------------------------------------
  // Peer-link alert (PLAN.md §7 stages 2 and 4)
  // ------------------------------------------------------------------

  /** Setup and party phases: a peer's link can report while they are live. */
  private peerLinkPhase(): boolean {
    return this.phase === "creating" || this.phase === "joining" || this.isInPartyPhase(this.phase);
  }

  /**
   * A peer connection moved onto the edge tunnel. Simultaneous switches share
   * one "connecting" alert, and each switch restarts the expiry window. A
   * failure already showing stays. Every switch emits, because the diagnostics'
   * relayed flags change with each pair.
   */
  private handleTunnelSwitch(): void {
    if (!this.peerLinkPhase()) return;
    if (this.peerLink !== "failed") {
      this.armPeerLinkWindow();
      this.peerLink = "connecting";
    }
    this.emit();
  }

  /** A tunnelled pair failed terminally: one alert with a retry action. */
  private handleTunnelFailure(): void {
    if (!this.peerLinkPhase()) return;
    this.cancelPeerLinkWindowTimer();
    if (this.peerLink === "failed") return;
    this.peerLink = "failed";
    this.emit();
  }

  /**
   * An admitted peer clears the alert, whether it was connecting or failed.
   * Trystero re-attempts a failed pair on re-announce, and the playing phase
   * has no retry, so a failure must clear when recovery arrives. Trade-off: an
   * unrelated peer's admission also clears it (the hooks do not identify the pair).
   */
  private handlePeerJoinedForLink(): void {
    if (this.peerLink === null) return;
    this.cancelPeerLinkWindowTimer();
    this.peerLink = null;
    this.emit();
  }

  /** Drop the alert: on leave, on setup failure, and when a retry starts. */
  private clearPeerLink(): void {
    this.cancelPeerLinkWindowTimer();
    this.peerLink = null;
  }

  /** A member who left without a kick gets one brief info notice (PLAN §7). */
  private noteMemberLeft(memberId: MemberId, displayName: string | undefined): void {
    if (this.removedMemberIds.delete(memberId)) return;
    if (displayName === undefined || displayName === memberId) return;
    this.addNotice("info", leftNoticeMessage(displayName));
  }

  /** A rejoining member clears their "left" notice. */
  private dropLeftNotice(displayName: string | undefined): void {
    if (displayName === undefined) return;
    const message = leftNoticeMessage(displayName);
    this.notices = this.notices.filter((notice) => notice.message !== message);
  }

  private armPeerLinkWindow(): void {
    this.cancelPeerLinkWindowTimer();
    this.cancelPeerLinkWindow = this.schedule(() => {
      this.cancelPeerLinkWindow = null;
      if (this.peerLink !== "connecting") return;
      this.peerLink = null;
      this.emit();
    }, PEER_LINK_CONNECTING_WINDOW_MS);
  }

  private cancelPeerLinkWindowTimer(): void {
    this.cancelPeerLinkWindow?.();
    this.cancelPeerLinkWindow = null;
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
    this.reconnectRetryTimer = this.schedule(() => {
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
   * Persist local recovery information: code, invite secret, identity,
   * and the game — enough for a one-tap rejoin after a page reload.
   */
  private saveRecovery(): void {
    const party = this.party;
    if (party === null) {
      return;
    }
    savePartyRecovery({
      role: party.role,
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

  /** Observe the private room before join settles, and retry only relay failures. */
  private observeSignaling(
    factory: PartyTransportFactory,
    setup: AbortController,
  ): PartyTransportFactory {
    return {
      createPrivateTransport: (identity) => {
        if (setup.signal.aborted) throw new Error("Setup cancelled");
        const transport = factory.createPrivateTransport(identity);
        this.pendingSetupTransport = transport;
        this.unsubscribeSignaling?.();
        const observable = transport as typeof transport & {
          onRelayStateChange?: (handler: (connected: boolean) => void) => () => void;
        };
        this.unsubscribeSignaling =
          observable.onRelayStateChange?.((connected) => {
            if (typeof connected !== "boolean") return;
            this.signalingConnected = connected;
            this.signalingOutage.update(connected);
            for (const listener of this.signalingListeners) listener(connected);
          }) ?? null;
        if (observable.onRelayStateChange) {
          const join = transport.join;
          transport.join = async (request) => {
            try {
              for (;;) {
                if (setup.signal.aborted) throw new Error("Setup cancelled");
                try {
                  await join.call(transport, request);
                  if (setup.signal.aborted) throw new Error("Setup cancelled");
                  return;
                } catch (error) {
                  if (
                    setup.signal.aborted ||
                    connectionErrorCategory(error) !== "relay_unreachable"
                  ) {
                    throw error;
                  }
                  await this.waitForSetupRetry(setup.signal);
                }
              }
            } finally {
              transport.join = join;
            }
          };
        }
        return transport;
      },
    };
  }

  private waitForSetupRetry(signal: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
      const finish = () => {
        cancel();
        signal.removeEventListener("abort", finish);
        resolve();
      };
      const cancel = this.schedule(finish, 1_000);
      signal.addEventListener("abort", finish, { once: true });
      if (signal.aborted) finish();
    });
  }

  private stopObservingSignaling(): void {
    this.unsubscribeSignaling?.();
    this.unsubscribeSignaling = null;
    this.signalingConnected = null;
    this.signalingOutage.reset();
  }

  /**
   * The transport factory for one setup attempt. Injected factories never
   * trigger a mint. The real Trystero path caches TURN credentials; a mint
   * outage never blocks a party and is surfaced in notices and diagnostics.
   */
  private async resolveTransportFactory(): Promise<PartyTransportFactory> {
    const injected = this.defaults.transportFactory;
    if (injected !== null) {
      return injected;
    }
    const setup = this.setupAbort;
    const scope = {};
    this.activeErrorScope = scope;
    const options = {
      onJoinError: (error: unknown) => {
        if (this.activeErrorScope !== scope || setup?.signal.aborted) return;
        if (
          setup !== null &&
          this.setupAbort === setup &&
          !setup.signal.aborted &&
          this.phase === "joining" &&
          !this.setupPeerAdmitted &&
          (this.party === null || this.party.privateTransport.peers.length === 0) &&
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          (error.code === "room-full" || error.code === "decrypt-failed")
        ) {
          this.observedJoinFailure = error.code;
        }
        this.handleJoinErrorNotice(error);
      },
      onTunnel: () => {
        if (this.activeErrorScope !== scope || setup?.signal.aborted) return;
        this.handleTunnelSwitch();
      },
      onTunnelFailure: () => {
        if (this.activeErrorScope !== scope || setup?.signal.aborted) return;
        this.handleTunnelFailure();
      },
    };
    if (!turnCredsConfigured()) {
      this.turnStatus = "disabled";
      return createTrysteroPartyTransportFactory(options);
    }
    const result = await this.fetchTurnCredentialsOnce();
    if (result.ok) {
      this.turnStatus = "configured";
      return createTrysteroPartyTransportFactory({ ...options, turnConfig: result.turnConfig });
    }
    // Mint failure (network, 403, 5xx, timeout): proceed WITHOUT TURN. No lobby
    // notice: blocked networks fall back to the tunnel, and the TURN state is
    // shown in diagnostics.
    this.turnStatus = "unavailable";
    return createTrysteroPartyTransportFactory(options);
  }

  /**
   * Surface transport join failures as one lobby notice, deduped per category
   * per setup attempt. The `peer_connection_failed` signature is the no-TURN
   * cross-network failure: both sides see only themselves because the WebRTC
   * data channel never opens. That case gets no notice here; it shows up as the
   * peer-link alert or the join-timeout screen instead.
   */
  private readonly joinErrorNoticesShown = new Set<string>();
  private handleJoinErrorNotice(error: unknown): void {
    const category = connectionErrorCategory(error) ?? "unknown";
    // Relay outages have a dedicated timed, self-clearing status instead of
    // a persistent notice that would remain after the socket reconnects.
    if (category === "relay_unreachable") return;
    if (category === "incompatible_version") {
      if (this.joinErrorNoticesShown.has(category)) return;
      this.joinErrorNoticesShown.add(category);
      this.addNotice(
        "warn",
        "Incompatible Nova version. Everyone should update/reload Nova and rejoin the party.",
      );
      this.emit();
      return;
    }
    // Trystero's peer-connect-failed is not a reliable terminal signal for a
    // pair: a real failure after fallback reaches the peer-link alert
    // instead, and the raw code stays in diagnostics. No lobby notice.
    if (category === "peer_connection_failed") return;
    if (roomErrorCategory(error) !== null) {
      if (this.joinErrorNoticesShown.has(category)) return;
      this.joinErrorNoticesShown.add(category);
      const message =
        category === "room_full"
          ? "A player reported the party may be full. This affects a connection to that player and doesn't necessarily mean you can't stay in the party."
          : category === "password_mismatch"
            ? "A message from another player couldn't be decrypted. It may be damaged or use a different invite; you may still be connected to the party."
            : connectionErrorMessage(error);
      this.addNotice("warn", message);
      this.emit();
    }
  }

  /**
   * Reuse a minted credential (e.g. across reconnects) only while at least
   * half its lifetime remains, so a party started late in a long-open tab
   * never gets a credential that expires mid-party.
   */
  private async fetchTurnCredentialsOnce(): Promise<TurnCredentialsResult> {
    if (
      this.turnCredsCache !== null &&
      this.now() < this.turnCredsCache.expiresAt - TURN_CREDS_TTL_MS / 2
    ) {
      return { ok: true, turnConfig: this.turnCredsCache.turnConfig };
    }
    const requestedAt = this.now();
    const result = await this.defaults.turnCreds();
    if (result.ok) {
      this.turnCredsCache = {
        turnConfig: result.turnConfig,
        expiresAt: requestedAt + TURN_CREDS_TTL_MS,
      };
    }
    return result;
  }

  /** Wire the party session, coordinator, session, and transport events. */
  private async establish(party: PartySession): Promise<void> {
    this.party = party;
    this.connectionState = party.privateTransport.connectionState;
    this.unsubParty = party.onEvent((event) => this.handlePartyEvent(event));
    this.unsubTransport = [
      party.privateTransport.on("connection:state", (state) => this.handleTransportState(state)),
      party.privateTransport.on("peer:joined", () => this.handlePeerJoinedForLink()),
      ...this.subscribeRelayState(party),
    ];
    this.coordinator = new GameSourceCoordinator({
      transport: party.privateTransport,
    });
    this.unsubCoordinator = this.coordinator.subscribe((event) =>
      this.handleCoordinatorEvent(event),
    );
    await this.replaceGameSession(party);
  }

  /**
   * A session's mode is immutable. Replace it before booting a newly selected
   * game, including when a joiner first learns the game from source metadata.
   * dispose() detaches session listeners without leaving the party transport.
   */
  private async replaceGameSession(party: PartySession): Promise<void> {
    this.unsubSession?.();
    this.unsubSession = null;
    this.session?.dispose();
    this.lastStateApiEvent = null;
    this.registered = false;
    // Fresh frame executors for this game's session. They forward the state
    // engine's requests into the CURRENT runtime frame (read at call time, so a
    // rebooted frame is always the target) and correlate the frame's answers
    // (routed in routeApiCall). One pair per session, disposed on leave or
    // reset so in-flight requests never bleed across parties.
    this.stateExecutor?.dispose();
    this.simulationExecutor?.dispose();
    this.stateExecutor = new PartyStateExecutor(() => this.runtime);
    this.simulationExecutor = new PartySimulationExecutor(() => this.runtime);
    const session = createNovaSession({
      acceptStartRequest: (memberId) => this.acceptStartRequestFrom(memberId),
      transport: party.privateTransport,
      room: party.material.roomId,
      sessionId: party.material.sessionId,
      player: {
        memberId: this.identity.memberId,
        displayName: this.identity.displayName,
      },
      game: {
        gameId: this.game?.gameId ?? "party",
        mode: this.game?.mode ?? "state",
        ...(this.game?.title !== undefined ? { title: this.game.title } : {}),
      },
      stateExecutor: this.stateExecutor,
      simulationExecutor: this.simulationExecutor,
    });
    this.session = session;
    this.unsubSession = session.onSessionEvent((event) => this.handleSessionEvent(event));
    await session.attach();
  }

  /**
   * Subscribe to adapter relay-state pushes (the Trystero transport's
   * `onRelayStateChange`) so the diagnostics panel reflects socket and
   * rejection changes live. Duck-typed: only the Trystero transport exposes it; the in-memory hub has no relays, and
   * injected factories simply yield no subscription. The transport replays
   * the latest snapshot immediately, so the panel populates right after
   * the private room joins.
   */
  private subscribeRelayState(party: PartySession): Array<() => void> {
    const transport = party.privateTransport as unknown as {
      onRelayStateChange?: (handler: () => void) => () => void;
    };
    if (typeof transport.onRelayStateChange !== "function") {
      return [];
    }
    return [transport.onRelayStateChange(() => this.emit())];
  }

  /**
   * Recreate the session after a game ends so the party can start again.
   * `NovaSession.start()`/`end()` are one-shot (started and ended never reset),
   * so an ended session can never broadcast a second `game.start`. A fresh session attached to the same already-joined
   * party transport resets the state engine, simulation engine, readiness,
   * and authority election for the next game. Deferred one microtask so it
   * never disposes the session from inside its own event loop; guarded so a
   * leave that lands in between is left alone.
   */
  private resetSessionForNextGame(): void {
    queueMicrotask(() => {
      if (this.party === null || this.leaving) {
        return;
      }
      void this.replaceGameSession(this.party).catch((error: unknown) => {
        this.addNotice("error", `The game session could not be reset: ${errorMessage(error)}`);
        this.emit();
      });
      this.emit();
    });
  }

  /**
   * Destroy the Nova runtime frame (if any) and clear the pending source so
   * a classic game owns the frame area instead. The party session
   * and coordinator are untouched.
   */
  private teardownRuntimeFrame(): void {
    this.runtime?.destroy("user_exit");
    this.runtime = null;
    this.frameStarted = false;
    this.registered = false;
    this.pendingSource = null;
  }

  /** The party-plane payload for the current classic room. */
  private classicAnnouncement(): ClassicAnnouncement {
    const classic = this.classic;
    if (classic === null) {
      throw new Error("classicAnnouncement called with no classic game selected");
    }
    const specOf = (spec: {
      url?: string;
      customQueryParams?: Record<string, string>;
      afterQueryParams?: string;
    }) => ({
      ...(spec.url !== undefined ? { url: spec.url } : {}),
      ...(spec.customQueryParams !== undefined
        ? { customQueryParams: spec.customQueryParams }
        : {}),
      ...(spec.afterQueryParams !== undefined ? { afterQueryParams: spec.afterQueryParams } : {}),
    });
    const result = classic.connectResult;
    return {
      gameId: classic.gameId,
      player: {
        url: result.player.url,
        ...(result.player.customQueryParams !== undefined
          ? { customQueryParams: result.player.customQueryParams }
          : {}),
        ...(result.player.afterQueryParams !== undefined
          ? { afterQueryParams: result.player.afterQueryParams }
          : {}),
      },
      ...(result.host !== undefined ? { host: specOf(result.host) } : {}),
    };
  }

  /** Ask the host for the current classic room. */
  private askForClassicRoom(): void {
    if (this.party?.amHost || this.party === null || this.classic !== null) {
      return;
    }
    void this.party.requestClassicRoom().catch(() => undefined);
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
      .then((metadata) => {
        this.adoptSourceHash(metadata.sourceSha256);
        this.selfVerified = true;
        this.selfVerifiedSha256 = metadata.sourceSha256;
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

  private failSetup(error: unknown): void {
    const directCode =
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error.code === "room-full" || error.code === "decrypt-failed")
        ? error.code
        : null;
    this.setupFailureCode =
      this.lastSetup?.kind === "join-invite" && !this.setupPeerAdmitted
        ? (directCode ??
          (error instanceof PartyError && error.code === "peer_unreachable"
            ? this.observedJoinFailure
            : null))
        : null;
    this.observedJoinFailure = null;
    this.lastError =
      directCode === null
        ? connectionErrorMessage(error)
        : "Couldn't connect to the party. Try again.";
    this.clearPeerLink();
    this.phase = "error";
    this.phaseDetail = null;
    this.joinStage = null;
    this.emit();
  }

  /**
   * The joiner was admitted but no private-room peer has appeared (the
   * cross-network, no-TURN case): stay on the loading screen
   * until the first peer joins the private room, or fail setup when none
   * ever does. The creator never waits — a solo host lobby is legitimate.
   */
  private waitForPeerConnect(party: PartySession, signal: AbortSignal): Promise<void> {
    if (party.role === "creator" || party.privateTransport.peers.length > 0) {
      this.setupPeerAdmitted = true;
      this.observedJoinFailure = null;
      return Promise.resolve();
    }
    this.joinStage = "connecting";
    this.phaseDetail = "Connecting to the host…";
    this.emit();
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      let remaining = this.defaults.peerConnectTimeoutMs;
      let startedAt = 0;
      let cancel: (() => void) | null = null;
      const cleanup = () => {
        cancel?.();
        cancel = null;
        unsubscribe();
        this.signalingListeners.delete(onSignaling);
        signal.removeEventListener("abort", onAbort);
      };
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        cleanup();
        if (error) reject(error);
        else resolve();
      };
      const onAbort = () => finish(new Error("Setup cancelled"));
      const onSignaling = (connected: boolean) => {
        if (!connected) {
          if (cancel !== null) {
            cancel();
            cancel = null;
            remaining = Math.max(0, remaining - (this.now() - startedAt));
          }
        } else if (cancel === null && !settled) {
          startedAt = this.now();
          cancel = this.schedule(() => {
            finish(
              new PartyError(
                "peer_unreachable",
                "Couldn't reach anyone in this party. It may have ended, or your networks may need a TURN relay. Ask a friend to confirm they are still connected and try again.",
              ),
            );
          }, remaining);
        }
      };
      const unsubscribe = party.privateTransport.on("peer:joined", () => {
        this.setupPeerAdmitted = true;
        this.observedJoinFailure = null;
        finish();
      });
      this.signalingListeners.add(onSignaling);
      signal.addEventListener("abort", onAbort, { once: true });
      if (signal.aborted) onAbort();
      else if (this.signalingConnected !== false) onSignaling(true);
    });
  }

  // ------------------------------------------------------------------
  // Runtime frame
  // ------------------------------------------------------------------

  /**
   * A reloaded or restarted frame is a new instance: it registers again and
   * gets its own `start`, exactly once.
   */
  private resetFrameInstance(): void {
    this.registered = false;
    this.frameStartDelivered = false;
    this.reloadPending = false;
  }

  /** Ask the runtime to reload the frame in place; its old registrations are ignored. */
  private reloadRuntimeFrame(): void {
    this.resetFrameInstance();
    this.reloadPending = true;
    this.runtime?.reload();
  }

  private async maybeBootFrame(): Promise<void> {
    // Leaving clears the frame before its async teardown ends; a rebind in that
    // window must not boot a frame nobody will tear down.
    if (this.frameStarted || this.runtime !== null || this.container === null || this.leaving) {
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
    // A new frame instance: it has not registered and has not seen start.
    this.resetFrameInstance();
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
      // A superseded load (the container was rebound while it waited) must not
      // clear the frame that replaced it.
      if (this.runtime !== client) return;
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
        // A registration from before a requested reload belongs to the old frame.
        if (this.reloadPending) break;
        this.registered = true;
        // Ready = the game loaded and registered. The game's own nova.ready()
        // call is also routed (idempotent in the session).
        this.session?.ready();
        // The session attached (and replayed peers/status) before the frame
        // existed, so those events were dropped; replay the snapshot now so
        // the game sees its identity, connection status, and roster.
        this.pushSessionSnapshot();
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
          this.resetFrameInstance();
          void this.runtime.restart().catch((error: unknown) => {
            this.addNotice("error", `The game could not be reloaded: ${errorMessage(error)}`);
            this.emit();
          });
        }
        break;
      case "lifecycle":
        if (event.message.event === "reloaded") this.reloadPending = false;
        break;
      case "ready":
      case "metadata":
        break; // handled by the runtime; not lobby-facing
      case "console": {
        // Capture the game's console output into a bounded ring
        // buffer so the in-game Logs menu can show it for the user's own
        // games. Mirrors the arena's logPlayer (arena/engine.ts) — same
        // ArenaLogEntry shape, same cap.
        const { level, message, details, dropped } = event.message;
        const entry: ArenaLogEntry = {
          id: `party-log-${++partyLogCounter}`,
          timestamp: Date.now(),
          level: level === "debug" ? "log" : level,
          message,
          ...(details !== undefined ? { details } : {}),
        };
        this.runtimeLogs = [...this.runtimeLogs, entry].slice(-MAX_PARTY_LOG_ENTRIES);
        if ((dropped ?? 0) > 0) {
          const droppedEntry: ArenaLogEntry = {
            id: `party-log-${++partyLogCounter}`,
            timestamp: Date.now(),
            level: "warn",
            message: `${dropped} console ${dropped === 1 ? "entry" : "entries"} dropped (rate limit)`,
          };
          this.runtimeLogs = [...this.runtimeLogs, droppedEntry].slice(-MAX_PARTY_LOG_ENTRIES);
        }
        this.emit();
        break;
      }
    }
  }

  /** Route the game's Nova API calls into the attached session. */
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
            .catch((error: unknown) => {
              this.addNotice("error", `nova.dispatch() failed: ${errorMessage(error)}`);
              const code =
                error instanceof Error && "code" in error ? String(error.code) : "invalid_options";
              this.runtime?.pushApiEvent({
                kind: "actionAck",
                actionId: parsed.data.actionId,
                status: "rejected",
                errorCode: code,
                errorMessage: errorMessage(error),
              });
            });
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
            .catch((error: unknown) => {
              this.addNotice("error", `nova.raw.send() failed: ${errorMessage(error)}`);
              const code =
                error instanceof Error && "code" in error ? String(error.code) : "invalid_options";
              this.runtime?.pushApiEvent({ kind: "error", code, message: errorMessage(error) });
            });
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
            const code =
              error instanceof Error && "code" in error ? String(error.code) : "invalid_options";
            this.runtime?.pushApiEvent({ kind: "error", code, message: errorMessage(error) });
          }
        }
        break;
      }
      case "stateResponse": {
        // The runtime frame's answer to a stateRequest the frame executor
        // forwarded. Correlate it back to the pending engine request (the same
        // path the arena uses).
        const parsed = arenaApiCallSchemas.stateResponse.safeParse(payload);
        if (parsed.success) {
          this.stateExecutor?.handleResponse(parsed.data as FrameStateResponsePayload);
        }
        break;
      }
      case "simulationResponse": {
        // The authority frame's answer to a simulationRequest the simulation
        // executor forwarded.
        const parsed = arenaApiCallSchemas.simulationResponse.safeParse(payload);
        if (parsed.success) {
          this.simulationExecutor?.handleResponse(parsed.data as FrameSimulationResponsePayload);
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
      case "memberJoined":
        this.dropLeftNotice(event.displayName);
        this.emit();
        break;
      case "memberLeft":
        this.noteMemberLeft(event.memberId, event.displayName);
        this.emit();
        break;
      case "memberRenamed":
        // A connected peer announced a new display name: re-render
        // the member view; the name itself comes from the party layer.
        this.emit();
        break;
      case "classicRoom": {
        // The host shared the classic room: joiners build their own
        // per-player URL from the spec and become ready to start.
        if (this.party?.amHost) {
          break;
        }
        const game = findClassicGame(event.gameId);
        const title = game?.name ?? "Classic game";
        if (this.classic === null || this.classic.gameId !== event.gameId) {
          this.classic = {
            gameId: event.gameId,
            title,
            connectResult: {
              player: {
                url: event.player.url,
                ...(event.player.customQueryParams !== undefined
                  ? { customQueryParams: event.player.customQueryParams }
                  : {}),
                ...(event.player.afterQueryParams !== undefined
                  ? { afterQueryParams: event.player.afterQueryParams }
                  : {}),
              },
              ...(event.host !== undefined ? { host: event.host } : {}),
            },
          };
          this.game = { gameId: event.gameId, title, mode: "state" };
          this.selfVerified = true;
          this.selfVerifiedSha256 = null;
          this.currentSourceSha256 = null;
          this.registered = true;
          this.addNotice("info", `${title} has been selected for the party.`);
        }
        this.emit();
        break;
      }
      case "classicRoomRequest":
        // A late joiner asked for the current classic room: re-announce it.
        if (this.party?.amHost && this.classic !== null && this.party !== null) {
          void this.party.announceClassicRoom(this.classicAnnouncement()).catch(() => undefined);
        }
        break;
      case "kick": {
        if (event.targetMemberId === this.identity.memberId) {
          // This member was removed by the host: record the reason
          // and tear the party down into the "removed" phase.
          this.removedReason = event.reason ?? "The host removed you from the party.";
          this.addNotice("error", this.removedReason);
          this.emit();
          void this.leaveParty("removed");
        } else if (this.hasDisplayName(event.targetMemberId)) {
          this.removedMemberIds.add(event.targetMemberId);
          this.addNotice(
            "warn",
            `${this.displayNameOf(event.targetMemberId)} was removed from the party.`,
          );
          this.emit();
        } else {
          this.emit();
        }
        break;
      }
      case "reloadAll":
        // The host asked every player to reload its game frame.
        if (this.classic !== null) {
          this.classicFrameEpoch += 1;
        } else {
          this.reloadRuntimeFrame();
        }
        this.emit();
        break;
      case "host":
        this.emit();
        this.askForClassicRoom();
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
      // while a join is still landing, the explicit join
      // path owns the phase (the transport's signaling-level "connected"
      // must never render a lobby with zero peers — Trystero reports
      // "connected" once the relays are up, before any peer data channel
      // opens). The rejoin/resume handler below is what legitimately
      // returns to the lobby after a reconnect.
      if (this.phase === "joining" || this.phase === "creating") {
        return;
      }
      this.reconnectAttempts = 0;
      this.cancelReconnectRetry();
      // gameStarted (not session.isStarted()) decides the phase: followers
      // never broadcast start themselves, so isStarted() is false for them
      // even while their game is running.
      this.phase = this.gameStarted ? "playing" : "lobby";
      this.phaseDetail = null;
      this.emit();
      // Re-announce the game after a rejoin so this member's coordinator
      // has current metadata and can request any missing source.
      void this.coordinator
        ?.refresh()
        .catch((error: unknown) =>
          this.addNotice("warn", `Could not ask the party for the game: ${errorMessage(error)}`),
        );
      // Re-request the classic room after a rejoin.
      this.askForClassicRoom();
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
        const game = {
          gameId: event.metadata.gameId,
          title: event.metadata.title ?? "Untitled game",
          mode: event.metadata.mode ?? "state",
        };
        const changed = this.game?.gameId !== game.gameId || this.game.mode !== game.mode;
        this.game = game;
        this.adoptSourceHash(event.metadata.sourceSha256);
        if (changed && this.party !== null) {
          this.classic = null;
          this.selfVerified = false;
          this.teardownRuntimeFrame();
          // attach() wires synchronously before resolving, so the following
          // source/registration events cannot reach the old, state-only session.
          void this.replaceGameSession(this.party).catch((error: unknown) => {
            this.addNotice(
              "error",
              `The game session could not be configured: ${errorMessage(error)}`,
            );
            this.emit();
          });
          // Selecting an earlier game reuses only its exact hash-verified
          // source. The coordinator skips a second transfer of cached bytes.
          const cached = this.coordinator?.getCachedSource(
            game.gameId,
            event.metadata.sourceSha256,
          );
          if (cached !== undefined) {
            this.selfVerified = true;
            this.selfVerifiedSha256 = event.metadata.sourceSha256;
            this.pendingSource = { ...game, source: cached };
            void this.maybeBootFrame();
          }
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
          this.markSourceVerified(event.memberId, "Sent you the game", event.sourceSha256);
        } else {
          // The peer accepted our copy only after verifying its hash.
          this.markSourceVerified(event.memberId, "Game received", event.sourceSha256);
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
        if (
          this.pendingSource !== null &&
          this.pendingSource.source !== event.source &&
          this.party !== null
        ) {
          this.teardownRuntimeFrame();
          void this.replaceGameSession(this.party).catch((error: unknown) => {
            this.addNotice(
              "error",
              `The updated game session could not be configured: ${errorMessage(error)}`,
            );
            this.emit();
          });
        }
        this.adoptSourceHash(event.sourceSha256);
        this.selfVerified = true;
        this.selfVerifiedSha256 = event.sourceSha256;
        this.recordTransfer(this.identity.memberId, {
          state: "complete",
          fraction: 1,
          detail: "Game received",
        });
        // The sender (the host) holds the verified source too.
        this.markSourceVerified(event.fromMemberId, "Sent you the game", event.sourceSha256);
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
      case "holds": {
        // This player accepted the member's copy of the verified source, so
        // the member holds it: its row completes and the start gate can open.
        this.markSourceVerified(event.memberId, "Has the game", event.sourceSha256);
        this.emit();
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
      case "cancelled":
        return event.direction === "receive" ? self : event.memberId;
      case "holds":
        return event.memberId;
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
        this.stopStartRetry();
        // A start that arrives after the give-up is a success: drop its notice.
        this.notices = this.notices.filter((notice) => notice.message !== START_GIVE_UP_MESSAGE);
        this.startGaveUp = false;
        this.gameStarted = true;
        this.phase = "playing";
        this.phaseDetail = null;
        this.addNotice("info", "The game started.");
        this.emit();
        break;
      case "end":
        this.stopStartRetry();
        this.gameStarted = false;
        this.endedReason = event.reason;
        this.phase = "lobby";
        this.phaseDetail = null;
        this.addNotice(
          "info",
          `The game ended${event.reason === undefined ? "." : ` (${event.reason}).`}`,
        );
        this.emit();
        // NovaSession start/end are one-shot (started and ended never reset),
        // so an ended session can never broadcast a second game.start. Swap
        // in a fresh session attached to the same party transport so the
        // host can start the game again after exiting to the lobby.
        this.resetSessionForNextGame();
        break;
      case "playerJoined":
      case "playerLeft":
        this.emit();
        break;
      case "bandwidthWarning":
        this.addNotice("warn", event.message);
        break;
      case "error":
        this.addNotice("error", `Nova error (${event.error.code}): ${event.error.message}`);
        this.emit();
        break;
      case "ready":
        // A member's readiness changed: the lobby's snapshot must be rebuilt
        // (the start gate reads it). The game frame never sees this event.
        this.emit();
        break;
      default:
        break; // raw/state/simulation events route to the frame only
    }
    // Forward every session event the game can observe into the runtime frame:
    // connection, start/end, player joins and leaves, state, raw messages,
    // simulation traffic. Events that
    // arrive before the frame exists are dropped here and replayed by
    // pushSessionSnapshot once the game registers.
    const apiEvent = toApiEvent(event);
    if (apiEvent !== null) {
      // Retain the last self state view so a rebooted frame (after the lobby →
      // playing container rebind) can be replayed via pushSessionSnapshot.
      // Otherwise the rebooted game never re-receives the initial view and hangs
      // at its own waiting screen.
      if (apiEvent.kind === "state") {
        this.lastStateApiEvent = apiEvent;
      }
      if (apiEvent.kind === "start") {
        this.deliverStartToFrame();
      } else {
        this.runtime?.pushApiEvent(apiEvent);
        if (apiEvent.kind === "state") this.deliverStartToFrame();
      }
    }
  }

  /**
   * Send `start` to the current frame instance, at most once per instance and
   * only after it has registered. A state-mode game reads its state in onStart,
   * so `start` waits for the first state event (the state is replayed first on
   * a rebooted frame, then start). Every path that can deliver start calls this:
   * the live session event, a state event, and the snapshot replay.
   */
  private deliverStartToFrame(): void {
    const runtime = this.runtime;
    if (runtime === null || !this.registered || !this.gameStarted) return;
    if (this.frameStartDelivered) return;
    if (this.game?.mode === "state" && this.lastStateApiEvent === null) return;
    this.frameStartDelivered = true;
    runtime.pushApiEvent({ kind: "start" });
  }

  /**
   * Replay the session snapshot the frame missed: its identity, the current
   * connection status, the full roster, and the started flag. The session
   * attached during `establish()`, before the runtime frame existed, so its
   * initial connection and playerJoined events went nowhere.
   * The game-side client dedups players by id, so re-pushing is safe.
   */
  private pushSessionSnapshot(): void {
    const session = this.session;
    const runtime = this.runtime;
    if (session === null || runtime === null) {
      return;
    }
    runtime.pushApiEvent({ kind: "identity", player: session.player });
    runtime.pushApiEvent({ kind: "connection", status: session.connectionStatus });
    for (const player of session.players) {
      runtime.pushApiEvent({ kind: "playerJoined", player });
    }
    // replay the last self view BEFORE start (the game's onStart
    // may dispatch actions against it). A rebooted frame (container rebind
    // on the lobby → playing flip) missed the initial state event; without
    // this replay it hangs at its own waiting screen.
    if (this.lastStateApiEvent !== null) {
      runtime.pushApiEvent(this.lastStateApiEvent);
    }
    // gameStarted, not session.isStarted(): a follower's session never sets its
    // own started flag (only the starter's start() does), so a frame rebooted
    // after the game began would never receive start and refuse every action.
    this.deliverStartToFrame();
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
      if (this.classic !== null) {
        // Classic games have no HTML source to transfer or register: the
        // shared room announcement IS the source.
        transferState = "complete";
        transferProgress = 1;
        transferDetail = "Classic game ready";
      } else if (isSelf) {
        if (this.isSourceVerified(memberId)) {
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
        isHost: memberId === party?.hostMemberId,
        transferState,
        transferProgress,
        transferDetail,
        ready: this.classic !== null ? true : (this.session?.readyOf(memberId) ?? false),
      });
    }
    return members;
  }

  private displayNameOf(memberId: MemberId): string {
    const identity = this.identity;
    if (memberId === identity.memberId) {
      return identity.displayName;
    }
    // The party layer owns member names: handshake names plus any
    // `party.rename` announcements.
    return this.party?.getMemberName(memberId) ?? memberId;
  }

  /**
   * True once a member has a real display name. displayNameOf falls back to the
   * member id for members without one, and membership messages with a raw id
   * are noise.
   */
  private hasDisplayName(memberId: MemberId): boolean {
    return this.displayNameOf(memberId) !== memberId;
  }

  /**
   * Diagnostic-only authority view. After the game starts the real
   * authority comes from the state engine's diagnostics; before that (the
   * lobby) the engine has not announced yet, so fall back to the first ready
   * member — the same deterministic choice the initial election makes.
   * Greeter status is a separate role (ADR-0007) and never used here.
   */
  private computeAuthorityMemberId(members: readonly PartyMemberView[]): MemberId | null {
    const engineAuthority = this.session?.getStateModeDiagnostics().authorityMemberId ?? null;
    return engineAuthority ?? members.find((member) => member.ready)?.memberId ?? null;
  }

  /**
   * Every member holds a verified game source (the lobby's start gate). Used
   * by getState and by the session's start-request gate, so both agree.
   */
  private allSourcesVerified(members: readonly PartyMemberView[], classicActive: boolean): boolean {
    return (
      classicActive ||
      (members.length > 0 && members.every((member) => this.isSourceVerified(member.memberId)))
    );
  }

  /**
   * The session's start-request gate: a `game.start` request counts only from
   * the party host, and only once every member has the game source. The
   * session reports a rejected request; the UI gate is the same condition.
   */
  private acceptStartRequestFrom(memberId: MemberId): boolean {
    if (this.party?.hostMemberId !== memberId) return false;
    return this.allSourcesVerified(this.buildMembers(), this.classic !== null);
  }

  /**
   * The member holds the party's current source. A verification counts only
   * for the hash the party announces now, so an edited game under the same
   * id must be verified again.
   */
  private isSourceVerified(memberId: MemberId): boolean {
    if (memberId === this.identity.memberId) {
      return this.selfVerified && this.selfVerifiedSha256 === this.currentSourceSha256;
    }
    return (
      this.transfers.get(memberId)?.state === "complete" &&
      this.verifiedSha256.get(memberId) === this.currentSourceSha256
    );
  }

  /**
   * Every verification is for one source hash. Adopts the hash the party now
   * announces. A member or this player verified for another hash goes back to
   * waiting, so the lobby re-requests the source and the start gate waits.
   */
  private adoptSourceHash(sourceSha256: string): void {
    this.currentSourceSha256 = sourceSha256;
    for (const [memberId, verified] of this.verifiedSha256) {
      if (verified === sourceSha256) continue;
      this.verifiedSha256.delete(memberId);
      this.recordTransfer(memberId, { state: "waiting", fraction: 0, detail: null });
    }
    if (this.selfVerified && this.selfVerifiedSha256 !== sourceSha256) {
      this.recordTransfer(this.identity.memberId, { state: "waiting", fraction: 0, detail: null });
    }
  }

  /** Mark a member as holding the verified game source for this hash. */
  private markSourceVerified(memberId: MemberId, detail: string, sourceSha256: string): void {
    // A report for a superseded hash says nothing about the current source. The
    // member's row was already reset to waiting when the hash changed.
    if (this.currentSourceSha256 !== null && sourceSha256 !== this.currentSourceSha256) return;
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
    this.verifiedSha256.set(memberId, sourceSha256);
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
    if (party === null) {
      return null;
    }
    try {
      return buildInviteUrl({
        baseUrl: `${defaultBaseUrl()}/join`,
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
    // Prefer the injected provider (tests), then the transport's own
    // adapter diagnostics (production: the Trystero transport exposes
    // getDiagnostics()), then the last refreshed snapshot.
    const raw =
      this.diagnosticsProvider?.() ?? this.transportDiagnostics(transport) ?? this.lastDiagnostics;
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
      turn: this.turnStatus,
    };
  }

  /**
   * Adapter diagnostics straight from the private transport (duck-typed;
   * only the Trystero transport exposes `getDiagnostics()`). This is the
   * production path: the real engine has no injected provider, so the
   * transport's own relay snapshot reaches the lobby panel.
   */
  private transportDiagnostics(transport: unknown): unknown | null {
    const getter = (transport as { getDiagnostics?: () => unknown } | undefined)?.getDiagnostics;
    return typeof getter === "function" ? (getter.call(transport) as unknown) : null;
  }

  private addNotice(level: PartyNotice["level"], message: string): void {
    // Identical notices collapse to one, so a re-broadcast (such as a session end
    // event that fires again) cannot pile up duplicate alerts. A repeat moves to
    // the newest slot so recency ordering stays honest, and the list is capped.
    const duplicateIndex = this.notices.findIndex(
      (notice) => notice.message === message && notice.level === level,
    );
    const deduped =
      duplicateIndex === -1
        ? this.notices
        : [...this.notices.slice(0, duplicateIndex), ...this.notices.slice(duplicateIndex + 1)];
    this.notices = [...deduped, makeNotice(level, message)].slice(-MAX_NOTICES);
  }

  private async finishFailedSetup(setup: AbortController, error: unknown): Promise<void> {
    if (setup.signal.aborted) return;
    this.activeErrorScope = null;
    const transport = this.pendingSetupTransport;
    if (transport !== null) {
      try {
        await transport.leave();
      } catch {
        this.teardownFailed = true;
      }
    }
    if (setup.signal.aborted) return;
    // A failure after the room joined (establish) leaves the room too. This runs
    // only for the setup call that started it, never on reconnect, and a joiner
    // leaves only its own membership, so the other players keep the party.
    if (this.party !== null) {
      const lastSetup = this.lastSetup;
      await this.leaveParty("idle", true).catch(() => undefined);
      this.lastSetup = lastSetup;
    }
    this.pendingSetupTransport = null;
    this.stopObservingSignaling();
    if (!this.rejectUnsafeSetup()) this.failSetup(error);
  }

  private rejectUnsafeSetup(): boolean {
    if (!this.teardownFailed) return false;
    this.phase = "error";
    this.lastError = UNSAFE_TEARDOWN_MESSAGE;
    this.emit();
    return true;
  }

  private prepareSetup(): void {
    if (this.setupAbort !== null) {
      throw new PartyError("invalid_state", "Party setup is already in progress.");
    }
    // A live party blocks a second setup. A leftover error phase (failed join or
    // create) does not, so a retry can start cleanly.
    if (this.party !== null || this.session !== null) {
      throw new PartyError(
        "invalid_state",
        "A party is already active on this page; leave it before starting another.",
      );
    }
    this.stopObservingSignaling();
    this.joinErrorNoticesShown.clear();
    this.setupAbort = new AbortController();
    this.activeErrorScope = null;
    this.observedJoinFailure = null;
    this.setupFailureCode = null;
    this.setupPeerAdmitted = false;
    this.leaving = false;
    this.lastError = null;
    this.phase = "idle";
    this.phaseDetail = null;
    this.joinStage = null;
    this.notices = [];
    this.emit();
  }

  private emit(): void {
    const state = this.getState();
    this.syncSourceRetransmit(state);
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
