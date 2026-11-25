import type { MemberId, OfferedGame } from "@rocketcrab/protocol";
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
import { localPartyIdentity } from "./identity";
import { browserLifecycleSource, type PartyLifecycleSource } from "./lifecycle";
import { SignalingOutage } from "./signaling-outage";
import type { PartyStateExecutor } from "./party-executors";
import { PeerLinkAlert } from "./peer-link-alert";
import { reportConnection } from "../connection-analytics";
import { fetchTurnCredentials, type TurnCredentialsResult } from "./turn-creds";
import type {
  PartyRuntimeSeams,
  PartySecretDerivation,
  PartyNotice,
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
import { PartyEngineModel } from "./engine-model";

export type ExternalAnnouncement = Parameters<PartySession["announceExternalRoom"]>[0];

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

/** A stable member identity; defaults to the page identity. */
interface PartyMemberIdentity {
  readonly memberId: string;
  displayName: string;
}

/** Transport, runtime, and page resources owned by the engine. */
export class PartyResources extends PartyEngineModel {
  readonly defaults: PartyEngineDefaults;
  identity: PartyMemberIdentity;
  readonly schedule: Scheduler;
  cancelStartRetry: (() => void) | null = null;
  readonly derive?: PartySecretDerivation;
  readonly diagnosticsProvider?: () => unknown;
  readonly lifecycle: PartyLifecycleSource;

  readonly now: () => number;
  turnStatus: "configured" | "unavailable" | null = null;
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
  /** Verified Nova games shared this session, oldest first (bounded). */
  readonly sharedGames = new Map<string, SharedPartyGameSource>();
  /** apiVersion from the latest source metadata, per game id. */
  readonly sourceApiVersions = new Map<string, number>();
  /** Whether each game's owner lets players save copies (absent means yes). */
  readonly sourceSaveable = new Map<string, boolean>();
  /** Games other members offered for the host to pick. */
  readonly offers = new Map<MemberId, readonly OfferedGame[]>();
  /** This player's answer to the share prompt, once given. */
  myOffer: { readonly gameIds: readonly string[]; readonly saveable: boolean } | null = null;
  removedReason: string | null = null;
  stateExecutor: PartyStateExecutor | null = null;
  leaving = false;
  notices: PartyNotice[] = [];
  lastError: string | null = null;
  setupFailureCode: "room-full" | "decrypt-failed" | null = null;
  observedJoinFailure: "room-full" | "decrypt-failed" | null = null;
  setupPeerAdmitted = false;
  activeErrorScope: object | null = null;
  lastSetup: LastSetup | null = null;
  runtimeLogs: ArenaLogEntry[] = [];

  connectionState: TransportConnectionState = "idle";

  reconnectAttempts = 0;

  constructor(config: PartyEngineConfig, onChange: () => void) {
    super();
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
      // Report once per visible outage; peer attempts cannot capture signaling failures.
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
