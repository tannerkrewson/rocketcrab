import type {
  ConnectionId,
  JoinRequestMessage,
  MemberId,
  PartyCode,
  SessionSecret,
} from "@rocketcrab/protocol";
import { LIMITS, sessionSecretSchema } from "@rocketcrab/protocol";
import type {
  NovaTransport,
  TransportConnectionState,
  TransportMessage,
  TransportPeerInfo,
} from "@rocketcrab/core";
import { generatePartyCode, isValidPartyCode, normalizePartyCode } from "./code";
import { deriveSessionMaterial, generateSessionSecret, type SessionMaterial } from "./secrets";
import {
  PARTY_CONTROL_CHANNEL,
  buildAdmissionResponseMessage,
  buildJoinRequestMessage,
  buildPartyGreeterMessage,
  buildPartyIdentityMessage,
  buildPartySessionMessage,
  looksLikeJoinRequest,
  parsePartyControlMessage,
} from "./messages";

/**
 * Four-letter rendezvous and secure admission (P2; ADR-0004).
 *
 * The four-letter code names a PUBLIC rendezvous room — never the private
 * party room (engineering rule 6). A creator advertises a minimal party
 * summary there and explicitly admits joiners; the private room name,
 * Trystero password, and session ID are all DERIVED from a CSPRNG session
 * secret (ADR-0011) and are only ever sent to an admitted joiner over the
 * established encrypted peer connection. Guessing a code therefore never
 * admits anyone, and the private room never travels through the rendezvous
 * room.
 *
 * Lifecycle (this module):
 * - {@link createParty} — generate a code, join its rendezvous room, listen
 *   briefly for an existing advert (collision → regenerate), derive the
 *   private room, advertise, and admit joiners explicitly.
 * - {@link joinPartyByCode} — normalize the code, join the rendezvous room,
 *   discover adverts (picker when a collision exposes several parties), send
 *   a join request, wait for approval, receive the secret over the peer
 *   connection, join the private room, then leave the rendezvous.
 * - {@link joinPartyByInvite} — bypass four-letter discovery entirely using
 *   the invite fragment secret (ADR-0011).
 * - Greeter migration — the creator is the first greeter; when the greeter
 *   leaves (or its rendezvous drops), the remaining admitted members
 *   deterministically elect the lowest memberId as the next greeter, who
 *   re-joins the rendezvous room so the code stays usable for late joiners.
 *   Greeter status is separate from game authority (ADR-0007; S3 owns
 *   authority).
 *
 * Cleanup (engineering rule 22, F11 finding): every transport listener and
 * timer has explicit teardown; rejected joiners leave the rendezvous
 * immediately (F4 — stale handles churn the offer pool); `leave()` releases
 * both rooms and all listeners.
 */

/** Rendezvous room name prefix (public namespace per four-letter code). */
export const RENDEZVOUS_ROOM_PREFIX = "nova-rv";

/** Rendezvous room name for a code (public; ADR-0004). */
export function rendezvousRoomName(code: PartyCode): string {
  return `${RENDEZVOUS_ROOM_PREFIX}:${code}`;
}

/** Session ID shared by every peer in one rendezvous room. */
export function rendezvousSessionId(code: PartyCode): string {
  return `${RENDEZVOUS_ROOM_PREFIX}:${code}`;
}

/** Injectable scheduler: run `callback` after `delayMs`; return a cancel fn. */
export type Scheduler = (callback: () => void, delayMs: number) => () => void;

function defaultScheduler(callback: () => void, delayMs: number): () => void {
  const id = setTimeout(callback, delayMs);
  return () => {
    clearTimeout(id);
  };
}

/** Default collision-listen window before a creator claims a code. */
export const DEFAULT_COLLISION_LISTEN_MS = 2_000;
/** Default regeneration attempts before a creator gives up on a collision. */
export const DEFAULT_COLLISION_RETRIES = 4;
/** Default greeter re-advert cadence (relays have no history; F5 F3). */
export const DEFAULT_ADVERT_INTERVAL_MS = 5_000;
/** Default joiner advert discovery window (Trystero discovery ≈ 20 s; F3). */
export const DEFAULT_DISCOVERY_TIMEOUT_MS = 20_000;
/**
 * Fail-fast window for a joiner whose rendezvous room shows no peers at
 * all. A party that exists has its greeter sitting in the rendezvous room,
 * so "no peer has appeared" is a strong "no party here" signal — fail
 * clearly instead of waiting out the full discovery window (user issue
 * rocketcrab-9fv.7.10). A party that exists but is slow to be discovered
 * can simply be retried.
 */
export const DEFAULT_EARLY_MISS_TIMEOUT_MS = 7_000;
/** Extra wait after the first advert for a possible second (collision). */
export const DEFAULT_ADVERT_SETTLE_MS = 1_500;

/** A player's stable identity (ADR-0007); assigned by the shell. */
export interface PartyIdentity {
  readonly memberId: MemberId;
  readonly displayName?: string;
}

/**
 * Creates transports for the party layer (transport-neutral: the same flows
 * run over InMemoryTransport in tests and TrysteroTransport for real
 * parties). The private-room transport carries the derived Trystero password
 * at construction so room admission stays at the transport level (F8).
 */
export interface PartyTransportFactory {
  /** New transport for a public rendezvous room (no password). */
  createRendezvousTransport(identity: PartyIdentity): NovaTransport;
  /** New transport for the private party room (derived password). */
  createPrivateTransport(identity: PartyIdentity & { readonly password: string }): NovaTransport;
}

/** A joiner's admission request as seen by the greeter (policy hook). */
export interface JoinRequestInfo {
  readonly memberId: MemberId;
  readonly displayName: string;
  readonly connectionId: ConnectionId;
  readonly partyCode: PartyCode;
}

