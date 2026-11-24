/**
 * The Nova session: the host-side engine that makes the game-facing
 * API function over the transport.
 *
 * A session owns one player's connection to the party: it joins the
 * transport, tracks players and connection status, exchanges validated
 * protocol messages, and drives the client object games use.
 * Everything here is transport-neutral — it implements {@link NovaClientBackend}
 * against {@link NovaTransport}, so the same session (and therefore the same
 * game code) works over InMemoryTransport (the test arena) and
 * TrysteroTransport (real parties). The game-facing client exposes no
 * Trystero terminology, authority roles, or hosting concepts.
 *
 * The session supports readiness, game start/end, player lists, connection
 * status, dispatch, state subscriptions, controls and logging over the
 * transport. The state engine adds authority election, action application,
 * the tick and snapshots on top (see the state engine).
 */
import { payloadBytes } from "./game-byte-budget";
import type { TransportMessage } from "@rocketcrab/core";
import {
  PROTOCOL_VERSION,
  novaActionSchema,
  actionTimeoutMs,
  parsePeerMessage,
  controlsBytes,
  type PeerMessage,
} from "@rocketcrab/protocol";
import { NOVA_PROTOCOL_CHANNEL } from "./constants";
import { NovaError, endedMessage, toErrorCode } from "./errors";
import {
  buildActionAckMessage,
  buildActionDispatchMessage,
  buildAuthorityAnnounceMessage,
  buildAuthorityElectionMessage,
  buildAuthorityHeartbeatMessage,
  buildGameControlsMessage,
  buildGameReadyMessage,
  buildPlayerIdentityMessage,
  buildStateResyncMessage,
  buildStateSnapshotMessage,
  buildStateViewMessage,
  type PeerMessageBase,
} from "./messages";
import type {
  AuthorityAnnounceEnvelope,
  AuthorityElectionEnvelope,
  AuthorityHeartbeatEnvelope,
  StateEngineEvent,
  StateEngineHost,
  StateResyncEnvelope,
  StateSnapshotEnvelope,
  StateViewEnvelope,
} from "./state-engine";
import { LocalGameExecutor } from "./state-executor";
import type { NovaAction, NovaActionAck, NovaGameDeclaration, NovaStateHandlers } from "./types";
import { assertStructuredCloneSafe } from "./validation";
import {
  type NovaSessionOptions,
  type BufferedDispatch,
  dispatchRetryIntervalMs,
  MAX_BUFFERED_DISPATCHES,
} from "./session-shared";
import { SessionLifecycle } from "./session-lifecycle";

export type { NovaSessionOptions, NovaSessionPlayer } from "./session-shared";

/** Create a session over a transport and its game-facing client. */
export function createNovaSession(options: NovaSessionOptions): NovaSession {
  return new NovaSession(options);
}

/** Routes game calls and state-engine events over a Nova transport. */
export class NovaSession extends SessionLifecycle {
  register(declaration: NovaGameDeclaration, handlers?: NovaStateHandlers): void {
    this.assertAlive();
    this.declaration = declaration;
    if (declaration.tickRate !== undefined) this.setTickRate(declaration.tickRate);
    if (handlers !== undefined) {
      this.stateHandlers = handlers;
      if (this.injectedExecutor === undefined) {
        this.engine.setExecutor(new LocalGameExecutor(handlers));
      }
    }
  }

  ready(): void {
    this.assertAlive();
    this.readySent = true;
    this.selfPlayer.ready = true;
    void this.sendProtocol((base) => buildGameReadyMessage(base)).catch((error: unknown) =>
      this.emitError(error),
    );
  }

