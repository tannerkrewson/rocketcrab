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
import type { GameApiEvent, GameMode, MemberId, PartyCode } from "@rocketcrab/protocol";
import type { TransportConnectionState } from "@rocketcrab/core";
import {
  GameSourceCoordinator,
  PartyError,
  buildInviteUrl,
  buildShortJoinUrl,
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
import { localPartyIdentity, updatePartyDisplayName } from "./identity";
import { browserLifecycleSource, type PartyLifecycleSource } from "./lifecycle";
import { clearPartyRecovery, savePartyRecovery } from "./party-recovery";
import { createTrysteroPartyTransportFactory } from "./transport-factory";
import {
  fetchTurnCredentials,
  turnCredsConfigured,
  type TurnCredentialsResult,
  type TurnServerConfigLike,
} from "./turn-creds";

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

/** One relay socket as surfaced in engine diagnostics (rocketcrab-ont.1). */
export interface PartyRelayView {
  readonly url: string;
  /** Raw WebSocket readyState (0=CONNECTING, 1=OPEN, 2=CLOSING, 3=CLOSED). */
  readonly readyState: number;
  /** True when the socket is OPEN (socket-level signaling available). */
  readonly connected: boolean;
  /**
   * True when this OPEN relay has recently been observed rejecting or
   * throttling Trystero traffic (OK:false / NOTICE) — connected but NOT
   * usable (relay.nostr.info rejects every event; damus/offchain.pub
   * throttle after a few events).
   */
  readonly degraded: boolean;
}

/** Aggregate relay signaling health (null until an adapter snapshot exists). */
export interface PartyRelayHealth {
  /** Number of configured relays observed. */
  readonly total: number;
  /** Number of relays whose socket is OPEN. */
  readonly connected: number;
  /** Number of OPEN relays not observed rejecting/throttling. */
  readonly usable: number;
  /** Number of relays with a recent failure observation. */
  readonly degradedCount: number;
  /** True when no relay socket is OPEN (no signaling at all). */
  readonly signalingDown: boolean;
  /** True when usable relays are below the configured redundancy. */
  readonly degraded: boolean;
}

/** Connection diagnostics (adapter-specific when available). */
export interface PartyDiagnostics {
  readonly connectionState: TransportConnectionState;
  readonly selfConnectionId: string;
  readonly room: string;
  readonly sessionId: string | null;
  readonly relays: readonly PartyRelayView[] | null;
  /** Aggregate relay health; null when no adapter relay snapshot yet. */
  readonly relayHealth: PartyRelayHealth | null;
  readonly joinErrors: Array<{ category: string; message: string }> | null;
  readonly peers: Array<{ memberId: string; connectionId: string; displayName?: string }>;
  readonly lastQuality: Array<{ memberId: string; pingMs: number | null; sampledAt: number }>;
  /**
   * TURN credential state (P0, rocketcrab-23s): "configured" when minted
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
 * request is away and the host must approve (rocketcrab-erx), or the joiner
 * is admitted and waiting for a direct peer connection before the lobby
 * may appear (rocketcrab-5ae). Null outside the joining phase.
 */
export type JoinStage = "discovering" | "awaitingApproval" | "connecting" | null;

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
  /** Short shareable join URL (origin + "/" + code; NO secret — codes are
   *  public rendezvous namespaces, ADR-0004; the secret stays fragment-only,
   *  ADR-0011). Secondary invite affordance beside {@link inviteUrl}. */
  readonly shortInviteUrl: string | null;
  readonly connectionState: TransportConnectionState;
  readonly canStart: boolean;
  readonly canForceStart: boolean;
  readonly startBlockedReason: string | null;
  /** Set after the game ended; the lobby returns with this banner. */
  readonly endedReason: string | null;
  /**
   * Classic external iframe game for the party (7.7.4): the host creates
   * the room once and shares the URL spec so every player embeds the same
   * room with their own name. Null for Nova API games.
   */
  readonly classicGame: {
    readonly gameId: string;
    readonly title: string;
    readonly connectResult: ClassicGameConnectResult;
  } | null;
  /** Non-null when the host removed this member from the party (7.29). */
  readonly removedReason: string | null;
  /**
   * Bumped to remount the classic iframe (7.29 reload my game / reload all).
   */
  readonly classicFrameEpoch: number;
  readonly diagnostics: PartyDiagnostics | null;
  readonly notices: readonly PartyNotice[];
  readonly lastError: string | null;
  /** Ring-buffer of the game's runtime console output (5cl.11) — the
   *  in-game Logs panel shows this for the user's own games. */
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
  /**
   * How long an admitted code/invite joiner waits for the first private-room
   * peer before the join fails (default 15 s; rocketcrab-5ae — cross-network
   * joins signal fine but no data channel opens without TURN, so the joiner
   * must land on a loading → error path instead of a fake empty lobby).
   */
  peerConnectTimeoutMs?: number;
  /** Adapter diagnostics (Trystero getDiagnostics); duck-typed when present. */
  diagnostics?: () => unknown;
  /**
   * TURN credential mint fetch (P0, rocketcrab-23s). Defaults to the real
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

interface PendingApproval {
  readonly request: JoinRequestInfo;
  resolve: (approved: boolean) => void;
}

const MAX_NOTICES = 8;
/** 5cl.11: cap for the party game's runtime console ring buffer. */
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
 * A classic external iframe game selected for the party (7.7.4): the room
 * was created once in the host's browser and the URL spec is shared with
 * every member through the party plane.
 */
interface ClassicSelection {
  readonly gameId: string;
  readonly title: string;
  readonly connectResult: ClassicGameConnectResult;
}

/** The party-plane payload for a classic room announcement (7.7.4). */
type ClassicAnnouncement = Parameters<PartySession["announceClassicRoom"]>[0];

interface PartyEngineDefaults {
  /** Injected factory (tests/embedders) or null → build the Trystero factory lazily. */
  transportFactory: PartyTransportFactory | null;
  turnCreds: () => Promise<TurnCredentialsResult>;
  runtimeOrigin: string;
  seams: PartyRuntimeSeams;
  collisionListenMs: number;
  collisionRetries: number;
  discoveryTimeoutMs: number;
  earlyMissTimeoutMs: number;
  admissionTimeoutMs: number;
  advertIntervalMs: number;
  peerConnectTimeoutMs: number;
}

/** How long the resume health probe waits for one peer's ping (M1). */
const PARTY_HEALTH_PROBE_TIMEOUT_MS = 2_000;
/** First auto-reconnect retry delay after a failed attempt (M1). */
const RECONNECT_RETRY_BASE_MS = 5_000;
/** Auto-reconnect retry backoff cap (M1). */
const RECONNECT_RETRY_CAP_MS = 30_000;
/**
 * How long an admitted joiner waits for a private-room peer before giving up
 * (rocketcrab-5ae). Signaling can connect without any peer data channel ever
 * opening (no TURN across networks): the joiner must NOT see a fake empty
 * lobby — a loading screen, then a clear error, is the honest outcome.
 */
const DEFAULT_PEER_CONNECT_TIMEOUT_MS = 15_000;

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

/**
 * The party's S2 state executor (5cl.14): the NovaSession runs the game's
 * state handlers IN the runtime frame (U6 parity with the arena) — the
 * engine forwards `stateRequest` apiEvents into the frame and correlates
 * the `stateResponse` apiCalls back. When no Nova runtime frame exists
 * (classic games — their iframe is embedded by the UI directly, 7.7.4 — or
 * a frame that failed to boot), the requests fall back to the same
 * no-op semantics the engine used before (empty `{}` state, no views), so
 * the start flow still completes instead of timing out on the 10 s frame
 * executor. `runtime()` is read at call time so a rebooted frame is always
 * the target.
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
 * The party's A1 simulation executor (5cl.14): forwards `simulationRequest`
 * apiEvents to the frame (the game's `serializeState` snapshot callback)
 * and correlates `simulationResponse`s; falls back to the no-handler local
 * executor when no Nova runtime frame exists (classic games / boot
 * failure).
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
  private readonly schedule?: Scheduler;
  private readonly scheduleFn: Scheduler;
  private readonly derive?: PartySecretDerivation;
  private readonly diagnosticsProvider?: () => unknown;
  private readonly lifecycle: PartyLifecycleSource;
  private readonly lifecycleUnsubscribers: Array<() => void> = [];

  /** Minted TURN config cache (fetched once per engine; P0 rocketcrab-23s). */
  private turnCredsCache: { readonly turnConfig: readonly TurnServerConfigLike[] } | null = null;
  /** Latest TURN credential outcome, surfaced in engine diagnostics. */
  private turnStatus: "configured" | "unavailable" | "disabled" | null = null;

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
  private classic: ClassicSelection | null = null;
  private classicFrameEpoch = 0;
  private removedReason: string | null = null;
  private frameStarted = false;
  private registered = false;

  /**
   * S2/A1 frame executors (5cl.14): the party's NovaSession runs the
   * game's state/simulation handlers IN the runtime frame (U6 parity with
   * the arena) instead of a local no-op executor. Without them the state
   * engine ran `LocalGameExecutor(null)` — the game's `createInitialState`
   * and `actions` never executed, the initial state was `{}`, and a
   * state-mode game could never render its real view.
   */
  private stateExecutor: PartyStateExecutor | null = null;
  private simulationExecutor: PartySimulationExecutor | null = null;
  /**
   * The last self state view forwarded to the frame (5cl.14). The lobby →
   * playing phase flip rebinds the frame container (2t1.6), which disposes
   * and reboots the runtime frame; the fresh frame misses the initial
   * `state` event, so its game hangs at its own waiting screen. The view is
   * replayed by {@link pushSessionSnapshot} when the rebooted frame
   * registers.
   */
  private lastStateApiEvent: GameApiEvent | null = null;

  private pendingApprovals = new Map<MemberId, PendingApproval>();
  private transfers = new Map<MemberId, TransferState>();
  private game: PartyGame | null = null;
  private selfVerified = false;
  private endedReason: string | null = null;
  private leaving = false;
  private notices: PartyNotice[] = [];
  private lastError: string | null = null;
  private lastSetup: LastSetup | null = null;
  /** Ring-buffer of the game's runtime console output (5cl.11). */
  private runtimeLogs: ArenaLogEntry[] = [];
  private lastDiagnostics: unknown = null;

  private phase: PartyPhase = "idle";
  private phaseDetail: string | null = null;
  /** Join sub-stage while phase === "joining" (rocketcrab-erx / 5ae). */
  private joinStage: JoinStage = null;
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
      transportFactory: config.transportFactory ?? null,
      turnCreds: config.turnCreds ?? fetchTurnCredentials,
      runtimeOrigin: config.runtimeOrigin ?? defaultRuntimeOrigin(),
      seams: config.seams ?? {},
      collisionListenMs: config.collisionListenMs ?? 2_000,
      collisionRetries: config.collisionRetries ?? 4,
      discoveryTimeoutMs: config.discoveryTimeoutMs ?? 20_000,
      earlyMissTimeoutMs: config.earlyMissTimeoutMs ?? 7_000,
      admissionTimeoutMs: config.admissionTimeoutMs ?? 30_000,
      advertIntervalMs: config.advertIntervalMs ?? 5_000,
      peerConnectTimeoutMs: config.peerConnectTimeoutMs ?? DEFAULT_PEER_CONNECT_TIMEOUT_MS,
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
    // Classic games have no HTML source to transfer or verify and no
    // runtime to register: the shared room announcement IS the source
    // (7.7.4), so the transfer/ready gates don't apply.
    const classicActive = this.classic !== null;
    const allReady =
      classicActive || (members.length > 0 && members.every((member) => member.ready));
    const allVerified =
      classicActive ||
      (members.length > 0 &&
        members.every((member) =>
          member.isSelf ? this.selfVerified : this.isSourceVerified(member.memberId),
        ));
    const anyFailed = classicActive
      ? false
      : members.some(
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
      joinStage: this.joinStage,
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
      shortInviteUrl: this.buildShortInviteUrl(),
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
    // The UI rebinds the frame container on the lobby<->playing phase flip
    // (PartyExperience renders the SAME frame div inside a different tree,
    // so React detaches the old ref with null before attaching the new
    // element). A runtime still bound to the previous container is stale —
    // its iframe was removed with the old node — so tear it down and reboot
    // the frame in the new spot whenever a fresh element arrives while a
    // runtime exists (rocketcrab-2t1.6: black screen, no iframe). A plain
    // detach (null) leaves the runtime alone; the leave path owns it.
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
        transportFactory: await this.resolveTransportFactory(),
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
      // 5cl.14: the host's game is known BEFORE the session attaches so
      // `establish` bakes the real mode into the NovaSession (state vs
      // simulation drives the whole runtime path).
      this.game =
        input === undefined ? null : { gameId: input.gameId, title: input.title, mode: input.mode };
      await this.establish(party);
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
    this.joinStage = "discovering";
    this.phaseDetail = `Joining party ${code.toLowerCase()}…`;
    this.lastError = null;
    this.emit();
    try {
      const party = await joinPartyByCode({
        code,
        memberId: identity.memberId,
        displayName: identity.displayName,
        transportFactory: await this.resolveTransportFactory(),
        // rocketcrab-erx: once the join request is away, the loading
        // screen flips to "Waiting for the host's approval…" (the host
        // name isn't carried in the public advert — ADR-0004 keeps it
        // minimal — so the UI says "the host").
        onAdmissionPending: () => this.handleAdmissionPending(),
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
      // rocketcrab-5ae: keep the joiner on the loading screen until the
      // private room shows a real peer; the lobby must never be a fake
      // solo room the host never appears in.
      try {
        await this.waitForPeerConnect(party);
      } catch (error) {
        // Cancelled while waiting: leaveParty already cleaned everything up
        // (this.party is null) — just stop; never resurrect a lobby behind
        // the user's back or fail into the error screen.
        if (this.party === null) {
          return;
        }
        // The join established but no peer ever appeared (dead-end room):
        // tear the session down so the error screen doesn't sit on a live
        // but empty party room, and keep the setup record so Retry can
        // re-run this join (retrySetup depends on lastSetup).
        const setup = this.lastSetup;
        await this.leaveParty().catch(() => undefined);
        this.lastSetup = setup;
        throw error;
      }
      if (this.party === null) {
        return; // cancelled while waiting — leaveParty already cleaned up
      }
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
      this.failSetup(error);
    }
  }

  /** Join a party from an invite-link secret (ADR-0011). */
  async joinByInvite(input: { secret: string; code?: string }): Promise<void> {
    this.prepareSetup();
    const identity = this.identity;
    this.lastSetup = { kind: "join-invite", input };
    this.phase = "joining";
    this.joinStage = "discovering";
    this.phaseDetail = "Joining the party from your invite…";
    this.lastError = null;
    this.emit();
    try {
      const party = await joinPartyByInvite({
        secret: input.secret,
        ...(input.code !== undefined ? { code: input.code } : {}),
        memberId: identity.memberId,
        displayName: identity.displayName,
        transportFactory: await this.resolveTransportFactory(),
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
      // rocketcrab-5ae: same peer gate as the code join — a stale invite
      // (host offline) must never drop the joiner into a fake empty lobby.
      try {
        await this.waitForPeerConnect(party);
      } catch (error) {
        if (this.party === null) {
          return; // cancelled while waiting — leaveParty already cleaned up
        }
        const setup = this.lastSetup;
        await this.leaveParty().catch(() => undefined);
        this.lastSetup = setup;
        throw error;
      }
      if (this.party === null) {
        return; // cancelled while waiting — leaveParty already cleaned up
      }
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
    // Switching from a classic game to a Nova game: drop the classic room
    // (and any stale runtime from an earlier pick) so the Nova source owns
    // the frame.
    this.classic = null;
    this.teardownRuntimeFrame();
    this.emit();
    this.registerSource(input);
  }

  /**
   * Host picks a classic external iframe game (7.7.4): the room is created
   * ONCE in the host's browser and the URL spec is shared with the whole
   * party through the party plane, so every player embeds the same room
   * with their own name (classic parity). Rejects silently when the caller
   * is not the creator or the party is not in the lobby.
   */
  async selectClassicGame(gameId: string): Promise<void> {
    if (this.phase !== "lobby" || this.party === null || this.party?.role !== "creator") {
      return;
    }
    const game = findClassicGame(gameId);
    if (game === undefined) {
      this.addNotice("error", `Unknown classic game "${gameId}".`);
      this.emit();
      return;
    }
    try {
      const connectResult = await game.connectToGame();
      this.classic = { gameId, title: game.name, connectResult };
      this.game = { gameId, title: game.name, mode: "state" };
      this.selfVerified = true;
      this.registered = true;
      // No Nova runtime frame for classic games — the UI embeds the iframe
      // directly from state.classicGame. Drop any previous Nova source.
      this.teardownRuntimeFrame();
      await this.party.announceClassicRoom(this.classicAnnouncement());
    } catch (error) {
      this.addNotice("error", `Couldn't set up ${game.name}: ${errorMessage(error)}`);
    }
    this.emit();
  }

  /** Reload only the local game frame (7.29 classic parity). */
  reloadMyGame(): void {
    if (this.classic !== null) {
      // Classic iframes are remounted by the UI keyed on this epoch.
      this.classicFrameEpoch += 1;
    } else {
      this.runtime?.reload();
    }
    this.emit();
  }

  /**
   * Host: reload every player's game frame (7.29 classic parity). Non-hosts
   * are ignored; every member (including the host) reloads its own frame.
   */
  reloadAllGames(): void {
    if (this.party?.role !== "creator" || this.party === null) {
      return;
    }
    void this.party.announceReloadAll().catch(() => undefined);
    this.reloadMyGame();
  }

  /**
   * Host: remove a member from the party (7.29 classic parity). Cooperative
   * in the peer-to-peer transport — the kicked member's client leaves on
   * receipt and the others observe its `peer:left`. Non-hosts are ignored.
   */
  kickMember(memberId: string): void {
    if (
      this.party?.role !== "creator" ||
      this.party === null ||
      memberId === this.identity.memberId
    ) {
      return;
    }
    void this.party
      .kickMember(memberId, "The host removed you from the party.")
      .catch(() => undefined);
    this.addNotice("warn", `${this.displayNameOf(memberId)} was removed from the party.`);
    this.emit();
  }

  /** Leave the "you were removed" screen and return to the entry UI (7.29). */
  dismissRemoved(): void {
    this.removedReason = null;
    this.phase = "idle";
    this.emit();
  }

  /**
   * Update this player's display name (7.5): persists it for next time,
   * applies it locally immediately, and announces it to connected peers on
   * the party control plane (7.25) so their lobbies update without a
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
    this.joinStage = null;
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
    // A fresh start clears the previous game's ended banner (2t1.4).
    this.endedReason = null;
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
   * rooms (rule 22). Resolves once cleanup completes. `nextPhase` defaults
   * to idle; a kicked member leaves into the "removed" phase (7.29) so the
   * UI never flashes the entry screen.
   */
  async leaveParty(nextPhase: PartyPhase = "idle"): Promise<void> {
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
    // 5cl.14: frame executors are per-party; dispose them with the session.
    this.stateExecutor?.dispose();
    this.stateExecutor = null;
    this.simulationExecutor?.dispose();
    this.simulationExecutor = null;
    this.lastStateApiEvent = null;
    this.pendingSource = null;
    this.game = null;
    this.classic = null;
    this.transfers.clear();
    this.selfVerified = false;
    this.endedReason = null;
    this.notices = [];
    this.lastError = null;
    this.lastSetup = null;
    this.phase = nextPhase;
    this.phaseDetail = null;
    this.joinStage = null;
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

  /**
   * The transport factory for one setup attempt. Injected factories (tests,
   * embedders) are used as-is and never trigger a mint. The real Trystero
   * path mints short-lived TURN credentials ONCE (cached on success) and
   * closes over them for both transports; a mint outage never blocks a
   * party — the factory degrades to no-TURN and the failure is recorded as
   * a warn notice + a diagnostics flag (P0 acceptance criterion).
   */
  private async resolveTransportFactory(): Promise<PartyTransportFactory> {
    const injected = this.defaults.transportFactory;
    if (injected !== null) {
      return injected;
    }
    const options = { onJoinError: (error: unknown) => this.handleJoinErrorNotice(error) };
    if (!turnCredsConfigured()) {
      this.turnStatus = "disabled";
      return createTrysteroPartyTransportFactory(options);
    }
    const result = await this.fetchTurnCredentialsOnce();
    if (result.ok) {
      this.turnStatus = "configured";
      return createTrysteroPartyTransportFactory({ ...options, turnConfig: result.turnConfig });
    }
    // Mint failure (network, 403, 5xx, timeout): proceed WITHOUT TURN.
    this.turnStatus = "unavailable";
    this.addNotice(
      "warn",
      `TURN credentials unavailable (${result.reason}) — the party will connect without a TURN relay.`,
    );
    return createTrysteroPartyTransportFactory(options);
  }

  /**
   * Surface transport join failures as ONE friendly lobby notice (5cl.1).
   * The `peer_connection_failed` signature ("could not connect to peer …
   * configure TURN servers") is the documented no-TURN cross-network
   * failure (ADR-0003 Outcome B, beads rocketcrab-23s): both sides then
   * see only themselves because the WebRTC data channel never opens. The
   * TURN fix itself is infrastructure (rocketcrab-23s); this notice makes
   * the symptom legible instead of a silent 1-player lobby. Deduped to one
   * notice per category per engine.
   */
  private readonly joinErrorNoticesShown = new Set<string>();
  private handleJoinErrorNotice(error: unknown): void {
    const category =
      typeof error === "object" &&
      error !== null &&
      "category" in error &&
      typeof (error as { category: unknown }).category === "string"
        ? ((error as { category: string }).category as string)
        : "unknown";
    if (category === "peer_connection_failed") {
      if (this.joinErrorNoticesShown.has(category)) {
        return;
      }
      this.joinErrorNoticesShown.add(category);
      this.addNotice(
        "warn",
        "A player couldn't be reached directly over the network (no TURN relay available). They may not appear in the lobby until TURN is configured.",
      );
      this.emit();
    }
  }

  /** Fetch minted TURN credentials once; successes are cached (failures retry). */
  private async fetchTurnCredentialsOnce(): Promise<TurnCredentialsResult> {
    if (this.turnCredsCache !== null) {
      return { ok: true, turnConfig: this.turnCredsCache.turnConfig };
    }
    const result = await this.defaults.turnCreds();
    if (result.ok) {
      this.turnCredsCache = { turnConfig: result.turnConfig };
    }
    return result;
  }

  /** Wire the party session, coordinator, S1 session, and transport events. */
  private async establish(party: PartySession): Promise<void> {
    this.party = party;
    this.connectionState = party.privateTransport.connectionState;
    this.unsubParty = party.onEvent((event) => this.handlePartyEvent(event));
    this.unsubTransport = [
      party.privateTransport.on("connection:state", (state) => this.handleTransportState(state)),
      ...this.subscribeRelayState(party),
    ];
    this.coordinator = new GameSourceCoordinator({
      transport: party.privateTransport,
    });
    this.unsubCoordinator = this.coordinator.subscribe((event) =>
      this.handleCoordinatorEvent(event),
    );
    // 5cl.14: fresh frame executors for this party's session. They forward
    // the state engine's requests into the CURRENT runtime frame (read at
    // call time, so a rebooted frame is always the target) and correlate
    // the frame's answers (routed in routeApiCall). One pair per session;
    // disposed on leave/reset so in-flight requests never bleed across
    // parties (rule 22).
    this.stateExecutor?.dispose();
    this.simulationExecutor?.dispose();
    this.stateExecutor = new PartyStateExecutor(() => this.runtime);
    this.simulationExecutor = new PartySimulationExecutor(() => this.runtime);
    const session = createNovaSession({
      transport: party.privateTransport,
      room: party.material.roomId,
      sessionId: party.material.sessionId,
      player: {
        memberId: this.identity.memberId,
        displayName: this.identity.displayName,
      },
      // The known game (host with a source) drives the session's mode; a
      // joiner learns the game later from the coordinator (5cl.14 note:
      // the session's game is fixed at construction, so a joiner's
      // simulation-mode game still runs in state mode — tracked in beads).
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
   * rejection changes LIVE (rocketcrab-ont.1). Duck-typed: only the
   * Trystero transport exposes it; the in-memory hub has no relays, and
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
   * Recreate the S1 session after a game ends so the party can start again
   * (rocketcrab-2t1.4): `NovaSession.start()`/`end()` are one-shot (started
   * and ended never reset), so an ended session can never broadcast a
   * second `game.start`. A fresh session attached to the same already-joined
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
      if (this.unsubSession !== null) {
        this.unsubSession();
        this.unsubSession = null;
      }
      this.session?.dispose();
      this.session = null;
      // 5cl.14: a fresh session gets fresh frame executors (stale in-flight
      // requests from the ended game must never settle into the next one)
      // and a cleared state-view cache (the rebooted frame starts clean).
      this.stateExecutor?.dispose();
      this.simulationExecutor?.dispose();
      this.stateExecutor = new PartyStateExecutor(() => this.runtime);
      this.simulationExecutor = new PartySimulationExecutor(() => this.runtime);
      this.lastStateApiEvent = null;
      const party = this.party;
      const session = createNovaSession({
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
      // The fresh session has no readiness: the next game's ready gate
      // re-opens once the rebooted runtime frames re-register.
      this.registered = false;
      void session.attach().catch((error: unknown) => {
        this.addNotice("error", `The game session could not be reset: ${errorMessage(error)}`);
        this.emit();
      });
      this.emit();
    });
  }

  /**
   * Destroy the Nova runtime frame (if any) and clear the pending source so
   * a classic game owns the frame area instead (7.7.4). The party session
   * and coordinator are untouched.
   */
  private teardownRuntimeFrame(): void {
    this.runtime?.destroy("user_exit");
    this.runtime = null;
    this.frameStarted = false;
    this.registered = false;
    this.pendingSource = null;
  }

  /** The party-plane payload for the current classic room (7.7.4). */
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

  /** Ask the host for the current classic room (late joiners, 7.7.4). */
  private askForClassicRoom(): void {
    if (this.party?.role === "creator" || this.party === null || this.classic !== null) {
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
    this.joinStage = null;
    this.emit();
  }

  /**
   * The joiner's join request was sent and the greeter must now decide
   * (ADR-0004 step 6). Flips the loading screen from "searching" to
   * "waiting for the host's approval" (rocketcrab-erx). The host's display
   * name is NOT in the public advert (minimal summary, ADR-0004), so the
   * copy uses a generic "the host"; putting the host's name in the advert
   * would publicize it to anyone guessing the code.
   */
  private handleAdmissionPending(): void {
    if (this.phase !== "joining") {
      return;
    }
    this.joinStage = "awaitingApproval";
    this.phaseDetail = "Waiting for the host's approval…";
    this.emit();
  }

  /**
   * The joiner was admitted but no private-room peer has appeared (the
   * cross-network no-TURN case, rocketcrab-5ae): stay on the loading screen
   * until the first peer joins the private room, or fail setup when none
   * ever does. The creator never waits — a solo host lobby is legitimate.
   */
  private waitForPeerConnect(party: PartySession): Promise<void> {
    if (party.role === "creator" || party.privateTransport.peers.length > 0) {
      return Promise.resolve();
    }
    this.joinStage = "connecting";
    this.phaseDetail = "Connecting to the host…";
    this.emit();
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      let cancel: () => void = () => undefined;
      const unsubscribe = party.privateTransport.on("peer:joined", () => {
        if (settled) {
          return;
        }
        settled = true;
        cancel();
        unsubscribe();
        resolve();
      });
      cancel = this.scheduleFn(() => {
        if (settled) {
          return;
        }
        settled = true;
        unsubscribe();
        reject(
          new PartyError(
            "peer_unreachable",
            "Couldn't reach the host. The party may be on a network that can't connect to yours — check the code with your friend, or ask for an invite link.",
          ),
        );
      }, this.defaults.peerConnectTimeoutMs);
    });
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
        // Ready = the game loaded + registered (P4 deliverable); the game's
        // own nova.ready() call is also routed (idempotent in the session).
        this.session?.ready();
        // The session attached (and replayed peers/status) before the frame
        // existed, so those events were dropped; replay the snapshot now so
        // the game sees its identity, connection status, and roster (7.26).
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
          void this.runtime.restart().catch((error: unknown) => {
            this.addNotice("error", `The game could not be reloaded: ${errorMessage(error)}`);
            this.emit();
          });
        }
        break;
      case "ready":
      case "metadata":
      case "lifecycle":
        break; // handled by the runtime; not lobby-facing in P4
      case "console": {
        // 5cl.11: capture the game's console output into a bounded ring
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
      case "stateResponse": {
        // S2 (5cl.14): the runtime frame's answer to a stateRequest the
        // frame executor forwarded; correlate it back to the pending engine
        // request (same path the arena uses).
        const parsed = arenaApiCallSchemas.stateResponse.safeParse(payload);
        if (parsed.success) {
          this.stateExecutor?.handleResponse(parsed.data as FrameStateResponsePayload);
        }
        break;
      }
      case "simulationResponse": {
        // A1 (5cl.14): the authority frame's answer to a simulationRequest
        // the simulation executor forwarded.
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
      case "memberRenamed":
        // A connected peer announced a new display name (7.25): re-render
        // the member view; the name itself comes from the party layer.
        this.emit();
        break;
      case "classicRoom": {
        // The host shared the classic room (7.7.4): joiners build their own
        // per-player URL from the spec and become ready to start.
        if (this.party?.role === "creator") {
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
          this.registered = true;
          this.addNotice("info", `${title} has been selected for the party.`);
        }
        this.emit();
        break;
      }
      case "classicRoomRequest":
        // A late joiner asked for the current classic room: re-announce it.
        if (this.party?.role === "creator" && this.classic !== null && this.party !== null) {
          void this.party.announceClassicRoom(this.classicAnnouncement()).catch(() => undefined);
        }
        break;
      case "kick": {
        if (event.targetMemberId === this.identity.memberId) {
          // This member was removed by the host (7.29): record the reason
          // and tear the party down into the "removed" phase.
          this.removedReason = event.reason ?? "The host removed you from the party.";
          this.addNotice("error", this.removedReason);
          this.emit();
          void this.leaveParty("removed");
        } else {
          this.addNotice(
            "warn",
            `${this.displayNameOf(event.targetMemberId)} was removed from the party.`,
          );
          this.emit();
        }
        break;
      }
      case "reloadAll":
        // The host asked every player to reload its game frame (7.29).
        if (this.classic !== null) {
          this.classicFrameEpoch += 1;
        } else {
          this.runtime?.reload();
        }
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
      // rocketcrab-5ae: while a join is still landing, the explicit join
      // path owns the phase (the transport's signaling-level "connected"
      // must never render a lobby with zero peers — Trystero reports
      // "connected" once the relays are up, before any peer data channel
      // opens). The rejoin/resume handler below is what legitimately
      // returns to the lobby after a reconnect.
      if (this.phase === "joining" || this.phase === "creating") {
        return;
      }
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
      // Re-request the classic room after a rejoin (7.7.4).
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
        // NovaSession start/end are one-shot (started and ended never reset),
        // so an ended session can never broadcast a second game.start. Swap
        // in a fresh session attached to the same party transport so the
        // host can start the game again after exiting to the lobby (2t1.4).
        this.resetSessionForNextGame();
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
    // Forward every session event the game can observe into the runtime
    // frame (U6 parity with the arena; 7.26): connection, start/end, player
    // joins/leaves, state, raw messages, simulation traffic. Events that
    // arrive before the frame exists are dropped here and replayed by
    // pushSessionSnapshot once the game registers.
    const apiEvent = toApiEvent(event);
    if (apiEvent !== null) {
      // 5cl.14: retain the last self state view so a rebooted frame (the
      // lobby → playing container rebind, 2t1.6) can be replayed it via
      // pushSessionSnapshot — the rebooted game never re-receives the
      // initial view otherwise and hangs at its own waiting screen.
      if (apiEvent.kind === "state") {
        this.lastStateApiEvent = apiEvent;
      }
      this.runtime?.pushApiEvent(apiEvent);
    }
  }

  /**
   * Replay the session snapshot the frame missed (7.26): its identity, the
   * current connection status, the full roster, and the started flag. The
   * session attached during `establish()` — before the runtime frame was
   * created — so its initial connection/playerJoined events went nowhere.
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
    // 5cl.14: replay the last self view BEFORE start (the game's onStart
    // may dispatch actions against it). A rebooted frame (container rebind
    // on the lobby → playing flip) missed the initial state event; without
    // this replay it hangs at its own waiting screen.
    if (this.lastStateApiEvent !== null) {
      runtime.pushApiEvent(this.lastStateApiEvent);
    }
    if (session.isStarted()) {
      runtime.pushApiEvent({ kind: "start" });
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
      if (this.classic !== null) {
        // Classic games have no HTML source to transfer or register: the
        // shared room announcement IS the source (7.7.4).
        transferState = "complete";
        transferProgress = 1;
        transferDetail = "Classic game ready";
      } else if (isSelf) {
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
    // `party.rename` announcements (7.25).
    return this.party?.getMemberName(memberId) ?? memberId;
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

  /** The short typeable/shareable URL: origin + "/" + lowercase code (no
   *  secret). Same null-when-no-party rule as {@link buildInviteUrl}. */
  private buildShortInviteUrl(): string | null {
    const code = this.party?.code;
    if (code === undefined || code === null) {
      return null;
    }
    try {
      return buildShortJoinUrl({ baseUrl: defaultBaseUrl(), code });
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
      relays?: {
        relays?: Array<{
          url: string;
          readyState: number;
          connected: boolean;
          degraded?: boolean;
        }>;
        total?: number;
        connectedCount?: number;
        usableCount?: number;
        degradedCount?: number;
        signalingDown?: boolean;
        degraded?: boolean;
      } | null;
      joinErrors?: Array<{ category: string; message: string }> | null;
      peers?: Array<{ memberId: string; connectionId: string; displayName?: string }>;
      lastQuality?: Array<{ memberId: string; pingMs: number | null; sampledAt: number }>;
    } | null;
    const relaySnapshot = adapter?.relays ?? null;
    // Accept both the adapter snapshot shape ({ relays: [...] , total, ... })
    // and a plain relay-views array (the engine's own PartyDiagnostics
    // shape, as an injected provider might supply).
    const relayViews =
      relaySnapshot !== null && Array.isArray(relaySnapshot.relays)
        ? relaySnapshot.relays
        : Array.isArray(relaySnapshot)
          ? (relaySnapshot as Array<{
              url: string;
              readyState: number;
              connected: boolean;
              degraded?: boolean;
            }>)
          : null;
    const relays: PartyDiagnostics["relays"] =
      relayViews === null
        ? null
        : relayViews.map((relay) => ({ ...relay, degraded: relay.degraded ?? false }));
    const relayHealth: PartyDiagnostics["relayHealth"] =
      relays === null
        ? null
        : {
            total: relaySnapshot?.total ?? relays.length,
            connected:
              relaySnapshot?.connectedCount ?? relays.filter((relay) => relay.connected).length,
            usable:
              relaySnapshot?.usableCount ??
              relays.filter((relay) => relay.connected && !relay.degraded).length,
            degradedCount:
              relaySnapshot?.degradedCount ?? relays.filter((relay) => relay.degraded).length,
            signalingDown:
              relaySnapshot?.signalingDown ?? relays.every((relay) => !relay.connected),
            degraded:
              relaySnapshot?.degraded ??
              relays.filter((relay) => relay.connected && !relay.degraded).length < relays.length,
          };
    return {
      connectionState: adapter?.connectionState ?? transport.connectionState,
      selfConnectionId: adapter?.selfConnectionId ?? transport.selfConnectionId,
      room: adapter?.room ?? transportRoom,
      sessionId: adapter?.sessionId ?? transport.sessionId,
      relays,
      relayHealth,
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
    // 11.8: identical notices collapse to ONE — a re-broadcast (e.g. a
    // session end event that fires again) must not pile up duplicate
    // alerts. A repeat moves to the newest slot so recency ordering stays
    // honest, and the list is capped so the visible set stays small.
    const duplicateIndex = this.notices.findIndex(
      (notice) => notice.message === message && notice.level === level,
    );
    const deduped =
      duplicateIndex === -1
        ? this.notices
        : [...this.notices.slice(0, duplicateIndex), ...this.notices.slice(duplicateIndex + 1)];
    this.notices = [...deduped, makeNotice(level, message)].slice(-MAX_NOTICES);
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
    this.joinStage = null;
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