/** One party advert heard through the rendezvous room (minimal, public). */
export interface PartyAdvert {
  readonly partyCode: PartyCode;
  readonly partyName?: string;
  readonly gameTitle?: string;
  readonly memberCount: number;
  readonly greeterMemberId: MemberId;
  readonly greeterConnectionId: ConnectionId;
}

/** Admission rejection reasons (protocol `join.admission`). */
export type AdmissionReason = "party_full" | "greeter_rejected" | "timed_out" | "invalid_request";

/** Party lifecycle events (lobby-facing; P4 builds UI on these). */
export type PartyEvent =
  | { readonly type: "greeter"; readonly greeterMemberId: MemberId }
  | {
      readonly type: "admission";
      readonly memberId: MemberId;
      readonly decision: "approved" | "rejected";
      readonly reason?: AdmissionReason;
    }
  | { readonly type: "joinRequest"; readonly request: JoinRequestInfo }
  | { readonly type: "collision"; readonly code: PartyCode }
  | { readonly type: "memberJoined"; readonly memberId: MemberId }
  | { readonly type: "memberLeft"; readonly memberId: MemberId }
  | { readonly type: "error"; readonly error: unknown };

/** Structured party-layer failures (join/admission/creation). */
export type PartyErrorCode =
  | "invalid_code" // typed code is not four letters
  | "not_found" // no party advert within the discovery window
  | "collision" // creator could not find a free code
  | "rejected" // the greeter refused admission
  | "admission_timeout" // no admission response within the timeout
  | "invalid_invite" // invite fragment secret/code malformed
  | "invalid_state" // operation not valid in the current session state
  | "connection_lost" // the private party connection dropped
  | "cancelled"; // operation abandoned (e.g. leave during join)

export class PartyError extends Error {
  readonly code: PartyErrorCode;
  readonly reason?: AdmissionReason;

  constructor(code: PartyErrorCode, message: string, reason?: AdmissionReason) {
    super(message);
    this.name = "PartyError";
    this.code = code;
    if (reason !== undefined) {
      this.reason = reason;
    }
  }
}

/** A joined party: private-room session plus (when greeter) rendezvous role. */
export class PartySession {
  readonly role: "creator" | "joiner";
  readonly memberId: MemberId;
  readonly displayName?: string;
  readonly secret: SessionSecret;
  readonly material: SessionMaterial;
  readonly privateTransport: NovaTransport;
  readonly factory: PartyTransportFactory;

  private readonly partyName?: string;
  private readonly gameTitle?: string;
  private readonly onJoinRequest?: (request: JoinRequestInfo) => boolean | Promise<boolean>;
  private readonly maxMembers?: number;
  private readonly advertIntervalMs: number;
  private readonly scheduleFn: Scheduler;
  private readonly listeners = new Set<(event: PartyEvent) => void>();
  private readonly privateUnsubscribers: Array<() => void> = [];
  private readonly rendezvousUnsubscribers: Array<() => void> = [];

  private _code: PartyCode | null;
  private _greeterMemberId: MemberId;
  private _amGreeter = false;
  private rendezvous: NovaTransport | null = null;
  private advertTimer: (() => void) | null = null;
  private disposed = false;

  constructor(config: PartySessionConfig) {
    this.role = config.role;
    this.memberId = config.memberId;
    this.displayName = config.displayName;
    this._code = config.code;
    this.secret = config.secret;
    this.material = config.material;
    this.factory = config.factory;
    this.privateTransport = config.privateTransport;
    this.partyName = config.partyName;
    this.gameTitle = config.gameTitle;
    this.onJoinRequest = config.onJoinRequest;
    this.maxMembers = config.maxMembers;
    this.advertIntervalMs = config.advertIntervalMs;
    this.scheduleFn = config.schedule;
    this._greeterMemberId = config.initialGreeterMemberId;
    if (config.onEvent !== undefined) {
      this.listeners.add(config.onEvent);
    }
    this.privateUnsubscribers.push(
      this.privateTransport.on("peer:joined", (peer) => this.handlePrivatePeerJoined(peer)),
      this.privateTransport.on("peer:left", (peer) => this.handlePrivatePeerLeft(peer)),
      this.privateTransport.on("message:received", (message) => this.handlePrivateMessage(message)),
      this.privateTransport.on("connection:state", (state) => this.handlePrivateState(state)),
    );
  }

  // ------------------------------------------------------------------
  // Public surface
  // ------------------------------------------------------------------

  /** The four-letter code; null when an invite joiner had no code in link. */
  get code(): PartyCode | null {
    return this._code;
  }

  /** Current rendezvous greeter (separate from game authority, ADR-0007). */
  get greeterMemberId(): MemberId {
    return this._greeterMemberId;
  }

  /** True when THIS member currently greets the rendezvous room. */
  get amGreeter(): boolean {
    return this._amGreeter;
  }

  /** Admitted party members: self plus every connected private-room peer. */
  get members(): readonly MemberId[] {
    return [this.memberId, ...this.privateTransport.peers.map((peer) => peer.memberId)];
  }

  /** The rendezvous transport while this member is greeter, else null. */
  get rendezvousTransport(): NovaTransport | null {
    return this.rendezvous;
  }

  /** Subscribe to party events; returns an unsubscribe function. */
  onEvent(handler: (event: PartyEvent) => void): () => void {
    this.listeners.add(handler);
    return () => {
      this.listeners.delete(handler);
    };
  }

  /**
   * Join the private party room (called once by the entry functions). The
   * transport was created unjoined so its peer:joined events (the creator
   * being present already) are observed after this session wired its
   * handlers.
   */
  async initialize(): Promise<void> {
    this.assertAlive();
    await this.privateTransport.join({
      room: this.material.roomId,
      sessionId: this.material.sessionId,
    });
  }