  /**
   * Dispatch one action: validate, assign the base revision, and
   * either apply locally (this session is the current authority), send the
   * action to the authority, or — when no authority is known (election in
   * progress) — buffer it until the new authority is announced (ADR-0007:
   * actions buffer during election). In-flight dispatches are re-sent when
   * the authority changes so an action whose ack was lost in a migration is
   * applied exactly once (history + queue deduplication). Resolves once the
   * action is accepted for delivery; the game-facing promise resolves on the
   * authority's ack (see the client).
   */
  async dispatch(action: NovaAction, actionId: string): Promise<void> {
    this.assertAlive();
    assertValidSchema(
      novaActionSchema.safeParse(action),
      "nova.dispatch options failed validation.",
    );
    assertStructuredCloneSafe(action.payload, "nova.dispatch action payload");
    if (typeof actionId !== "string" || actionId.length < 1 || actionId.length > 64) {
      throw new NovaError("invalid_options", "nova.dispatch action id must be 1..64 characters.");
    }
    if (this.engine.isEnded()) {
      throw new NovaError("ended", endedMessage("dispatch"));
    }
    if (this.engine.isDeltaPending()) {
      // The base revision must be the state the game last saw: wait for the
      // delta in flight to settle, so an action is never stamped with a stale base.
      await new Promise<void>((resolve) => this.deltaWaiters.push(resolve));
    }
    this.gameByteBudget.consume(payloadBytes(action), (event) => this.emit(event));
    const baseRevision = action.baseRevision ?? this.engine.getRevision();
    const authority = this.engine.getAuthorityMemberId();
    const entry: BufferedDispatch = {
      actionId,
      type: action.type,
      payload: action.payload,
      baseRevision,
      deadlineMs: Date.now() + actionTimeoutMs,
    };
    if (authority === this.selfPlayer.id) {
      // Local dispatch on the authority session (no transport round trip).
      // Track it in-flight so that if the authority steps down mid-commit
      // (the async state-hash digest can race a peer campaign), the action
      // is re-sent to the new authority by flushDispatchBuffer and applied
      // exactly once (deduplication on the new authority; ADR-0007). The
      // local ack (any status) removes the entry.
      this.trackInflight(entry);
      this.engine.handleLocalAction({
        actionId,
        type: action.type,
        payload: action.payload,
        baseRevision,
      });
      return Promise.resolve();
    }
    if (authority === null) {
      // Election in progress (or authority unknown): buffer until the new
      // authority is announced (the client promise resolves on its ack).
      if (this.dispatchBuffer.length >= MAX_BUFFERED_DISPATCHES) {
        // Entries past their deadline can never be applied: free their slots
        // before refusing anything new.
        const now = Date.now();
        const live = this.dispatchBuffer.filter((held) => held.deadlineMs > now);
        this.dispatchBuffer.splice(0, this.dispatchBuffer.length, ...live);
        if (this.dispatchBuffer.length >= MAX_BUFFERED_DISPATCHES) {
          throw new NovaError(
            "rate_limited",
            `nova.dispatch was refused: ${MAX_BUFFERED_DISPATCHES} actions are already waiting for an authority.`,
          );
        }
      }
      this.dispatchBuffer.push(entry);
      return Promise.resolve();
    }
    this.trackInflight(entry);
    this.sendBufferedDispatch(entry);
    return Promise.resolve();
  }

  /**
   * This player's page was hidden (`away`) or shown again (host policy).
   * A hidden phone can be suspended at any moment, freezing every game it
   * hosts until the grace period runs out, so an away player is not
   * eligible for authority and a sitting authority hands off at once.
   * Coming back does not take authority back.
   */
  setAway(away: boolean): void {
    if (this.disposed || this.selfPlayer.authorityEligible === !away) return;
    this.selfPlayer.authorityEligible = !away;
    // Peers must see the new eligibility before the election it starts.
    void this.sendProtocol((base) =>
      buildPlayerIdentityMessage(base, this.selfPlayer.name, !away),
    ).catch((error: unknown) => this.emitError(error));
    if (away) this.engine.stepDown();
  }

  /**
   * The tick rate this player's game frame declared (hosts pass it from the
   * frame's registration). Every frame runs the same game, so every session
   * agrees; only the authority ticks.
   */
  setTickRate(rate: number | null): void {
    if (rate !== null) this.controlsIntervalMs = 1000 / rate;
    this.engine.setTickRate(rate);
  }

