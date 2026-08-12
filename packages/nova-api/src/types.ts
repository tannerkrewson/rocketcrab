/**
 * The game-facing Nova API surface (S1).
 *
 * These types are the contract AI-generated games program against. The API
 * is deliberately small: a handful of concepts (registration, players,
 * lifecycle, state, actions, raw channels, simulation), zero transport or
 * hosting vocabulary, and every value that crosses a boundary is plain,
 * structured-clone-compatible data.
 *
 * The concrete object games receive (`window.nova`) is built by
 * {@link createNovaClient}; the host-side engine that drives it over the
 * transport is {@link NovaSession}. Public documentation is generated or
 * checked from these source types (see `docs/api/`).
 */
import type { GameEndReason, GameMode } from "@rocketcrab/protocol";
import type { NovaError } from "./errors";

/**
 * Local connection status of this player (no transport terminology; this is
 * whether *this* player is connected to the party, never a "host" role).
 */
export type NovaConnectionStatus =
  | "connecting" // joining the party
  | "connected" // joined; messages flow
  | "reconnecting" // the connection dropped and is being re-established
  | "suspended" // the connection dropped (e.g. backgrounded) and may resume
  | "disconnected"; // not connected

/** One player in the game. `id` is stable for the whole party (ADR-0007). */
export interface NovaPlayer {
  /** Stable per-player id. */
  readonly id: string;
  /** Player-facing display name. */
  readonly name: string;
}

/**
 * Registration options for `nova.defineGame`. Everything here is plain data
 * (it crosses the runtime frame boundary), so no functions are allowed.
 */
export interface NovaGameDeclaration {
  /** Human-readable game title shown in lobbies. */
  title?: string;
  /** Execution mode (ADR-0006): "state" (default) | "simulation" | "raw". */
  mode?: GameMode;
  /** The game's own version string (distinct from the Nova API version). */
  version?: string;
  /** The Nova API version this game targets; defaults to `nova.version`. */
  apiVersion?: number;
}

/**
 * One action dispatched in state mode. Nova owns action ordering,
 * deduplication, and application (ADR-0006); the game only describes the
 * action.
 */
export interface NovaAction {
  /** Action kind, e.g. "playCard". Bounded to 1..64 characters. */
  readonly type: string;
  /** Action payload; must be JSON-serializable (no functions, no cycles). */
  readonly payload?: unknown;
  /**
   * The state revision this action was based on (0 before any state).
   * Revision semantics arrive with S2; S1 accepts and forwards it.
   */
  readonly baseRevision?: number;
}

/** Declares a raw-mode channel (ADR-0006 raw mode). */
export interface NovaRawChannelSpec {
  /** Channel name, 1..64 characters; cannot be a reserved protocol name. */
  readonly name: string;
  /** Reliable delivery (default true; unreliable may drop messages). */
  readonly reliable?: boolean;
  /** Ordered delivery (default true; unordered may arrive out of order). */
  readonly ordered?: boolean;
  /** The game will send binary payloads on this channel (default false). */
  readonly binary?: boolean;
}

/** Options for one raw send on a channel. */
export interface NovaRawSendOptions {
  /** Target one player by id; omit to broadcast to every connected player. */
  readonly to?: string;
  /** Override the channel's reliable setting for this send. */
  readonly reliable?: boolean;
  /** Override the channel's ordered setting for this send. */
  readonly ordered?: boolean;
}

/** One raw message received on a raw channel. */
export interface NovaRawMessage {
  /** The player who sent it. */
  readonly from: NovaPlayer;
  /** The payload: JSON data, or binary when `binary` is true. */
  readonly payload: unknown;
  /** True when the payload was transferred as binary bytes. */
  readonly binary: boolean;
}

/** One player input in simulation mode (ADR-0006 simulation mode). */
export interface NovaSimulationInput {
  /** Input kind, e.g. "move". Bounded to 1..64 characters. */
  readonly type: string;
  /** Input payload; must be JSON-serializable. */
  readonly payload?: unknown;
  /** Optional target simulation tick (simulation clock arrives with A1). */
  readonly tick?: number;
}

/** Handlers a simulation-mode game registers to receive inputs. */
export interface NovaSimulationHandlers {
  /** Called for every inbound player input (with the sending player). */
  onInput?: (input: NovaSimulationInput & { readonly sender: NovaPlayer }) => void;
  /** Called when an authoritative simulation snapshot arrives (A1). */
  onSnapshot?: (snapshot: unknown) => void;
}