  /**
   * Leave the party cleanly: stops adverts, detaches every listener, and
   * leaves BOTH the private room and the rendezvous room (rule 22/F11).
   */
  async leave(): Promise<void> {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    await this.teardownRendezvous();
    for (const unsubscribe of this.privateUnsubscribers) {
      unsubscribe();
    }
    this.privateUnsubscribers.length = 0;
    await this.privateTransport.leave().catch(() => undefined);
    this.listeners.clear();
  }

  // ------------------------------------------------------------------
  // Private room wiring (both roles)
  // ------------------------------------------------------------------

  private handlePrivatePeerJoined(peer: TransportPeerInfo): void {
    this.emit({ type: "memberJoined", memberId: peer.memberId });
    if (this._amGreeter) {
      // Announce the greeter to the new member (they may have arrived via
      // an invite link and skipped the rendezvous) and refresh the advert.
      void this.sendPrivateGreeterAnnouncement(this.memberId).catch((error: unknown) =>
        this.emitError(error),
      );
      void this.advertise().catch((error: unknown) => this.emitError(error));
    }
  }

  private handlePrivatePeerLeft(peer: TransportPeerInfo): void {
    this.emit({ type: "memberLeft", memberId: peer.memberId });
    if (peer.memberId === this._greeterMemberId) {
      this.handleGreeterDeparted(peer.memberId);
      return;
    }
    if (this._amGreeter) {
      void this.advertise().catch((error: unknown) => this.emitError(error));
    }
  }

  private handlePrivateMessage(message: TransportMessage): void {
    if (this.disposed || message.channel !== PARTY_CONTROL_CHANNEL) {
      return;
    }
    const parsed = parsePartyControlMessage(message.payload);
    if (!parsed.ok) {
      return; // malformed party control traffic is dropped (threat T10)
    }
    if (parsed.value.type === "party.greeter") {
      this.handleGreeterAnnouncement(parsed.value.greeterMemberId);
    }
  }

  private handlePrivateState(state: TransportConnectionState): void {
    if (this.disposed) {
      return;
    }
    if (state === "suspended" || state === "disconnected") {
      this.emit({
        type: "error",
        error: new PartyError(
          "connection_lost",
          `The private party connection was lost (${state}). Reconnect support lands with M1.`,
        ),
      });
    }
  }

  // ------------------------------------------------------------------
  // Greeter role (advertise + admit)
  // ------------------------------------------------------------------

  /**
   * Install the greeter role on a rendezvous transport: listen for join
   * requests, advertise immediately, re-advertise on a cadence, and confirm
   * the role in the private room. Idempotent.
   */
  async installGreeter(rendezvous: NovaTransport): Promise<void> {
    if (this._amGreeter) {
      return;
    }
    const code = this._code;
    if (code === null) {
      throw new PartyError("invalid_state", "Cannot become greeter without a party code.");
    }
    this.rendezvous = rendezvous;
    this._amGreeter = true;
    this._greeterMemberId = this.memberId;
    this.rendezvousUnsubscribers.push(
      rendezvous.on("message:received", (message) => this.handleRendezvousMessage(message)),
      rendezvous.on("connection:state", (state) => this.handleRendezvousState(state)),
    );
    await this.advertise();
    // Re-arm on every fire so late joiners keep discovering the party
    // (relays have no history replay; F5 F3). teardownRendezvous cancels
    // the current timer on leave/step-down (engineering rule 22).
    const advertiseOnce = (): void => {
      void this.advertise().catch((error: unknown) => this.emitError(error));
      this.advertTimer = this.scheduleFn(advertiseOnce, this.advertIntervalMs);
    };
    this.advertTimer = this.scheduleFn(advertiseOnce, this.advertIntervalMs);
    this.emit({ type: "greeter", greeterMemberId: this.memberId });
    await this.sendPrivateGreeterAnnouncement(this.memberId).catch((error: unknown) =>
      this.emitError(error),
    );
  }

  /** Become greeter after migration: join the rendezvous room first. */
  private async becomeGreeter(): Promise<void> {
    const code = this._code;
    if (code === null) {
      throw new PartyError("invalid_state", "Cannot become greeter without a party code.");
    }
    const rendezvous = this.factory.createRendezvousTransport({
      memberId: this.memberId,
      displayName: this.displayName,
    });
    await rendezvous.join({ room: rendezvousRoomName(code), sessionId: rendezvousSessionId(code) });
    await this.installGreeter(rendezvous);
  }

  private handleRendezvousMessage(message: TransportMessage): void {
    if (this.disposed || message.channel !== PARTY_CONTROL_CHANNEL) {
      return;
    }
    const payload = message.payload;
    if (looksLikeJoinRequest(payload)) {
      const parsed = parsePartyControlMessage(payload);
      if (!parsed.ok) {
        // Malformed join requests are rejected explicitly (acceptance).
        void this.rejectJoin(message, "invalid_request");
        return;
      }
      if (parsed.value.type === "join.request") {
        void this.handleJoinRequest(message, parsed.value);
      }
      return;
    }
    const parsed = parsePartyControlMessage(payload);
    if (!parsed.ok) {
      return; // malformed non-join traffic is dropped (threat T10)
    }
    if (parsed.value.type === "party.identity") {
      // A foreign advert in our rendezvous room: a colliding party. We are
      // past the regeneration window, so surface it for the lobby picker.
      if (parsed.value.greeterMemberId !== this.memberId) {
        this.emit({ type: "collision", code: this._code ?? parsed.value.partyCode });
      }
    }
  }