  /**
   * Replace this player's controls. Only changes go out, to the authority
   * only, at most once per tick; a burst of calls sends the latest value.
   */
  setControls(value: unknown): void {
    this.assertAlive();
    assertStructuredCloneSafe(value, "nova.controls.set value");
    const json = JSON.stringify(value) ?? "null";
    if (new TextEncoder().encode(json).length > controlsBytes) {
      throw new NovaError(
        "payload_too_large",
        `nova.controls.set takes at most ${controlsBytes} bytes of JSON. Send what the player is doing (buttons, a direction), not game state.`,
      );
    }
    if (json === this.myControls?.json) return;
    this.myControls = { value, json };
    this.controlsByMember.set(this.selfPlayer.id, value);
    if (this.controlsTimer === null) this.flushControls();
  }

  /** Send this player's controls to the authority if they changed since the last send. */
  protected flushControls(force = false): void {
    const mine = this.myControls;
    const authority = this.engine.getAuthorityMemberId();
    if (mine === null || authority === null || authority === this.selfPlayer.id) return;
    if (!force && mine.json === this.sentControlsJson) return;
    this.sentControlsJson = mine.json;
    void this.sendProtocol((base) => buildGameControlsMessage(base, mine.value), {
      targetMemberId: authority,
    }).catch((error: unknown) => this.emitError(error));
    if (this.controlsTimer !== null) clearTimeout(this.controlsTimer);
    this.controlsTimer = setTimeout(() => {
      this.controlsTimer = null;
      this.flushControls();
    }, this.controlsIntervalMs);
  }

  /** The latest controls of every connected player, for the tick. */
  private connectedControls(): Record<string, unknown> {
    const controls: Record<string, unknown> = {};
    for (const [memberId, value] of this.controlsByMember) {
      if (memberId === this.selfPlayer.id || this.playersMap.has(memberId)) {
        controls[memberId] = value;
      }
    }
    return controls;
  }