/** The `nova.state` handle: read and subscribe to canonical state. */
export interface NovaStateHandle {
  /** Current canonical state, or null before any state has been received. */
  get(): unknown | null;
  /** Subscribe to state changes. Returns an unsubscribe function. */
  onChange(handler: (state: unknown) => void): () => void;
}

/** The `nova.raw` handle: raw-mode channels (ADR-0006 raw mode). */
export interface NovaRawHandle {
  /**
   * Declare a raw channel and its delivery guarantees. Call once per
   * channel after the game starts; peers learn the channel from the
   * declaration. To receive, also subscribe with {@link onMessage}.
   */
  createChannel(spec: NovaRawChannelSpec): void;
  /**
   * Send a payload on a channel created with {@link createChannel}.
   * Broadcasts to every connected player unless `options.to` is set.
   * Payloads may be JSON data or binary (`Uint8Array`/`ArrayBuffer`).
   */
  send(name: string, payload: unknown, options?: NovaRawSendOptions): void;
  /**
   * Subscribe to messages on a raw channel. Messages on channels without a
   * subscription are dropped. Returns an unsubscribe function.
   */
  onMessage(name: string, handler: (message: NovaRawMessage) => void): () => void;
}

/** The `nova.simulation` handle (ADR-0006 simulation mode). */
export interface NovaSimulationHandle {
  /**
   * Register the game's simulation input handlers. Returns an unsubscribe
   * function. Call during setup, before the game starts.
   */
  register(handlers: NovaSimulationHandlers): () => void;
  /** Send one player input to the party. Only available after start. */
  sendInput(input: NovaSimulationInput): void;
}

/**
 * The complete game-facing API object (`window.nova`).
 *
 * Lifecycle: call {@link defineGame} once at startup, subscribe to events,
 * call {@link ready} once the game finished loading, then react to
 * {@link onStart} / {@link onEnd}. Calls that require a later lifecycle
 * stage fail with a {@link NovaError} (S1 acceptance: API calls fail
 * clearly before readiness).
 */
export interface NovaApi {
  /** The Nova API version this build speaks. */
  readonly version: number;
  /** Register the game and declare its mode. Call exactly once, first. */
  defineGame(options: NovaGameDeclaration): void;
  /**
   * Announce that this game finished loading and is ready to play.
   * Available once `nova.defineGame` has been called.
   */
  ready(): void;
  /**
   * Send a log entry to the Nova host. In the browser this is captured by
   * the runtime (rate-limited) exactly like `console.log`; in the arena it
   * writes to the console.
   */
  log(...args: unknown[]): void;
  /** This player's identity, or null before the host provides one. */
  readonly player: NovaPlayer | null;
  /** Every player in the game, including this player, in join order. */
  readonly players: readonly NovaPlayer[];
  /** This player's connection status. Updated as the party connects. */
  connectionStatus: NovaConnectionStatus;
  /** Subscribe to player joins. Returns an unsubscribe function. */
  onPlayerJoin(handler: (player: NovaPlayer) => void): () => void;
  /** Subscribe to player leaves. Returns an unsubscribe function. */
  onPlayerLeave(handler: (player: NovaPlayer) => void): () => void;
  /** Subscribe to connection status changes. Returns an unsubscribe function. */
  onConnectionChange(handler: (status: NovaConnectionStatus) => void): () => void;
  /** Subscribe to game start. Returns an unsubscribe function. */
  onStart(handler: () => void): () => void;
  /** Subscribe to game end. Returns an unsubscribe function. */
  onEnd(handler: (reason: GameEndReason) => void): () => void;
  /** Subscribe to API errors. Returns an unsubscribe function. */
  onError(handler: (error: NovaError) => void): () => void;
  /**
   * Dispatch one action (state mode). Resolves once Nova accepted the
   * action for delivery; apply/reject semantics arrive with S2. Only
   * available after the game starts.
   */
  dispatch(action: NovaAction): Promise<void>;
  /** Read and subscribe to canonical state (state mode). */
  readonly state: NovaStateHandle;
  /** Raw-mode channels (raw mode). */
  readonly raw: NovaRawHandle;
  /** Simulation inputs (simulation mode). */
  readonly simulation: NovaSimulationHandle;
}