  private async handleJoinRequest(
    message: TransportMessage,
    request: JoinRequestMessage,
  ): Promise<void> {
    const code = this._code;
    if (code === null || request.partyCode !== code) {
      await this.rejectJoin(message, "invalid_request");
      return;
    }
    const info: JoinRequestInfo = {
      memberId: message.senderMemberId,
      displayName: request.displayName,
      connectionId: message.senderConnectionId,
      partyCode: request.partyCode,
    };
    this.emit({ type: "joinRequest", request: info });
    let approved: boolean;
    try {
      approved = this.onJoinRequest === undefined ? false : await this.onJoinRequest(info);
    } catch (error: unknown) {
      this.emit({ type: "error", error });
      approved = false;
    }
    if (approved && this.maxMembers !== undefined && this.members.length >= this.maxMembers) {
      approved = false;
      await this.rejectJoin(message, "party_full");
      this.emit({
        type: "admission",
        memberId: info.memberId,
        decision: "rejected",
        reason: "party_full",
      });
      return;
    }
    if (!approved) {
      await this.rejectJoin(message, "greeter_rejected");
      this.emit({
        type: "admission",
        memberId: info.memberId,
        decision: "rejected",
        reason: "greeter_rejected",
      });
      return;
    }
    const rendezvous = this.rendezvous;
    if (rendezvous === null) {
      return;
    }
    // Approve: admission response first, then the secret — both targeted at
    // the joiner over the established encrypted peer connection (ADR-0004
    // steps 8-9; the secret is never broadcast).
    await rendezvous.send({
      channel: PARTY_CONTROL_CHANNEL,
      payload: buildAdmissionResponseMessage(this.baseFor(rendezvous, code), {
        partyCode: code,
        decision: "approved",
      }),
      targetConnectionId: message.senderConnectionId,
    });
    await rendezvous.send({
      channel: PARTY_CONTROL_CHANNEL,
      payload: buildPartySessionMessage(this.baseFor(rendezvous, code), {
        partyCode: code,
        secret: this.secret,
      }),
      targetConnectionId: message.senderConnectionId,
    });
    this.emit({ type: "admission", memberId: info.memberId, decision: "approved" });
  }

  private async rejectJoin(message: TransportMessage, reason: AdmissionReason): Promise<void> {
    const rendezvous = this.rendezvous;
    const code = this._code;
    if (rendezvous === null || code === null) {
      return;
    }
    await rendezvous.send({
      channel: PARTY_CONTROL_CHANNEL,
      payload: buildAdmissionResponseMessage(this.baseFor(rendezvous, code), {
        partyCode: code,
        decision: "rejected",
        reason,
      }),
      targetConnectionId: message.senderConnectionId,
    });
  }

  private handleRendezvousState(state: TransportConnectionState): void {
    if (this.disposed || !this._amGreeter || this.rendezvous === null) {
      return;
    }
    if (state === "connected") {
      // The rendezvous recovered (e.g. resume after suspension): refresh
      // the advert for late joiners.
      void this.advertise().catch((error: unknown) => this.emitError(error));
      return;
    }
    if (state === "joining") {
      return;
    }
    // suspended/disconnected while still in the party: hand the greeter
    // role to the next eligible member so the code stays usable (T15).
    const next = this.electNextGreeter([this.memberId]);
    if (next === null || next === this.memberId) {
      return; // solo member: keep the role; the transport recovers on resume
    }
    this._amGreeter = false;
    void (async () => {
      await this.sendPrivateGreeterAnnouncement(next);
      await this.teardownRendezvous();
      this._greeterMemberId = next;
      this.emit({ type: "greeter", greeterMemberId: next });
    })().catch((error: unknown) => this.emitError(error));
  }

  private async advertise(): Promise<void> {
    const rendezvous = this.rendezvous;
    const code = this._code;
    if (rendezvous === null || code === null || !this._amGreeter) {
      return;
    }
    await rendezvous.send({
      channel: PARTY_CONTROL_CHANNEL,
      payload: buildPartyIdentityMessage(this.baseFor(rendezvous, code), {
        partyCode: code,
        partyName: this.partyName,
        gameTitle: this.gameTitle,
        memberCount: this.members.length,
        greeterMemberId: this.memberId,
      }),
    });
  }

  // ------------------------------------------------------------------
  // Greeter migration (ADR-0004; separate from authority, ADR-0007)
  // ------------------------------------------------------------------

  private handleGreeterDeparted(departedMemberId: MemberId): void {
    const next = this.electNextGreeter([departedMemberId]);
    if (next === null) {
      return; // nobody left to greet (the party is empty)
    }
    if (next === this.memberId) {
      this._greeterMemberId = this.memberId;
      void this.becomeGreeter().catch((error: unknown) => this.emitError(error));
      return;
    }
    this._greeterMemberId = next; // optimistic; the announcement confirms
    this.emit({ type: "greeter", greeterMemberId: next });
  }

  private handleGreeterAnnouncement(greeterMemberId: MemberId): void {
    if (greeterMemberId === this._greeterMemberId) {
      return;
    }
    if (greeterMemberId === this.memberId) {
      void this.becomeGreeter().catch((error: unknown) => this.emitError(error));
      return;
    }
    if (this._amGreeter) {
      // Another member took over the greeter role (e.g. our connection
      // dropped and the party migrated while we were away): step down so
      // the rendezvous room never has two advertisers (F11 rejoin).
      this._amGreeter = false;
      void this.teardownRendezvous().catch((error: unknown) => this.emitError(error));
    }
    this._greeterMemberId = greeterMemberId;
    this.emit({ type: "greeter", greeterMemberId });
  }

  /**
   * Deterministic election: the lexicographically smallest admitted member
   * outside `excluded` becomes the greeter. Every member runs the same rule,
   * so exactly one member acts.
   */
  private electNextGreeter(excluded: readonly MemberId[]): MemberId | null {
    const candidates = this.members.filter((memberId) => !excluded.includes(memberId));
    if (candidates.length === 0) {
      return null;
    }
    return [...candidates].sort((a, b) => a.localeCompare(b))[0] ?? null;
  }