  protected handleMessage(message: TransportMessage): void {
    if (message.channel !== NOVA_PROTOCOL_CHANNEL) {
      // Games have no channels of their own; ignore anything else.
      return;
    }
    if (this.engine.isDeltaPending()) {
      // A delta's hash is still being checked: the view and acks that follow
      // it must not reach the game before the state they belong to.
      this.deferredProtocolMessages.push(message);
      return;
    }
    const parsed = parsePeerMessage(message.payload);
    if (!parsed.ok) {
      this.emit({
        type: "error",
        error: new NovaError(
          "invalid_message",
          `Received an invalid protocol message: ${parsed.error.message}`,
        ),
      });
      return;
    }
    const peerMessage = parsed.value;
    switch (peerMessage.type) {
      case "player.identity": {
        const player = this.playersMap.get(peerMessage.senderMemberId);
        if (player !== undefined) {
          player.name = peerMessage.displayName;
          player.authorityEligible = peerMessage.authorityEligible;
        }
        // A peer that introduces itself may have attached its session after
        // our readiness announcement was sent: re-send our ready state so no
        // member is left thinking we are not ready.
        if (this.readySent) {
          void this.sendProtocol((base) => buildGameReadyMessage(base), {
            targetMemberId: peerMessage.senderMemberId,
          }).catch((error: unknown) => this.emitError(error));
        }
        break;
      }
      case "game.controls": {
        const json = JSON.stringify(peerMessage.controls) ?? "null";
        if (new TextEncoder().encode(json).length <= controlsBytes) {
          this.controlsByMember.set(peerMessage.senderMemberId, peerMessage.controls);
        }
        break;
      }
      case "game.ready": {
        const player = this.playersMap.get(peerMessage.senderMemberId);
        // Only a change is news: a duplicate game.ready must not re-render.
        if (player !== undefined && !player.ready) {
          player.ready = true;
          this.emit({ type: "ready", memberId: player.id });
        }
        break;
      }
      case "game.start":
        // Followers emit start only when the authority's announcement
        // arrived first (same ordered channel), so frames never see onStart
        // before state and the authority are known.
        if (
          !this.startEmitted &&
          peerMessage.senderMemberId === this.engine.getAuthorityMemberId()
        ) {
          this.startEmitted = true;
          this.engine.beginGame();
          this.emit({ type: "start" });
          break;
        }
        // A start request from another admitted member. The lowest eligible
        // member is the elected authority, and it is the only session that
        // can start the game as authority. A host that is not the lowest id
        // (the host's own start() sends game.start as a follower) would
        // otherwise leave the game stuck in "starting". The elected authority
        // honours the request only if `acceptStartRequest` allows it (the
        // party engine: the host, once sources are verified); it then calls
        // start(), whose authoritative game.start the others accept above.
        if (
          !this.started &&
          this.engine.wouldElectSelf() &&
          this.playersMap.has(peerMessage.senderMemberId)
        ) {
          if (this.acceptStartRequest(peerMessage.senderMemberId)) {
            this.start();
          } else {
            this.emitError(
              new NovaError(
                "invalid_state",
                `Ignored a start request from ${peerMessage.senderMemberId}: only the host can start the game, once every player has the source.`,
              ),
            );
          }
        }
        break;
      case "game.end":
        if (!this.ended) {
          this.ended = true;
          this.engine.endGame();
          this.emit({ type: "end", reason: peerMessage.reason });
        }
        break;
      case "action.dispatch":
        // Every shell routes the dispatch to its
        // engine, which applies only when this session is the current
        // authority (other shells drop it and re-send on authority change).
        this.emit({
          type: "actionReceived",
          action: {
            type: peerMessage.actionType,
            payload: peerMessage.payload,
            baseRevision: peerMessage.baseRevision,
          },
        });
        this.engine.handleInboundAction({
          actionId: peerMessage.actionId,
          seq: peerMessage.seq,
          actionType: peerMessage.actionType,
          payload: peerMessage.payload,
          baseRevision: peerMessage.baseRevision,
          sentAt: peerMessage.sentAt,
          ...(peerMessage.expiresAtMs !== undefined
            ? { expiresAtMs: peerMessage.expiresAtMs }
            : {}),
          senderMemberId: peerMessage.senderMemberId,
        });
        break;
      case "action.ack":
        this.noteActionAck(peerMessage.actionId);
        this.emit({
          type: "actionAck",
          ack: {
            actionId: peerMessage.actionId,
            status: peerMessage.status,
            ...(peerMessage.revision !== undefined ? { revision: peerMessage.revision } : {}),
            ...(peerMessage.errorCode !== undefined ? { errorCode: peerMessage.errorCode } : {}),
            ...(peerMessage.errorMessage !== undefined
              ? { errorMessage: peerMessage.errorMessage }
              : {}),
          },
        });
        break;
      case "state.snapshot":
        // Canonical state is replicated to every shell for migration; only
        // the player's selected view ever reaches the game frame.
        this.engine.handleSnapshot({
          revision: peerMessage.revision,
          stateHash: peerMessage.stateHash ?? null,
          term: peerMessage.term,
          authorityMemberId: peerMessage.authorityMemberId,
          historyMode: peerMessage.historyMode,
          baseStateHash: peerMessage.baseStateHash ?? null,
          historyComplete: peerMessage.historyComplete,
          stateMode: peerMessage.stateMode,
          ...(peerMessage.ops !== undefined ? { ops: peerMessage.ops } : {}),
          processedActionIds: peerMessage.processedActionIds,
          ...(peerMessage.actionRejections
            ? { actionRejections: peerMessage.actionRejections }
            : {}),
          state: peerMessage.state,
          ...(peerMessage.viewIsState === true ? { viewIsState: true } : {}),
          senderMemberId: peerMessage.senderMemberId,
        });
        if (!this.startEmitted) {
          // A late joiner starts from the catch-up snapshot.
          this.startEmitted = true;
          this.engine.beginGame();
          this.emit({ type: "start" });
        }
        break;
      case "state.resync":
        this.engine.handleResync({
          requesterMemberId: peerMessage.senderMemberId,
          knownRevision: peerMessage.knownRevision,
        });
        break;
      case "state.view":
        if (peerMessage.forMemberId === this.selfPlayer.id) {
          this.emit({ type: "state", state: peerMessage.view });
        }
        break;
      case "authority.announce":
        this.engine.handleAnnounce({
          term: peerMessage.term,
          authorityMemberId: peerMessage.authorityMemberId,
          stateRevision: peerMessage.stateRevision,
          ...(peerMessage.stateHash !== undefined ? { stateHash: peerMessage.stateHash } : {}),
          eligibleMemberIds: peerMessage.eligibleMemberIds,
        });
        break;
      case "authority.heartbeat":
        this.engine.handleHeartbeat({
          term: peerMessage.term,
          authorityMemberId: peerMessage.authorityMemberId,
          stateRevision: peerMessage.stateRevision,
          heartbeatSeq: peerMessage.heartbeatSeq,
        });
        break;
      case "authority.election":
        this.engine.handleElection({
          term: peerMessage.term,
          candidateMemberId: peerMessage.candidateMemberId,
          observed: peerMessage.observed,
        });
        break;
      default:
        // Party, source, and connection-status messages stay on the
        // host side; the game-facing API does not expose them.
        break;
    }
  }

