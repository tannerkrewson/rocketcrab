/**
 * The game-facing Nova API surface.
 *
 * These types are the contract AI-generated games program against. The API
 * is deliberately small: a handful of concepts (registration, players,
 * lifecycle, state, actions, ticks, controls), zero transport or
 * hosting vocabulary, and every value that crosses a boundary is plain,
 * structured-clone-compatible data.
 *
 * The concrete object games receive (`window.nova`) is built by
 * {@link createNovaClient}; the host-side engine that drives it over the
 * transport is {@link NovaSession}.
 */
import { actionTimeoutMs, type GameEndReason } from "@rocketcrab/protocol";
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

/** One player in the game. `id` is stable for the whole party. */
export interface NovaPlayer {
  /** Stable per-player id. */
  readonly id: string;
  /** Player-facing display name. */
  readonly name: string;
}

/**
 * The context Nova passes to handler functions (createInitialState /
 * actions / tick / selectView). Plain data only: handler functions never
 * cross a frame boundary, so the context is what the game sees in place of
 * networking or authority concepts. Handlers run on whichever device holds
 * the game, so the context never says which device that is.
 */
export interface NovaGameContext {
  /**
   * Every connected player, sorted by id: the same order on every device,
   * including after the game moves to another device. Store a turn order in
   * state if the game needs one.
   */
  readonly players: readonly NovaPlayer[];
  /** The canonical state revision the handler runs against. */
  readonly revision: number;
  /** Epoch-ms timestamp of the handler invocation. */
  readonly now: number;
  /** The player who dispatched the action (actions only). */
  readonly actor?: NovaPlayer;
  /**
   * The party's leader (the person who runs the party), or null when not
   * known. Not where the game runs. Check it in actions that only the leader
   * may take, such as changing the game's settings.
   */
  readonly leaderId: string | null;
}

/** What a `tick` handler receives on top of the usual context. */
export interface NovaTickContext extends NovaGameContext {
  /** Seconds one tick covers (1 / tickRate). */
  readonly dt: number;
  /**
   * Each connected player's latest `nova.controls.set` value, by player id.
   * Players who have not set controls, or who left, are absent.
   */
  readonly controls: Readonly<Record<string, unknown>>;
}

/** A tick: advance the Immer draft by one fixed step of `dt`. */
export type NovaTickHandler = (draft: any, context: NovaTickContext) => void | unknown;

/**
 * One action handler: validate and mutate the Immer
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

/** The action table a game registers (keyed by action type). */
export interface NovaStateActions {
  readonly [type: string]: NovaStateActionHandler;
}

/**
 * Handler functions. These are the only functions in
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
   * view. `context` is the one the handler that produced this
   * state received.
   */
  selectView?(state: unknown, viewer: NovaPlayer, context: NovaGameContext): unknown;
  /** Runs on the authority `tickRate` times a second once the game starts. */
  tick?: NovaTickHandler;
  /**
   * A player joined after the initial state was created (players present then
   * are in `createInitialState`'s `context.players`). Runs once, in order with
   * actions, on whichever device holds the game.
   */
  playerJoined?: NovaMembershipHandler;
  /**
   * A player has been gone for the leave grace period (a return within it
   * never reaches the game). Runs once, in order with actions.
   */
  playerLeft?: NovaMembershipHandler;
}

/** A membership handler: change the Immer draft for one player who joined or left. */
export type NovaMembershipHandler = (
  draft: any,
  context: NovaGameContext,
  player: NovaPlayer,
) => void | unknown;

/**
 * Registration options for `nova.defineGame`. Everything here is plain data
 * (it crosses the runtime frame boundary) except the optional handler
 * functions, which Nova keeps in the game's own context.
 */
export interface NovaGameDeclaration extends NovaStateHandlers {
  /** Human-readable game title shown in lobbies. */
  title?: string;
  /** The game's own version string (distinct from the Nova API version). */
  version?: string;
  /** The Nova API version this game targets; defaults to `nova.version`. */
  apiVersion?: number;
  /** Ticks per second (1..60, default 15). Only used with `tick`. */
  tickRate?: number;
  /** Fewest players the game supports; the lobby says when the party has fewer. */
  minPlayers?: number;
  /** Most players the game supports; the lobby says when the party has more. */
  maxPlayers?: number;
}

/**
 * One dispatched action. Nova owns action ordering,
 * deduplication, and application; the game only describes the
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
   * rejected with `stale_revision`.
   */
  readonly baseRevision?: number;
}

/** The result of one dispatched action. */
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
 * State-size and action-rate diagnostics (host/arena visible). Values reflect
 * the last committed canonical state and expose election state so the arena can
 * force and display migration.
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
  /** Current authority term (monotonic). */
  readonly term: number;
  /** True while this shell is campaigning (election in progress). */
  readonly electionInProgress: boolean;
  /** Epoch ms of the last heartbeat received from the current authority. */
  readonly lastHeartbeatAt: number | null;
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
  /**
   * False while this shell's processed-action window has a known gap, until a
   * complete full snapshot repairs it. Host-side only.
   */
  readonly historyComplete: boolean;
}

/** How long the authority has to apply an action before it times out. */
export const NOVA_ACTION_TIMEOUT_MS = actionTimeoutMs;

/** The `nova.state` handle: read and subscribe to canonical state. */
export interface NovaStateHandle {
  /** Current canonical state, or null before any state has been received. */
  get(): unknown | null;
  /** Subscribe to state changes. Returns an unsubscribe function. */
  onChange(handler: (state: unknown) => void): () => void;
}

/**
 * The complete game-facing API object (`window.nova`).
 *
 * Lifecycle: call {@link defineGame} once at startup, subscribe to events,
 * call {@link ready} once the game finished loading, then react to
 * {@link onStart} / {@link onEnd}. Calls that require a later lifecycle
 * stage fail with a {@link NovaError}.
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
  /** Every player in the game: this player first, then the others as they joined. */
  readonly players: readonly NovaPlayer[];
  /** This player's connection status. Updated as the party connects. */
  readonly connectionStatus: NovaConnectionStatus;
  /**
   * The party leader's player id, or null when not known. It changes only
   * when the leader leaves or returns, so read it when drawing.
   */
  readonly leaderId: string | null;
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
   * Dispatch one action. Resolves once the authority applied
   * the action (committed a new revision); rejects with a {@link NovaError}
   * when the authority rejected it (`errorCode` carries the stable code,
   * e.g. `stale_revision`, `timed_out`, `unknown_action`) or when no ack
   * arrives in time. Only available after the game starts.
   */
  dispatch(action: NovaAction): Promise<void>;
  /** Read and subscribe to canonical state. */
  readonly state: NovaStateHandle;
  /**
   * This player's controls for a ticking game: what they are doing right
   * now (buttons held, joystick, pointer). The authority's `tick` reads them
   * as `context.controls[playerId]`. Plain JSON, at most 1 KiB.
   */
  readonly controls: NovaControlsHandle;
  /** Store and read immutable shared files by their content-addressed refs. */
  readonly files: NovaFilesHandle;
}

export interface NovaFilesHandle {
  put(blob: Blob): Promise<string>;
  get(ref: string): Promise<Blob>;
  /** The caller revokes the object URL when it no longer needs it. */
  url(ref: string): Promise<string>;
}

/** The `nova.controls` handle. */
export interface NovaControlsHandle {
  /** Replace this player's controls. Cheap to call often: Nova sends changes only. */
  set(value: unknown): void;
}