  private async sendPrivateGreeterAnnouncement(greeterMemberId: MemberId): Promise<void> {
    await this.privateTransport.send({
      channel: PARTY_CONTROL_CHANNEL,
      payload: buildPartyGreeterMessage(
        this.baseFor(this.privateTransport, this.material.sessionId),
        {
          greeterMemberId,
        },
      ),
    });
  }

  // ------------------------------------------------------------------
  // Internals
  // ------------------------------------------------------------------

  private baseFor(transport: NovaTransport, sessionId: string) {
    return {
      sessionId,
      senderMemberId: this.memberId,
      senderConnectionId: transport.selfConnectionId,
    };
  }

  /** Leave the rendezvous room and detach every rendezvous listener/timer. */
  private async teardownRendezvous(): Promise<void> {
    const rendezvous = this.rendezvous;
    this.rendezvous = null;
    if (this.advertTimer !== null) {
      this.advertTimer();
      this.advertTimer = null;
    }
    for (const unsubscribe of this.rendezvousUnsubscribers) {
      unsubscribe();
    }
    this.rendezvousUnsubscribers.length = 0;
    if (rendezvous !== null) {
      await rendezvous.leave().catch(() => undefined);
    }
  }

  private emit(event: PartyEvent): void {
    for (const handler of this.listeners) {
      handler(event);
    }
  }

  private emitError(error: unknown): void {
    this.emit({ type: "error", error });
  }

  private assertAlive(): void {
    if (this.disposed) {
      throw new PartyError("invalid_state", "PartySession: session was left.");
    }
  }
}

/** Constructor config for {@link PartySession}. */
export interface PartySessionConfig {
  readonly role: "creator" | "joiner";
  readonly memberId: MemberId;
  readonly displayName?: string;
  readonly code: PartyCode | null;
  readonly initialGreeterMemberId: MemberId;
  readonly secret: SessionSecret;
  readonly material: SessionMaterial;
  readonly factory: PartyTransportFactory;
  readonly privateTransport: NovaTransport;
  readonly partyName?: string;
  readonly gameTitle?: string;
  readonly onJoinRequest?: (request: JoinRequestInfo) => boolean | Promise<boolean>;
  readonly maxMembers?: number;
  readonly advertIntervalMs: number;
  readonly schedule: Scheduler;
  readonly onEvent?: (event: PartyEvent) => void;
}

/** Options for {@link createParty}. */
export interface CreatePartyOptions {
  readonly memberId: MemberId;
  readonly displayName?: string;
  readonly transportFactory: PartyTransportFactory;
  /** Optional player-facing party name shown in adverts. */
  readonly partyName?: string;
  /** Optional game title shown in adverts. */
  readonly gameTitle?: string;
  /**
   * Admission policy: return true to admit a joiner, false to reject.
   * Absent = reject every request (admission is explicit; ADR-0004/0010).
   */
  readonly onJoinRequest?: (request: JoinRequestInfo) => boolean | Promise<boolean>;
  /** Optional party size cap; further joiners are rejected `party_full`. */
  readonly maxMembers?: number;
  /** Collision-listen window per code attempt (default 2000 ms). */
  readonly collisionListenMs?: number;
  /** Regeneration attempts after a collision (default 4). */
  readonly collisionRetries?: number;
  /** Greeter re-advert cadence (default 5000 ms). */
  readonly advertIntervalMs?: number;
  /** Injectable code RNG for deterministic tests. */
  readonly codeRng?: () => number;
  /** Injectable scheduler (deterministic tests). */
  readonly schedule?: Scheduler;
  /**
   * Injectable secret derivation (default: Web Crypto, `secrets.ts`).
   * Tests inject a synchronous mock so flows stay fully deterministic.
   */
  readonly derive?: (secret: SessionSecret) => Promise<SessionMaterial>;
  readonly onEvent?: (event: PartyEvent) => void;
}

/** Options for {@link joinPartyByCode}. */
export interface JoinByCodeOptions {
  /** The four-letter code as typed (trimmed and uppercased internally). */
  readonly code: string;
  readonly memberId: MemberId;
  readonly displayName?: string;
  readonly transportFactory: PartyTransportFactory;
  /**
   * Collision picker: called with every distinct advert when more than one
   * party shares the code. Absent = deterministic lowest-greeter pick.
   */
  readonly selectParty?: (adverts: readonly PartyAdvert[]) => PartyAdvert | Promise<PartyAdvert>;
  /** Overall advert discovery window (default 20 s; F5 F3). */
  readonly discoveryTimeoutMs?: number;
  /**
   * Fail-fast window when the rendezvous room shows no peers at all
   * (default {@link DEFAULT_EARLY_MISS_TIMEOUT_MS}). An existing party's
   * greeter sits in the rendezvous room, so a completely empty room is
   * treated as "no party" and the join fails early instead of spinning for
   * the whole discovery window. Skip the early check by passing 0.
   */
  readonly earlyMissTimeoutMs?: number;
  /** Admission exchange timeout (default LIMITS.handshakeTimeoutMs). */
  readonly admissionTimeoutMs?: number;
  /** Policy used if this joiner later becomes greeter after migration. */
  readonly onJoinRequest?: (request: JoinRequestInfo) => boolean | Promise<boolean>;
  /** Party size cap if this joiner later becomes greeter. */
  readonly maxMembers?: number;
  /** Advert cadence if this joiner later becomes greeter (default 5000). */
  readonly advertIntervalMs?: number;
  readonly schedule?: Scheduler;
  /** Injectable secret derivation (see {@link CreatePartyOptions.derive}). */
  readonly derive?: (secret: SessionSecret) => Promise<SessionMaterial>;
  readonly onEvent?: (event: PartyEvent) => void;
}

