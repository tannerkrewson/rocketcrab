import type { GameApiEvent, MemberId } from "@rocketcrab/protocol";
import type { TransportConnectionState } from "@rocketcrab/core";
import type {
  GameSourceCoordinator,
  PartySession,
  PartyTransportFactory,
  Scheduler,
} from "@rocketcrab/party";
import type { createNovaSession } from "@rocketcrab/nova-api";
import type { RuntimeHostClient } from "../runtime-host";
import type { ArenaLogEntry } from "../arena/types";
import type { ClassicGameConnectResult } from "../classic";
import { localPartyIdentity } from "./identity";
import { browserLifecycleSource, type PartyLifecycleSource } from "./lifecycle";
import { SignalingOutage } from "./signaling-outage";
import type { PartyStateExecutor } from "./party-executors";
import { PeerLinkAlert } from "./peer-link-alert";
import { reportConnection } from "../connection-log";
import { fetchTurnCredentials, type TurnCredentialsResult } from "./turn-creds";
import type {
  PartyRuntimeSeams,
  PartySecretDerivation,
  PartyMemberView,
  PartyNotice,
  PartyPhase,
  JoinStage,
  PartyEngineConfig,
  PartySourceSpec,
  SharedPartyGameSource,
} from "./engine-types";
import {
  DEFAULT_PEER_CONNECT_TIMEOUT_MS,
  defaultScheduler,
  defaultRuntimeOrigin,
  isInPartyPhase,
} from "./engine-utils";
import type { PlayerLimits } from "./player-limits";

interface PartyGame extends PlayerLimits {
  readonly gameId: string;
  readonly title: string;
}

/** Send-side entries describe remote members; receive-side entries describe self. */
export interface TransferState {
  fraction: number;
  bytesTransferred: number;
  totalBytes: number;
  state: PartyMemberView["transferState"];
  detail: string | null;
}

interface ClassicSelection {
  readonly gameId: string;
  readonly title: string;
  readonly connectResult: ClassicGameConnectResult;
}

export type ClassicAnnouncement = Parameters<PartySession["announceClassicRoom"]>[0];

interface PartyEngineDefaults {
  /** Injected factory (tests/embedders) or null → build the Trystero factory lazily. */
  transportFactory: PartyTransportFactory | null;
  turnCreds: () => Promise<TurnCredentialsResult>;
  runtimeOrigin: string;
  seams: PartyRuntimeSeams;
  peerConnectTimeoutMs: number;
}

/** Retained for the error screen's retry action. */
type LastSetup =
  | { kind: "create"; input: PartySourceSpec | undefined }
  | { kind: "join-invite"; input: { secret: string } };

/** A stable member identity (ADR-0007); defaults to the page identity. */
interface PartyMemberIdentity {
  readonly memberId: string;
  displayName: string;
}

/** Shared party/session state; collaborator-local timers, caches, and subscriptions stay with their owner. */
export class PartyEngineContext {
  readonly defaults: PartyEngineDefaults;
  identity: PartyMemberIdentity;
  readonly schedule: Scheduler;
  cancelStartRetry: (() => void) | null = null;
  readonly derive?: PartySecretDerivation;
  readonly diagnosticsProvider?: () => unknown;
  readonly lifecycle: PartyLifecycleSource;

  readonly now: () => number;
  turnStatus: "configured" | "unavailable" | "disabled" | null = null;
  readonly peerLink: PeerLinkAlert;
  /** Members removed by a kick: their leave is already announced, so skip the "left" notice. */
  readonly removedMemberIds = new Set<MemberId>();