  /**
   * Send one buffered/in-flight dispatch to the current authority. Only the
   * authority applies dispatches (`handleInboundAction`), so the message is
   * targeted at it; a dispatch lost to a stale view is re-sent by
   * `flushDispatchBuffer` when the authority changes.
   */
  private sendBufferedDispatch(entry: BufferedDispatch): void {
    const authority = this.engine.getAuthorityMemberId();
    if (authority === this.selfPlayer.id) {
      this.engine.handleLocalAction({
        actionId: entry.actionId,
        type: entry.type,
        payload: entry.payload,
        baseRevision: entry.baseRevision,
      });
      return;
    }
    if (authority === null) return; // still electing; keep buffered
    const seq = this.takeSeq();
    void this.sendProtocol(
      (base) =>
        buildActionDispatchMessage(base, {
          seq,
          actionId: entry.actionId,
          baseRevision: entry.baseRevision,
          actionType: entry.type,
          payload: entry.payload,
          expiresAtMs: entry.deadlineMs,
        }),
      { seq, targetMemberId: authority },
    ).catch((error: unknown) => this.emitError(error));
  }

  /**
   * The authority changed: flush buffered dispatches toward the new
   * authority and re-send in-flight ones whose ack may have been lost in the
   * migration. Deduplication on the authority side (history + queue) makes
   * the re-sends exactly-once.
   */
  private flushDispatchBuffer(): void {
    const authority = this.engine.getAuthorityMemberId();
    if (authority === null) return;
    // Buffered entries become in-flight here and are sent exactly once: the
    // second loop covers everything in flight, including them.
    for (const entry of this.dispatchBuffer.splice(0)) {
      if (Date.now() < entry.deadlineMs) this.trackInflight(entry);
    }
    for (const entry of this.inflightDispatches.values()) {
      this.sendBufferedDispatch(entry);
    }
  }

  /**
   * Hold a dispatch as in flight until its ack arrives. While it is unacked,
   * re-send it to the current authority view every `dispatchRetryIntervalMs`,
   * and stop at its deadline. The authority deduplicates, so a re-send can
   * never apply the action twice, and the fixed deadline stops a late copy
   * from committing after the game was told the action timed out.
   */
  private trackInflight(entry: BufferedDispatch): void {
    this.inflightDispatches.set(entry.actionId, entry);
    this.armDispatchRetry(entry.actionId);
  }

