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
import { actionTimeoutMs, type GameEndReason, type GameMode } from "@rocketcrab/protocol";
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
 * The context Nova passes to state-mode handler functions
 * (createInitialState / actions / selectView). Plain data only: handler
 * functions never cross a frame boundary, so the context is what the game
 * sees in place of networking or authority concepts.
 */
export interface NovaGameContext {
  /** This game frame's player. */
  readonly self: NovaPlayer;
  /** Every connected player, self first, then peers in join order. */
  readonly players: readonly NovaPlayer[];
  /** The canonical state revision the handler runs against. */
  readonly revision: number;
  /** Epoch-ms timestamp of the handler invocation. */
  readonly now: number;
  /** The player who dispatched the action (actions only). */
  readonly actor?: NovaPlayer;
}

/**
 * One state-mode action handler (ADR-0006): validate and mutate the Immer
 * draft. May also return a new state to replace the draft (Immer recipe
 * semantics). Handlers may be synchronous or async; Nova applies them on the
 * current authority's runtime and Nova owns ordering, deduplication, and
 * rejection.
 *
 * The `draft` parameter is deliberately `any`: the draft's shape is the
 * game's own canonical state, which Nova cannot know — games write
 * `actions: { playCard(draft, context, payload) { draft.cards++ } }` with
 * no annotations. This is a documented game-facing contract type, not a
 * protocol boundary (values crossing boundaries stay `unknown`-validated).
 */
export type NovaStateActionHandler = (
  draft: any,
  context: NovaGameContext,
  payload: any,
) => void | unknown;

/** The action table a state-mode game registers (keyed by action type). */
export interface NovaStateActions {
  readonly [type: string]: NovaStateActionHandler;
}

/**
 * State-mode handler functions (ADR-0006). These are the only functions in
 * the game contract; they stay inside the game's own context (the frame or
 * the in-process client) and are never serialized across a boundary.
 */
export interface NovaStateHandlers {
  /**
   * Build the initial canonical state. Defaults to `{}` when omitted.
   * Receives the same context shape as action handlers.
   */
  createInitialState?(context: NovaGameContext): unknown;
  /**
   * The action table: `actions[name](draft, context, payload)` runs through
   * Immer on the current canonical state. Unknown names are rejected with
   * `unknown_action`.
   */
  actions?: NovaStateActions;
  /**
   * Select the view one player sees. Defaults to the full state when
   * omitted. Runs on the authority; every frame receives only its selected
   * view (ADR-0006).
   */
  selectView?(state: unknown, viewer: NovaPlayer): unknown;
  /**
   * Optional render hook: Nova calls `render(view)` after every state
   * change (subscription-based rendering via `nova.state.onChange` is
   * preferred; render is a convenience, never a rendering framework).
   */
  render?(view: unknown): void;
}

/**
 * Registration options for `nova.defineGame`. Everything here is plain data
 * (it crosses the runtime frame boundary) except the optional state-mode
 * handler functions, which Nova keeps in the game's own context.
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
  /** State mode: build the initial canonical state (defaults to `{}`). */
  createInitialState?(context: NovaGameContext): unknown;
  /** State mode: the action table (Immer recipes). */
  actions?: NovaStateActions;
  /** State mode: select the view one player sees (defaults to full state). */
  selectView?(state: unknown, viewer: NovaPlayer): unknown;
  /** State mode: optional render hook, called with the latest view. */
  render?(view: unknown): void;
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
   * The state revision this action was based on. Omit it and Nova sends
   * the latest revision your frame has seen; a stale base revision is
   * rejected with `stale_revision` (S2).
   */
  readonly baseRevision?: number;
}

/** The result of one dispatched action (S2 action protocol). */
export type NovaActionStatus = "accepted" | "rejected" | "superseded";

/**
 * The authority's decision for one action. `nova.dispatch` resolves when
 * the action is accepted and rejects with a {@link NovaError} whose `code`
 * is `ack.errorCode` when it is rejected or superseded.
 */
export interface NovaActionAck {
  /** The action this ack answers. */
  readonly actionId: string;
  readonly status: NovaActionStatus;
  /** New state revision when the action was accepted. */
  readonly revision?: number;
  /** Stable machine-readable rejection code (rejected/superseded only). */
  readonly errorCode?: string;
  /** Human-readable rejection detail (rejected/superseded only). */
  readonly errorMessage?: string;
}