  party: PartySession | null = null;
  signalingOutageVisible = false;
  readonly signalingOutage: SignalingOutage;
  unsubscribeSignaling: (() => void) | null = null;
  setupAbort: AbortController | null = null;
  pendingSetupTransport: { leave(): Promise<void> } | null = null;
  leaveInFlight: Promise<void> | null = null;
  cancelWaitingSetup: (() => void) | null = null;
  teardownFailed = false;
  signalingConnected: boolean | null = null;
  readonly signalingListeners = new Set<(connected: boolean) => void>();
  coordinator: GameSourceCoordinator | null = null;
  session: ReturnType<typeof createNovaSession> | null = null;
  unsubSession: (() => void) | null = null;
  unsubParty: (() => void) | null = null;
  unsubTransport: Array<() => void> = [];
  unsubCoordinator: (() => void) | null = null;

  runtime: RuntimeHostClient | null = null;
  container: HTMLElement | null = null;
  pendingSource: PartySourceSpec | null = null;
  /** Verified Nova games shared this session, oldest first (bounded). */
  readonly sharedGames = new Map<string, SharedPartyGameSource>();
  /** apiVersion from the latest source metadata, per game id. */
  readonly sourceApiVersions = new Map<string, number>();
  classic: ClassicSelection | null = null;
  classicFrameEpoch = 0;
  removedReason: string | null = null;
  frameStarted = false;
  registered = false;
  /** Start is delivered once per frame, even when the session survives a reboot. */
  frameStartDelivered = false;

  stateExecutor: PartyStateExecutor | null = null;
  /** Replay this view when a container rebind boots a new frame after the initial state event. */
  lastStateApiEvent: GameApiEvent | null = null;

  transfers = new Map<MemberId, TransferState>();
  game: PartyGame | null = null;
  selfVerified = false;
  selfVerifiedSha256: string | null = null;
  /** Only verification for this hash counts toward the start gate. */
  currentSourceSha256: string | null = null;
  verifiedSha256 = new Map<MemberId, string>();
  endedReason: string | null = null;
  leaving = false;
  notices: PartyNotice[] = [];
  lastError: string | null = null;
  setupFailureCode: "room-full" | "decrypt-failed" | null = null;
  observedJoinFailure: "room-full" | "decrypt-failed" | null = null;
  setupPeerAdmitted = false;
  activeErrorScope: object | null = null;
  lastSetup: LastSetup | null = null;
  runtimeLogs: ArenaLogEntry[] = [];

  phase: PartyPhase = "idle";
  phaseDetail: string | null = null;
  joinStage: JoinStage = null;
  connectionState: TransportConnectionState = "idle";
  /** Unlike session.isStarted(), this also tracks starts received by followers. */
  gameStarted = false;
  /** Ticks per second the running game frame declared (null: no tick). */
  frameTickRate: number | null = null;
  startGaveUp = false;

  reconnectAttempts = 0;

  constructor(config: PartyEngineConfig, onChange: () => void) {
    this.defaults = {
      transportFactory: config.transportFactory ?? null,
      turnCreds: config.turnCreds ?? fetchTurnCredentials,
      runtimeOrigin: config.runtimeOrigin ?? defaultRuntimeOrigin(),
      seams: config.seams ?? {},
      peerConnectTimeoutMs: config.peerConnectTimeoutMs ?? DEFAULT_PEER_CONNECT_TIMEOUT_MS,
    };
    this.identity = config.identity ?? localPartyIdentity();
    this.schedule = config.schedule ?? defaultScheduler;
    this.peerLink = new PeerLinkAlert(
      this.schedule,
      () => this.phase === "creating" || this.phase === "joining" || isInPartyPhase(this.phase),
      () => onChange(),
    );
    this.signalingOutage = new SignalingOutage(this.schedule, (visible) => {
      this.signalingOutageVisible = visible;
      // Log once per visible outage; peer-attempt logs cannot capture signaling failures.
      if (visible)
        reportConnection({
          outcome: "failed",
          error_code: "relay-failed",
          ms_to_connect: 0,
          signaling_ok: false,
        });
      onChange();
    });
    this.now = config.now ?? (() => Date.now());
    this.derive = config.derive;
    this.diagnosticsProvider = config.diagnostics;
    this.lifecycle = config.lifecycle ?? browserLifecycleSource();
  }
}