/** Options for {@link joinPartyByInvite}. */
export interface JoinByInviteOptions {
  /** The session secret parsed from the invite fragment (ADR-0011). */
  readonly secret: string;
  /** The four-letter code from the invite fragment (optional). */
  readonly code?: string;
  readonly memberId: MemberId;
  readonly displayName?: string;
  readonly transportFactory: PartyTransportFactory;
  /** Policy used if this invite joiner later becomes greeter. */
  readonly onJoinRequest?: (request: JoinRequestInfo) => boolean | Promise<boolean>;
  readonly maxMembers?: number;
  readonly advertIntervalMs?: number;
  readonly schedule?: Scheduler;
  /** Injectable secret derivation (see {@link CreatePartyOptions.derive}). */
  readonly derive?: (secret: SessionSecret) => Promise<SessionMaterial>;
  readonly onEvent?: (event: PartyEvent) => void;
}

/**
 * Creation flow (ADR-0004): generate a four-letter code, join its
 * rendezvous room, listen briefly for an existing party advert and
 * regenerate on a detected collision, generate a CSPRNG session secret,
 * derive the private room, advertise a minimal summary, and start admitting
 * joiners explicitly. The private room is joined before advertising, so the
 * party is live the moment the first joiner is approved.
 */
export async function createParty(options: CreatePartyOptions): Promise<PartySession> {
  const secret = generateSessionSecret();
  const derive = options.derive ?? deriveSessionMaterial;
  const material = await derive(secret);
  const privateTransport = options.transportFactory.createPrivateTransport({
    memberId: options.memberId,
    displayName: options.displayName,
    password: material.password,
  });
  const schedule = options.schedule ?? defaultScheduler;
  const listenMs = options.collisionListenMs ?? DEFAULT_COLLISION_LISTEN_MS;
  const maxRetries = options.collisionRetries ?? DEFAULT_COLLISION_RETRIES;
  const advertIntervalMs = options.advertIntervalMs ?? DEFAULT_ADVERT_INTERVAL_MS;

  // Collision loop: try codes until one has no party advert in its
  // rendezvous room (or retries are exhausted).
  const collisions: PartyCode[] = [];
  let code: PartyCode | null = null;
  let rendezvous: NovaTransport | null = null;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const candidate = generatePartyCode(options.codeRng);
    const candidateRendezvous = options.transportFactory.createRendezvousTransport({
      memberId: options.memberId,
      displayName: options.displayName,
    });
    await candidateRendezvous.join({
      room: rendezvousRoomName(candidate),
      sessionId: rendezvousSessionId(candidate),
    });
    const collided = await listenForCollision(candidateRendezvous, schedule, listenMs);
    if (!collided) {
      code = candidate;
      rendezvous = candidateRendezvous;
      break;
    }
    collisions.push(candidate);
    await candidateRendezvous.leave().catch(() => undefined);
  }
  if (code === null || rendezvous === null) {
    throw new PartyError(
      "collision",
      `Four-letter code collided with an existing party ${maxRetries + 1} times; try again later.`,
    );
  }

  const session = new PartySession({
    role: "creator",
    memberId: options.memberId,
    displayName: options.displayName,
    code,
    initialGreeterMemberId: options.memberId,
    secret,
    material,
    factory: options.transportFactory,
    privateTransport,
    partyName: options.partyName,
    gameTitle: options.gameTitle,
    onJoinRequest: options.onJoinRequest,
    maxMembers: options.maxMembers,
    advertIntervalMs,
    schedule,
    onEvent: options.onEvent,
  });
  for (const collidedCode of collisions) {
    options.onEvent?.({ type: "collision", code: collidedCode });
  }
  await session.initialize();
  await session.installGreeter(rendezvous);
  return session;
}

/**
 * Joining flow (ADR-0004): normalize the code, join its rendezvous room,
 * discover party adverts (picker when a collision exposes several parties),
 * send a join request, wait for approval, receive the private session secret
 * over the established encrypted peer connection, join the private room, and
 * leave the rendezvous. Rejected/timed-out joiners fail fast and leave the
 * rendezvous immediately (F4/F11 — stale handles churn the offer pool).
 */
export async function joinPartyByCode(options: JoinByCodeOptions): Promise<PartySession> {
  const code = normalizePartyCode(options.code);
  if (!isValidPartyCode(code)) {
    throw new PartyError(
      "invalid_code",
      `"${options.code}" is not a four-letter party code (letters only, no I/O/L).`,
    );
  }
  const schedule = options.schedule ?? defaultScheduler;
  const advertIntervalMs = options.advertIntervalMs ?? DEFAULT_ADVERT_INTERVAL_MS;
  const rendezvous = options.transportFactory.createRendezvousTransport({
    memberId: options.memberId,
    displayName: options.displayName,
  });
  // Track whether ANY peer ever appears in the rendezvous room. The peer
  // listener must attach before join() resolves: transports report existing
  // room members (the greeter) as peer:joined during the join itself, so an
  // empty room can be told apart from a live party before discovery starts.
  let rendezvousPeerSeen = false;
  const onRendezvousPeer = (): void => {
    rendezvousPeerSeen = true;
  };
  rendezvous.on("peer:joined", onRendezvousPeer);
  try {
    await rendezvous.join({ room: rendezvousRoomName(code), sessionId: rendezvousSessionId(code) });
    const adverts = await discoverAdverts({
      rendezvous,
      code,
      timeoutMs: options.discoveryTimeoutMs ?? DEFAULT_DISCOVERY_TIMEOUT_MS,
      earlyMissTimeoutMs: options.earlyMissTimeoutMs ?? DEFAULT_EARLY_MISS_TIMEOUT_MS,
      peerSeen: () => rendezvousPeerSeen,
      schedule,
    });
    if (adverts.length === 0) {
      throw new PartyError(
        "not_found",
        `No party is advertising code ${code}. Double-check the code with your friend and that they are waiting in their lobby.`,
      );
    }
    const first = adverts[0];
    if (first === undefined) {
      throw new PartyError(
        "not_found",
        `No party is advertising code ${code}. Double-check the code with your friend and that they are waiting in their lobby.`,
      );
    }
    const advert =
      adverts.length === 1 ? first : await resolveCollision(adverts, options.selectParty);
    const secret = await requestAdmission({
      rendezvous,
      code,
      advert,
      displayName: options.displayName ?? options.memberId,
      timeoutMs: options.admissionTimeoutMs ?? LIMITS.handshakeTimeoutMs,
      schedule,
    });
    const derive = options.derive ?? deriveSessionMaterial;
    const material = await derive(secret);
    const privateTransport = options.transportFactory.createPrivateTransport({
      memberId: options.memberId,
      displayName: options.displayName,
      password: material.password,
    });
    const session = new PartySession({
      role: "joiner",
      memberId: options.memberId,
      displayName: options.displayName,
      code,
      initialGreeterMemberId: advert.greeterMemberId,
      secret,
      material,
      factory: options.transportFactory,
      privateTransport,
      partyName: advert.partyName,
      gameTitle: advert.gameTitle,
      onJoinRequest: options.onJoinRequest,
      maxMembers: options.maxMembers,
      advertIntervalMs,
      schedule,
      onEvent: options.onEvent,
    });
    await session.initialize();
    // Joiner step 9: leave unnecessary rendezvous connections (rule 22).
    await rendezvous.leave().catch(() => undefined);
    return session;
  } catch (error) {
    // F4/F11: fail fast — a rejected/timed-out joiner leaves the room so
    // stale handles stop re-offering and churning the greeter's pool.
    await rendezvous.leave().catch(() => undefined);
    throw error;
  }
}

