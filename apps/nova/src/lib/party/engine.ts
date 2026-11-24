/**
 * Page-owned party facade: route remounts preserve the party and runtime.
 * Setup, connection recovery, game lifecycle, source distribution, runtime
 * bridging, and snapshot projection live in composed collaborators.
 *
 * Shell host and game authority are separate roles; nova-api reconciles
 * authority. Invite material stays in PartySession memory, never in runtime
 * messages. Party control, game source, and gameplay use separate planes.
 *
 * Transport, scheduler, lifecycle, and runtime seams keep the same engine
 * usable with production adapters and deterministic in-memory tests.
 */
import type { GameApiEvent, MemberId } from "@rocketcrab/protocol";
import type { GameSourceTransferEvent } from "@rocketcrab/party";
import type { NovaSessionEvent } from "@rocketcrab/nova-api";
import type { RuntimeHostEvent } from "../runtime-host";
import type {
  PartyEngineConfig,
  PartyEngineState,
  PartyPhase,
  PartySourceSpec,
  SharedPartyGameSource,
} from "./engine-types";
import { PartyEngineContext } from "./engine-context";
import type { PartyEngineServices } from "./engine-services";
import { PartySetup } from "./engine-setup";
import { PartyConnection } from "./engine-connection";
import { PartyGameLifecycle } from "./engine-game";
import { PartyRuntime } from "./engine-runtime";
import { PartySource } from "./engine-source";
import { PartySnapshot } from "./engine-snapshot";

export type {
  PartyRuntimeSeams,
  PartySecretDerivation,
  PartyMemberView,
  PartyDiagnostics,
  PartyNotice,
  PeerLinkStatus,
  PartyPhase,
  JoinStage,
  PartyEngineState,
  PartyEngineConfig,
  PartySourceSpec,
  SharedPartyGame,
  SharedPartyGameSource,
} from "./engine-types";

export class PartyEngine {
  private readonly state: PartyEngineContext;
  private readonly services: PartyEngineServices;

  constructor(config: PartyEngineConfig = {}) {
    this.state = new PartyEngineContext(config, () => this.emit());
    // Resolve collaborators at call time: subscriptions may synchronously replay
    // events, so wire the entire graph before subscribing to the page lifecycle.
    const services = () => this.services;
    this.services = {
      setup: new PartySetup(this.state, services),
      connection: new PartyConnection(this.state, services),
      game: new PartyGameLifecycle(this.state, services),
      runtime: new PartyRuntime(this.state, services),
      source: new PartySource(this.state, services),
      snapshot: new PartySnapshot(this.state, services),
    };
    if (import.meta.env.DEV || import.meta.env.MODE === "test") {
      (globalThis as { __NOVA_PARTY_DEBUG__?: () => unknown }).__NOVA_PARTY_DEBUG__ = () =>
        this.debugSnapshot();
    }
    this.services.connection.subscribeLifecycle();
  }

  getState(): PartyEngineState {
    return this.services.snapshot.getState();
  }

  /** Subscribers receive the current snapshot immediately. */
  onState(handler: (state: PartyEngineState) => void): () => void {
    return this.services.snapshot.onState(handler);
  }

  /** Includes setup and error phases, not just an established session. */
  isActive(): boolean {
    return this.services.connection.isActive();
  }

  setContainer(element: HTMLElement | null): void {
    return this.services.runtime.setContainer(element);
  }

  /** An omitted source opens an empty lobby; a supplied source is announced immediately. */
  createParty(input?: PartySourceSpec): Promise<void> {
    return this.services.setup.createParty(input);
  }

  /** Join a party from an invite-link secret (ADR-0011). */
  joinByInvite(input: { secret: string }): Promise<void> {
    return this.services.setup.joinByInvite(input);
  }

  selectGame(input: PartySourceSpec): Promise<void> {
    return this.services.game.selectGame(input);
  }

  /** The verified source of a Nova game shared in this party, to save a copy. */
  sharedGameSource(gameId: string): SharedPartyGameSource | undefined {
    return this.services.source.sharedGameSource(gameId);
  }

  /** Host-only, in the lobby. Create one external room and share its URL spec with all players. */
  selectExternalGame(gameId: string): Promise<void> {
    return this.services.game.selectExternalGame(gameId);
  }

  reloadMyGame(): void {
    return this.services.game.reloadMyGame();
  }

  /** Host-only; the sender also reloads its own frame. */
  reloadAllGames(): void {
    return this.services.game.reloadAllGames();
  }

  /** Host-only cooperative removal: the recipient must leave when it receives the kick. */
  kickMember(memberId: string): void {
    return this.services.game.kickMember(memberId);
  }

  dismissRemoved(): void {
    return this.services.game.dismissRemoved();
  }

  /** Persist the name and update peers and the local frame without rejoining. */
  setDisplayName(name: string): void {
    return this.services.game.setDisplayName(name);
  }

  retrySetup(): void {
    return this.services.setup.retrySetup();
  }

  /** Dismiss a setup error without running party teardown. */
  dismissError(): void {
    return this.services.setup.dismissError();
  }

  /** Force bypasses readiness, never source verification. */
  startGame(force = false): void {
    return this.services.game.startGame(force);
  }

  /** Start-flow diagnostics, exposed on window.__NOVA_PARTY_DEBUG__ in dev/test builds. */
  debugSnapshot(): Record<string, unknown> {
    return this.services.snapshot.debugSnapshot();
  }

  /** End the game for all members without leaving the party. */
  endGame(reason: "user_exit" | "host_closed" | "error" = "host_closed"): void {
    return this.services.game.endGame(reason);
  }

  /** Resolve after teardown. Kicked members use "removed" to avoid flashing the entry UI. */
  leaveParty(nextPhase: PartyPhase = "idle", preserveSetup = false): Promise<void> {
    return this.services.connection.leaveParty(nextPhase, preserveSetup);
  }

  /**
   * Single-flight across user actions, lifecycle events, and timers.
   * Also replaces connected-looking transports whose peers no longer answer.
   */
  reconnect(): Promise<void> {
    return this.services.connection.reconnect();
  }

  clearRuntimeLogs(): void {
    return this.services.runtime.clearRuntimeLogs();
  }

  refreshDiagnostics(): Promise<void> {
    return this.services.snapshot.refreshDiagnostics();
  }

  // Private deterministic-test seams; not part of the public API.
  private get session() {
    return this.state.session;
  }

  private get coordinator() {
    return this.state.coordinator;
  }

  private get transfers() {
    return this.state.transfers;
  }

  private get lastStateApiEvent(): GameApiEvent | null {
    return this.state.lastStateApiEvent;
  }

  private set lastStateApiEvent(event: GameApiEvent | null) {
    this.state.lastStateApiEvent = event;
  }

  private handleSessionEvent(event: NovaSessionEvent): void {
    this.services.game.handleSessionEvent(event);
  }

  private handleCoordinatorEvent(event: GameSourceTransferEvent): void {
    this.services.source.handleCoordinatorEvent(event);
  }

  private handleHostEvent(event: RuntimeHostEvent): void {
    this.services.runtime.handleHostEvent(event);
  }

  private acceptStartRequestFrom(memberId: MemberId): boolean {
    return this.services.game.acceptStartRequestFrom(memberId);
  }

  private emit(): void {
    this.services.snapshot.emit();
  }
}

export const partyEngine = new PartyEngine();