  private armDispatchRetry(actionId: string): void {
    this.clearDispatchRetry(actionId);
    const timer = setTimeout(() => {
      this.dispatchRetryTimers.delete(actionId);
      const entry = this.inflightDispatches.get(actionId);
      if (entry === undefined || this.disposed || this.ended) return;
      if (Date.now() >= entry.deadlineMs) {
        // Expired: stop, so no copy can be sent (or applied) after the deadline.
        this.inflightDispatches.delete(actionId);
        return;
      }
      this.sendBufferedDispatch(entry);
      this.armDispatchRetry(actionId);
    }, dispatchRetryIntervalMs);
    this.dispatchRetryTimers.set(actionId, timer);
  }

  private clearDispatchRetry(actionId: string): void {
    const timer = this.dispatchRetryTimers.get(actionId);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.dispatchRetryTimers.delete(actionId);
    }
  }

  /** Replay held protocol messages, in order, until another delta is pending. */
  private drainDeferredProtocolMessages(): void {
    while (this.deferredProtocolMessages.length > 0 && !this.engine.isDeltaPending()) {
      const next = this.deferredProtocolMessages.shift();
      if (next !== undefined) this.handleMessage(next);
    }
  }

  /** Drop an in-flight dispatch once its ack arrived (any status). */
  private noteActionAck(actionId: string): void {
    this.inflightDispatches.delete(actionId);
    this.clearDispatchRetry(actionId);
  }

  /** The transport-facing half the state engine uses to send and emit. */
  protected buildEngineHost(): StateEngineHost {
    return {
      players: () => this.players,
      isConnected: (memberId) => memberId === this.selfPlayer.id || this.playersMap.has(memberId),
      selfConnected: () => this.transport.connectionState === "connected",
      eligibleMemberIds: () =>
        [this.selfPlayer, ...this.playersMap.values()]
          .filter((record) => record.authorityEligible)
          .map((record) => record.id),
      controls: () => this.connectedControls(),
      sendAck: (targetMemberId, ack) => this.sendEngineAck(targetMemberId, ack),
      sendSnapshot: (snapshot, targetMemberId) => this.sendEngineSnapshot(snapshot, targetMemberId),
      sendView: (targetMemberId, view) => this.sendEngineView(targetMemberId, view),
      sendResync: (targetMemberId, request) => this.sendEngineResync(targetMemberId, request),
      sendAnnounce: (announcement) => this.sendEngineAnnounce(announcement),
      sendHeartbeat: (heartbeat) => this.sendEngineHeartbeat(heartbeat),
      sendElection: (election) => this.sendEngineElection(election),
      emit: (event) => this.handleEngineEvent(event),
    };
  }

  /** Emit one action ack (targeted; local when the actor is this session). */
  private sendEngineAck(targetMemberId: string, ack: NovaActionAck): void {
    if (targetMemberId === this.selfPlayer.id) {
      this.noteActionAck(ack.actionId);
      this.emit({ type: "actionAck", ack });
      return;
    }
    const seq = this.takeSeq();
    void this.sendProtocol(
      (base) =>
        buildActionAckMessage(base, {
          seq,
          actionId: ack.actionId,
          status: ack.status,
          ...(ack.revision !== undefined ? { revision: ack.revision } : {}),
          ...(ack.errorCode !== undefined ? { errorCode: ack.errorCode } : {}),
          ...(ack.errorMessage !== undefined ? { errorMessage: ack.errorMessage } : {}),
        }),
      { seq, targetMemberId },
    ).catch((error: unknown) => this.emitError(error));
  }

  /** Send a state snapshot (broadcast, or targeted at one shell). */
  protected sendEngineSnapshot(snapshot: StateSnapshotEnvelope, targetMemberId?: string): void {
    const seq = this.takeSeq();
    const options: { targetMemberId?: string } = {};
    if (targetMemberId !== undefined) {
      options.targetMemberId = targetMemberId;
    }
    void this.sendProtocol(
      (base) =>
        buildStateSnapshotMessage(base, {
          seq,
          revision: snapshot.revision,
          ...(snapshot.stateHash !== null ? { stateHash: snapshot.stateHash } : {}),
          term: snapshot.term,
          authorityMemberId: snapshot.authorityMemberId,
          historyMode: snapshot.historyMode,
          ...(snapshot.baseStateHash !== null ? { baseStateHash: snapshot.baseStateHash } : {}),
          historyComplete: snapshot.historyComplete,
          stateMode: snapshot.stateMode,
          ...(snapshot.ops !== null ? { ops: snapshot.ops } : {}),
          processedActionIds: snapshot.processedActionIds,
          ...(snapshot.actionRejections ? { actionRejections: snapshot.actionRejections } : {}),
          state: snapshot.state,
          ...(snapshot.viewIsState ? { viewIsState: true as const } : {}),
        }),
      options,
    ).catch((error: unknown) => this.emitError(error));
  }

  /** Ask the current authority for a full snapshot (state.resync, targeted). */
  private sendEngineResync(targetMemberId: string, request: StateResyncEnvelope): void {
    const seq = this.takeSeq();
    void this.sendProtocol(
      (base) => buildStateResyncMessage(base, { seq, knownRevision: request.knownRevision }),
      { seq, targetMemberId },
    ).catch((error: unknown) => this.emitError(error));
  }

  /** Send one player's selected view (targeted). */
  private sendEngineView(targetMemberId: string, view: StateViewEnvelope): void {
    if (targetMemberId === this.selfPlayer.id) {
      // The transport cannot target this session itself (the self player is
      // not a peer); deliver the view locally instead.
      this.emit({ type: "state", state: view.view });
      return;
    }
    const seq = this.takeSeq();
    void this.sendProtocol(
      (base) =>
        buildStateViewMessage(base, {
          seq,
          revision: view.revision,
          ...(view.stateHash !== null ? { stateHash: view.stateHash } : {}),
          forMemberId: view.forMemberId,
          view: view.view,
        }),
      { seq, targetMemberId },
    ).catch((error: unknown) => this.emitError(error));
  }

  private sendEngineAnnounce(announcement: AuthorityAnnounceEnvelope): void {
    const seq = this.takeSeq();
    void this.sendProtocol(
      (base) =>
        buildAuthorityAnnounceMessage(base, {
          seq,
          term: announcement.term,
          authorityMemberId: announcement.authorityMemberId,
          stateRevision: announcement.stateRevision,
          ...(announcement.stateHash !== null ? { stateHash: announcement.stateHash } : {}),
          eligibleMemberIds: announcement.eligibleMemberIds,
        }),
      { seq },
    ).catch((error: unknown) => this.emitError(error));
  }

  /** Broadcast an authority heartbeat (live-only, never queued). */
  private sendEngineHeartbeat(heartbeat: AuthorityHeartbeatEnvelope): void {
    if (this.transport.connectionState !== "connected") return; // soft state
    const seq = this.takeSeq();
    void this.deliverProtocol(
      buildAuthorityHeartbeatMessage(this.base(), {
        seq,
        term: heartbeat.term,
        authorityMemberId: heartbeat.authorityMemberId,
        stateRevision: heartbeat.stateRevision,
        heartbeatSeq: heartbeat.heartbeatSeq,
      }),
      { seq },
    ).catch((error: unknown) => this.emitError(error));
  }

  /** Broadcast an authority election campaign (live-only, never queued). */
  private sendEngineElection(election: AuthorityElectionEnvelope): void {
    if (this.transport.connectionState !== "connected") return; // soft state
    const seq = this.takeSeq();
    void this.deliverProtocol(
      buildAuthorityElectionMessage(this.base(), {
        seq,
        term: election.term,
        candidateMemberId: election.candidateMemberId,
        observed: election.observed.map((observation) => ({
          memberId: observation.memberId,
          revision: observation.revision,
          ...(observation.stateHash !== null ? { stateHash: observation.stateHash } : {}),
        })),
      }),
      { seq },
    ).catch((error: unknown) => this.emitError(error));
  }

  private handleEngineEvent(event: StateEngineEvent): void {
    switch (event.type) {
      case "stateCommitted":
        this.emit({
          type: "stateCommitted",
          revision: event.revision,
          stateHash: event.stateHash,
          stateSizeBytes: event.stateSizeBytes,
          appliedCount: event.appliedCount,
          rejectedCount: event.rejectedCount,
          actionRatePerSecond: event.actionRatePerSecond,
          tick: event.tick,
        });
        break;
      case "viewFromState":
        this.emit({ type: "state", state: event.state });
        break;
      case "actionRejected":
        this.emit({
          type: "actionRejected",
          actionId: event.actionId,
          code: event.code,
          message: event.message,
        });
        break;
      case "stateError":
        this.emit({ type: "error", error: new NovaError(toErrorCode(event.code), event.message) });
        break;
      case "authorityChanged":
        // Flush buffered dispatches toward the new authority and re-send
        // in-flight ones (deduplication makes the re-sends exactly-once).
        this.flushDispatchBuffer();
        // The new authority has never seen this player's controls.
        this.flushControls(true);
        // Host-side only: the arena displays authority migration, but the
        // game-facing client ignores this event.
        this.emit({
          type: "authorityChanged",
          authorityMemberId: event.authorityMemberId,
          term: event.term,
        });
        break;
      case "electionStarted":
        // Host/arena diagnostics only (visible through getStateModeDiagnostics).
        break;
      case "deltaSettled":
        // Replay held traffic first, so waiting dispatches see the new revision.
        this.drainDeferredProtocolMessages();
        for (const resolve of this.deltaWaiters.splice(0)) resolve();
        break;
      case "historyIncomplete":
        // Host-side diagnostic: a gapped window does not affect the game.
        this.emit({
          type: "historyIncomplete",
          authorityMemberId: event.authorityMemberId,
          term: event.term,
        });
        break;
      case "snapshotFallback":
        // Host-side diagnostic: a delta fell back to the full state; the game is unaffected.
        this.emit({ type: "snapshotFallback", reason: event.reason });
        break;
    }
  }

  /** Next monotonic per-sender sequence for ordered message families. */
  private takeSeq(): number {
    this.nextSeq += 1;
    return this.nextSeq;
  }

  private base(): PeerMessageBase {
    return {
      sessionId: this.sessionId,
      senderMemberId: this.transport.selfMemberId,
      senderConnectionId: this.transport.selfConnectionId,
    };
  }

  /** Send a protocol message, or queue it until the transport connects. */
  protected sendProtocol(
    build: (base: PeerMessageBase) => PeerMessage,
    options: { targetMemberId?: string; seq?: number } = {},
  ): Promise<void> {
    if (this.transport.connectionState === "connected") {
      return this.deliverProtocol(build(this.base()), options);
    }
    this.outbox.push({ build, ...options });
    return Promise.resolve();
  }

  private async deliverProtocol(
    message: PeerMessage,
    options: { targetMemberId?: string; seq?: number },
  ): Promise<void> {
    const targetConnectionId =
      options.targetMemberId === undefined
        ? undefined
        : this.connectionIdOf(options.targetMemberId);
    if (options.targetMemberId !== undefined && targetConnectionId === undefined) {
      return; // the target left before this message flushed
    }
    await this.transport.send({
      channel: NOVA_PROTOCOL_CHANNEL,
      payload: message,
      version: PROTOCOL_VERSION,
      ...(options.seq !== undefined ? { seq: options.seq } : {}),
      reliability: "reliable",
      ordering: "ordered",
      ...(targetConnectionId !== undefined ? { targetConnectionId } : {}),
    });
  }

  protected flushOutbox(): void {
    const pending = this.outbox.splice(0);
    for (const entry of pending) {
      void this.deliverProtocol(entry.build(this.base()), entry).catch((error: unknown) =>
        this.emitError(error),
      );
    }
  }
}

function assertValidSchema(result: { success: boolean }, message: string): void {
  if (!result.success) {
    throw new NovaError("invalid_options", message);
  }
}
