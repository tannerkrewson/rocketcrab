import type { MemberId } from "@rocketcrab/protocol";
import type { TransportConnectionState } from "@rocketcrab/core";
import { type PartyTransportFactory, type Scheduler } from "@rocketcrab/party";
import { type ChannelPort } from "../runtime-host";
import type { ArenaLogEntry } from "../arena/types";
import { type ClassicGameConnectResult } from "../classic";
import { type PartyLifecycleSource } from "./lifecycle";
import type { TurnCredentialsResult } from "./turn-creds";

export interface PartyRuntimeSeams {
  createChannel?: () => { port1: ChannelPort; port2: unknown };
  waitForFrameLoad?: (iframe: HTMLIFrameElement) => Promise<void>;
  bootstrapTimeoutMs?: number;
}

export type PartySecretDerivation = (secret: string) => Promise<{
  readonly secret: string;
  readonly roomId: string;
  readonly password: string;
  readonly sessionId: string;
}>;

export interface PartyMemberView {
  readonly memberId: MemberId;
  readonly displayName: string;
  readonly isSelf: boolean;
  readonly connectionId: string | null;
  readonly connected: boolean;
  readonly isHost: boolean;
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
    /** True when the pair runs on the edge tunnel. */
    tunnelled?: boolean;
  }>;
  readonly lastQuality: Array<{ memberId: string; pingMs: number | null; sampledAt: number }>;
  /**
   * "configured" means minted credentials are in use; "unavailable" means minting
   * failed and transport continued without TURN. "disabled" means no mint origin;
   * null means setup has not attempted minting or uses an injected factory.
   */
  readonly turn: "configured" | "unavailable" | "disabled" | null;
}

export interface PartyNotice {
  readonly id: string;
  readonly level: "info" | "warn" | "error";
  readonly message: string;
}

/**
 * Generic tunnel fallback alert; transport hooks do not identify individual peers.
 * A terminal failure clears on peer admission, retry, or leave.
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
 * Invite discovery versus waiting for the first private-room peer.
 * Null outside the joining phase.
 */
export type JoinStage = "discovering" | "connecting" | null;

export interface PartyEngineState {
  readonly phase: PartyPhase;
  /** Human-readable progress for the creating/joining phases. */
  readonly phaseDetail: string | null;
  readonly joinStage: JoinStage;
  /** Attempts since the last connected state. */
  readonly reconnectAttempts: number;
  readonly role: "creator" | "joiner" | null;
  readonly memberId: MemberId;
  readonly displayName: string;
  readonly game: { gameId: string; title: string } | null;
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
  readonly endedReason: string | null;
  /** One host-created external room shared by URL spec; null for Nova API games. */
  readonly classicGame: {
    readonly gameId: string;
    readonly title: string;
    readonly connectResult: ClassicGameConnectResult;
  } | null;
  /** Non-null when the host removed this member from the party. */
  readonly removedReason: string | null;
  /** Increment to remount the classic iframe. */
  readonly classicFrameEpoch: number;
  readonly diagnostics: PartyDiagnostics | null;
  readonly signalingOutage?: boolean;
  readonly notices: readonly PartyNotice[];
  readonly lastError: string | null;
  readonly setupFailureCode?: "room-full" | "decrypt-failed" | null;
  readonly peerLink: PeerLinkStatus;
  /** Nova games shared in this party session, most recent first. */
  readonly sharedGames: readonly SharedPartyGame[];
  readonly runtimeLogs: readonly ArenaLogEntry[];
}

/** Omitted dependencies use the browser lifecycle, Trystero transport, and runtime bridge. */
export interface PartyEngineConfig {
  transportFactory?: PartyTransportFactory;
  runtimeOrigin?: string;
  seams?: PartyRuntimeSeams;
  /** Override the page identity, e.g. for multiple test engines. */
  identity?: { memberId: string; displayName: string };
  schedule?: Scheduler;
  /** Wall-clock override for credential leases (deterministic tests). */
  now?: () => number;
  /** Page-lifecycle events (default: real browser events; tests inject). */
  lifecycle?: PartyLifecycleSource;
  derive?: PartySecretDerivation;
  /**
   * Timeout for the first private-room peer (default 15 s).
   * Signaling alone must not open an apparently connected, empty joiner lobby.
   */
  peerConnectTimeoutMs?: number;
  /** Adapter diagnostics (Trystero getDiagnostics); duck-typed when present. */
  diagnostics?: () => unknown;
  /**
   * Override credential minting. Ignored when transportFactory is injected,
   * because injected factories own transport construction.
   */
  turnCreds?: () => Promise<TurnCredentialsResult>;
}

/**
 * A Nova game shared in this party (selected by a host and verified by
 * hash), so players can save it to their own games. Remembered only for the
 * party session; the source itself is read with `sharedGameSource`.
 */
export interface SharedPartyGame {
  readonly gameId: string;
  readonly title: string;
  readonly apiVersion?: number;
  readonly sourceSha256: string;
  /** Display name of the host who shared it, if known. */
  readonly sharedBy: string | null;
  /** True when this player shared it (it is already theirs). */
  readonly sharedBySelf: boolean;
}

export interface SharedPartyGameSource extends SharedPartyGame {
  readonly source: string;
}

export interface PartySourceSpec {
  readonly gameId: string;
  readonly title: string;
  readonly source: string;
  readonly apiVersion?: number;
}