/**
 * Invite-link joining (ADR-0011): bypasses four-letter discovery entirely —
 * the secret in the URL fragment derives the private room directly.
 */
export async function joinPartyByInvite(options: JoinByInviteOptions): Promise<PartySession> {
  const secretCheck = sessionSecretSchema.safeParse(options.secret);
  if (!secretCheck.success) {
    throw new PartyError("invalid_invite", "The invite link has a malformed session secret.");
  }
  let code: PartyCode | null = null;
  if (options.code !== undefined) {
    const normalized = normalizePartyCode(options.code);
    if (!isValidPartyCode(normalized)) {
      throw new PartyError("invalid_invite", "The invite link has a malformed party code.");
    }
    code = normalized;
  }
  const derive = options.derive ?? deriveSessionMaterial;
  const material = await derive(secretCheck.data);
  const privateTransport = options.transportFactory.createPrivateTransport({
    memberId: options.memberId,
    displayName: options.displayName,
    password: material.password,
  });
  const session = new PartySession({
    role: "joiner",
    memberId: options.memberId,
    displayName: options.displayName,
    code,
    initialGreeterMemberId: options.memberId, // unknown; corrected by announcements
    secret: secretCheck.data,
    material,
    factory: options.transportFactory,
    privateTransport,
    onJoinRequest: options.onJoinRequest,
    maxMembers: options.maxMembers,
    advertIntervalMs: options.advertIntervalMs ?? DEFAULT_ADVERT_INTERVAL_MS,
    schedule: options.schedule ?? defaultScheduler,
    onEvent: options.onEvent,
  });
  await session.initialize();
  return session;
}

// ---------------------------------------------------------------------------
// Flow internals (creator collision listen, joiner discovery/admission)
// ---------------------------------------------------------------------------

/** Listen for any foreign party advert; true = the code is taken. */
async function listenForCollision(
  rendezvous: NovaTransport,
  schedule: Scheduler,
  listenMs: number,
): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let settled = false;
    let unsubscribe: () => void = () => undefined;
    let cancel: () => void = () => undefined;
    const finish = (collided: boolean): void => {
      if (settled) {
        return;
      }
      settled = true;
      unsubscribe();
      cancel();
      resolve(collided);
    };
    unsubscribe = rendezvous.on("message:received", (message) => {
      if (message.channel !== PARTY_CONTROL_CHANNEL) {
        return;
      }
      const parsed = parsePartyControlMessage(message.payload);
      if (parsed.ok && parsed.value.type === "party.identity") {
        finish(true);
      }
    });
    cancel = schedule(() => finish(false), listenMs);
  });
}