/**
 * State-size and action-rate diagnostics (S2 acceptance: diagnostics are
 * visible to the host and the arena). Values reflect the last committed
 * canonical state.
 */
export interface NovaStateDiagnostics {
  /** Current canonical revision (0 before the first snapshot). */
  readonly revision: number;
  /** Serialized canonical state size in bytes (0 before any state). */
  readonly stateSizeBytes: number;
  /** SHA-256 of the canonical state, or null before any state. */
  readonly stateHash: string | null;
  /** The current authority's member id, or null when none is known. */
  readonly authorityMemberId: string | null;
  /** Actions applied so far (committed). */
  readonly appliedCount: number;
  /** Actions rejected/superseded so far. */
  readonly rejectedCount: number;
  /** Actions currently queued for sequential application. */
  readonly pendingActionCount: number;
  /** Processed action ids retained in the bounded history. */
  readonly processedActionCount: number;
  /** Actions processed per second over the last 10-second window. */
  readonly actionRatePerSecond: number;
  /** Epoch ms of the last commit, or null before any commit. */
  readonly lastCommitAt: number | null;
}

/** How long the authority has to apply an action before it times out. */
export const NOVA_ACTION_TIMEOUT_MS = actionTimeoutMs;

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
  /**
   * Optional sender-side transfer progress for payloads moved in chunks
   * (payloads above ~64 KiB travel as chunked transfers). Called with the
   * fraction of the payload the transport has handed off so far. Plain
   * function: stays in the game's own context, never crosses a boundary.
   */
  readonly onProgress?: (progress: NovaRawProgress) => void;
}

/** One raw transfer-progress observation (A2 transfer observability). */
export interface NovaRawProgress {
  /** Epoch-ms timestamp of the observation. */
  readonly at: number;
  /** Bytes of the payload handed off so far. */
  readonly bytesTransferred: number;
  /** Total payload size in bytes. */
  readonly totalBytes: number;
  /** Fraction of the payload transferred, in [0, 1]. */
  readonly fraction: number;
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
   * declaration (peers joining later receive open channels again). To
   * receive, also subscribe with {@link onMessage}.
   */
  createChannel(spec: NovaRawChannelSpec): void;
  /**
   * Close a raw channel declared with {@link createChannel}. The channel
   * stops accepting local sends (`unknown_channel` afterwards) and peers
   * are told the channel closed; a peer that declared the channel itself
   * keeps its own declaration. The name may be re-opened with a fresh
   * {@link createChannel}. Idempotent: closing an unknown channel is a
   * no-op.
   */
  close(name: string): void;
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

/**
 * Raw-mode traffic diagnostics (A2; host/arena visible). Counters reflect
 * this session's raw-channel activity since the last reset; the rate is a
 * sliding 10-second window like state-mode action rates.
 */
export interface NovaRawDiagnostics {
  /** Channels currently open on this session (self + peer declarations). */
  readonly channelCount: number;
  /** Channels this session declared itself. */
  readonly selfDeclaredChannelCount: number;
  /** Raw messages sent by this session. */
  readonly sentCount: number;
  /** Raw messages received by this session. */
  readonly receivedCount: number;
  /** Bytes sent (payload size; chunked transfers count once). */
  readonly sentBytes: number;
  /** Bytes received (payload size; chunked transfers count once). */
  readonly receivedBytes: number;
  /** Sends rejected because the payload exceeded `rawMessageBytes`. */
  readonly oversizedRejections: number;
  /** Sends rejected because the rate exceeded `rawRatePerSecond`. */
  readonly rateLimitRejections: number;
  /** Raw messages sent per second over the last 10-second window. */
  readonly ratePerSecond: number;
  /** True when the warn thresholds were crossed on any recent send. */
  readonly warned: boolean;
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
   * Dispatch one action (state mode). Resolves once the authority applied
   * the action (committed a new revision); rejects with a {@link NovaError}
   * when the authority rejected it (`errorCode` carries the stable code,
   * e.g. `stale_revision`, `timed_out`, `unknown_action`) or when no ack
   * arrives in time. Only available after the game starts.
   */
  dispatch(action: NovaAction): Promise<void>;
  /** Read and subscribe to canonical state (state mode). */
  readonly state: NovaStateHandle;
  /** Raw-mode channels (raw mode). */
  readonly raw: NovaRawHandle;
  /** Simulation inputs (simulation mode). */
  readonly simulation: NovaSimulationHandle;
}