/** Collect distinct party adverts until the discovery window closes. */
async function discoverAdverts(input: {
  rendezvous: NovaTransport;
  code: PartyCode;
  timeoutMs: number;
  /** Optional fail-fast: reject when no peer has appeared by this time. */
  earlyMissTimeoutMs?: number;
  /** Current "has the rendezvous room shown any peer" signal. */
  peerSeen?: () => boolean;
  schedule: Scheduler;
}): Promise<readonly PartyAdvert[]> {
  return new Promise<readonly PartyAdvert[]>((resolve, reject) => {
    let settled = false;
    let unsubscribe: () => void = () => undefined;
    let cancel: () => void = () => undefined;
    let settleCancel: () => void = () => undefined;
    let cancelEarlyMiss: () => void = () => undefined;
    const adverts = new Map<MemberId, PartyAdvert>();
    const finish = (): void => {
      if (settled) {
        return;
      }
      settled = true;
      unsubscribe();
      cancel();
      settleCancel();
      cancelEarlyMiss();
      resolve([...adverts.values()]);
    };
    const fail = (error: unknown): void => {
      if (settled) {
        return;
      }
      settled = true;
      unsubscribe();
      cancel();
      settleCancel();
      cancelEarlyMiss();
      reject(error);
    };
    if (
      input.earlyMissTimeoutMs !== undefined &&
      input.earlyMissTimeoutMs > 0 &&
      input.peerSeen !== undefined
    ) {
      cancelEarlyMiss = input.schedule(() => {
        // No peer has appeared in the rendezvous room at all: the party
        // almost certainly does not exist, so fail fast with a clear error
        // instead of waiting out the whole discovery window (7.10).
        if (!input.peerSeen?.()) {
          fail(
            new PartyError(
              "not_found",
              `No party is advertising code ${input.code}. Double-check the code with your friend and that they are waiting in their lobby.`,
            ),
          );
        }
      }, input.earlyMissTimeoutMs);
    }
    unsubscribe = input.rendezvous.on("message:received", (message) => {
      if (message.channel !== PARTY_CONTROL_CHANNEL) {
        return;
      }
      const parsed = parsePartyControlMessage(message.payload);
      if (!parsed.ok || parsed.value.type !== "party.identity") {
        return;
      }
      const advertMessage = parsed.value;
      if (advertMessage.partyCode !== input.code) {
        return;
      }
      const greeterMemberId = advertMessage.greeterMemberId ?? message.senderMemberId;
      const advert: PartyAdvert = {
        partyCode: advertMessage.partyCode,
        partyName: advertMessage.partyName,
        gameTitle: advertMessage.gameTitle,
        memberCount: advertMessage.memberCount,
        greeterMemberId,
        greeterConnectionId: message.senderConnectionId,
      };
      const first = adverts.get(greeterMemberId);
      if (first === undefined && adverts.size === 0) {
        adverts.set(greeterMemberId, advert);
        // A short settle window lets a colliding party's advert arrive so
        // the picker can offer a real choice (ADR-0004 collision handling).
        settleCancel = input.schedule(() => finish(), DEFAULT_ADVERT_SETTLE_MS);
        return;
      }
      if (first === undefined) {
        // A second, distinct party shares the code: resolve immediately.
        adverts.set(greeterMemberId, advert);
        finish();
        return;
      }
      // Same greeter re-advertising: refresh the summary.
      adverts.set(greeterMemberId, advert);
    });
    cancel = input.schedule(() => finish(), input.timeoutMs);
  });
}

/** Pick one party when a collision exposes several (default: lowest id). */
async function resolveCollision(
  adverts: readonly PartyAdvert[],
  selectParty:
    | ((adverts: readonly PartyAdvert[]) => PartyAdvert | Promise<PartyAdvert>)
    | undefined,
): Promise<PartyAdvert> {
  if (selectParty !== undefined) {
    const picked = await selectParty(adverts);
    if (picked !== undefined && adverts.some((a) => a.greeterMemberId === picked.greeterMemberId)) {
      return picked;
    }
    throw new PartyError("invalid_state", "selectParty returned an unknown advert.");
  }
  const sorted = [...adverts].sort((a, b) => a.greeterMemberId.localeCompare(b.greeterMemberId));
  const picked = sorted[0];
  if (picked === undefined) {
    throw new PartyError("invalid_state", "No party advert to pick.");
  }
  return picked;
}

/**
 * Send a join request and wait for the admission exchange: an approved
 * response followed by the private session secret over the peer connection.
 * Rejections and timeouts fail fast with a structured error.
 */
async function requestAdmission(input: {
  rendezvous: NovaTransport;
  code: PartyCode;
  advert: PartyAdvert;
  displayName: string;
  timeoutMs: number;
  schedule: Scheduler;
}): Promise<SessionSecret> {
  return new Promise<SessionSecret>((resolve, reject) => {
    let settled = false;
    let unsubscribe: () => void = () => undefined;
    let cancel: () => void = () => undefined;
    let decision: "approved" | null = null;
    let secret: SessionSecret | null = null;
    const finish = (error?: PartyError, value?: SessionSecret): void => {
      if (settled) {
        return;
      }
      settled = true;
      unsubscribe();
      cancel();
      if (error !== undefined) {
        reject(error);
      } else if (value !== undefined) {
        resolve(value);
      }
    };
    unsubscribe = input.rendezvous.on("message:received", (message) => {
      if (message.channel !== PARTY_CONTROL_CHANNEL) {
        return;
      }
      if (message.senderConnectionId !== input.advert.greeterConnectionId) {
        return;
      }
      const parsed = parsePartyControlMessage(message.payload);
      if (!parsed.ok) {
        return; // malformed responses are dropped (threat T10)
      }
      const response = parsed.value;
      if (response.type === "join.admission") {
        if (response.partyCode !== input.code) {
          return;
        }
        if (response.decision === "rejected") {
          finish(
            new PartyError(
              "rejected",
              `The greeter rejected your join request${response.reason === undefined ? "" : ` (${response.reason}).`}`,
              response.reason,
            ),
          );
          return;
        }
        decision = "approved";
      } else if (response.type === "party.session") {
        if (response.partyCode !== input.code) {
          return;
        }
        const secretCheck = sessionSecretSchema.safeParse(response.secret);
        if (!secretCheck.success) {
          return; // malformed secret handoff: drop (T10)
        }
        secret = secretCheck.data;
      }
      if (decision !== null && secret !== null) {
        finish(undefined, secret);
      }
    });
    void input.rendezvous
      .send({
        channel: PARTY_CONTROL_CHANNEL,
        payload: buildJoinRequestMessage(
          {
            sessionId: rendezvousSessionId(input.code),
            senderMemberId: input.rendezvous.selfMemberId,
            senderConnectionId: input.rendezvous.selfConnectionId,
          },
          { partyCode: input.code, displayName: input.displayName },
        ),
        targetConnectionId: input.advert.greeterConnectionId,
      })
      .catch((error: unknown) => {
        finish(new PartyError("invalid_state", `Join request failed to send: ${String(error)}`));
      });
    cancel = input.schedule(
      () =>
        finish(
          new PartyError(
            "admission_timeout",
            `No admission response within ${input.timeoutMs}ms; try again.`,
          ),
        ),
      input.timeoutMs,
    );
  });
}
