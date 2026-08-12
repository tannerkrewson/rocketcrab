/**
 * The game-facing Nova API client (S1).
 *
 * `createNovaClient(backend)` builds the exact object games receive as
 * `window.nova` (the in-frame bridge and the arena construct the same client
 * over different backends, so game code behaves identically in both). The
 * client is a thin, lifecycle-enforced projection over a
 * {@link NovaClientBackend}:
 *
 * - it enforces the lifecycle (registration → ready → start → end) and makes
 *   every call that requires a later stage fail with a clear
 *   {@link NovaError} (S1 acceptance: API calls fail clearly before
 *   readiness; unknown methods or versions fail safely);
 * - it validates every input against the same bounded schemas used at the
 *   protocol boundary (no `any`, never trust game input);
 * - inbound events arrive as plain data ({@link NovaSessionEvent}) and are
 *   dispatched to the game's handlers inside this context — functions
 *   registered by a game never cross the frame, only data does.
 */
import { isSupportedApiVersion } from "./version";
import { NovaError, endedMessage, notStartedMessage } from "./errors";
import { isReservedChannelName } from "./constants";
import {
  assertStructuredCloneSafe,
  assertValid,
  isBinaryPayload,
  novaActionSchema,
  novaChannelNameSchema,
  novaGameDeclarationSchema,
  novaRawChannelSpecSchema,
  novaSimulationInputSchema,
} from "./validation";
import type {
  NovaAction,
  NovaApi,
  NovaConnectionStatus,
  NovaGameDeclaration,
  NovaPlayer,
  NovaRawChannelSpec,
  NovaRawHandle,
  NovaRawMessage,
  NovaRawSendOptions,
  NovaSimulationHandle,
  NovaSimulationHandlers,
  NovaSimulationInput,
  NovaStateHandle,
} from "./types";

/**
 * Every event a session backend can push to a client. Only the client-event
 * kinds below are forwarded to game handlers; host-side events such as
 * `actionReceived` (the S2 authority seam) are ignored by the client.
 */
export type NovaSessionEvent =
  | { type: "playerJoined"; player: NovaPlayer }
  | { type: "playerLeft"; player: NovaPlayer }
  | { type: "connection"; status: NovaConnectionStatus }
  | { type: "start" }
  | { type: "end"; reason: string }
  | { type: "state"; state: unknown }
  | { type: "rawMessage"; channel: string; message: NovaRawMessage }
  | { type: "simulationInput"; input: NovaSimulationInput & { sender: NovaPlayer } }
  | { type: "simulationSnapshot"; snapshot: unknown }
  | { type: "error"; error: NovaError }
  | { type: "actionReceived"; action: NovaAction };

/**
 * The backend a client is projected over: the in-process session engine or
 * the in-frame bridge. The interface is data-only — functions registered by
 * a game stay in the client, never crossing the frame (S1 design goal).
 */
export interface NovaClientBackend {
  /** API version this backend speaks (matches `nova.version`). */
  readonly apiVersion: number;
  /** This player's identity, or null before the host provides one. */
  readonly self: NovaPlayer | null;
  /** Accept the game registration. */
  register(declaration: NovaGameDeclaration): void;
  /** Announce the game is ready to play. */
  ready(): void;
  /** Dispatch one action (state mode); resolves once Nova accepted it. */
  dispatch(action: NovaAction): Promise<void>;
  /** Declare a raw channel to the party. */
  createRawChannel(spec: NovaRawChannelSpec): void;
  /** Send a payload on a raw channel. */
  sendRaw(name: string, payload: unknown, options: NovaRawSendOptions): void;
  /** Signal that the game registered simulation handlers. */
  registerSimulation(): void;
  /** Send one simulation input to the party. */
  sendSimulationInput(input: NovaSimulationInput): void;
  /** Subscribe to inbound events. Returns an unsubscribe function. */
  onEvent(handler: (event: NovaSessionEvent) => void): () => void;
}

/** The client object games receive, plus the host-side `dispose`. */
export interface NovaClient extends NovaApi {
  /** Detach from the backend and clear all handlers (host/arena use). */
  dispose(): void;
}

type Handler<T> = (value: T) => void;

function addHandler<T>(set: Set<Handler<T>>, handler: Handler<T>): () => void {
  set.add(handler);
  return () => {
    set.delete(handler);
  };
}

/** Build the game-facing API object over a backend (see module docs). */
export function createNovaClient(backend: NovaClientBackend): NovaClient {
  let registered = false;
  let readySent = false;
  let started = false;
  let ended = false;
  let stateValue: unknown | null = null;

  const players: NovaPlayer[] = backend.self === null ? [] : [backend.self];
  const joinHandlers = new Set<Handler<NovaPlayer>>();
  const leaveHandlers = new Set<Handler<NovaPlayer>>();
  const connectionHandlers = new Set<Handler<NovaConnectionStatus>>();
  const startHandlers = new Set<Handler<void>>();
  const endHandlers = new Set<Handler<string>>();
  const errorHandlers = new Set<Handler<NovaError>>();
  const stateHandlers = new Set<Handler<unknown>>();
  const rawHandlers = new Map<string, Set<Handler<NovaRawMessage>>>();
  let simulationHandlers: NovaSimulationHandlers | null = null;

  const unsubscribeEvents = backend.onEvent((event) => {
    switch (event.type) {
      case "playerJoined":
        if (!players.some((player) => player.id === event.player.id)) {
          players.push(event.player);
        }
        for (const handler of joinHandlers) {
          handler(event.player);
        }
        break;
      case "playerLeft": {
        const index = players.findIndex((player) => player.id === event.player.id);
        if (index >= 0) {
          players.splice(index, 1);
        }
        for (const handler of leaveHandlers) {
          handler(event.player);
        }
        break;
      }
      case "connection":
        client.connectionStatus = event.status;
        for (const handler of connectionHandlers) {
          handler(event.status);
        }
        break;
      case "start":
        started = true;
        for (const handler of startHandlers) {
          handler();
        }
        break;
      case "end":
        ended = true;
        for (const handler of endHandlers) {
          handler(event.reason);
        }
        break;
      case "state":
        stateValue = event.state;
        for (const handler of stateHandlers) {
          handler(event.state);
        }
        break;
      case "rawMessage": {
        const handlers = rawHandlers.get(event.channel);
        if (handlers === undefined) {
          break; // no subscription: drop (documented raw-channel rule)
        }
        for (const handler of handlers) {
          handler(event.message);
        }
        break;
      }
      case "simulationInput":
        simulationHandlers?.onInput?.(event.input);
        break;
      case "simulationSnapshot":
        simulationHandlers?.onSnapshot?.(event.snapshot);
        break;
      case "error":
        for (const handler of errorHandlers) {
          handler(event.error);
        }
        break;
      case "actionReceived":
        break; // host-side seam for S2; games never see raw actions
    }
  });

  const stateHandle: NovaStateHandle = {
    get() {
      return stateValue;
    },
    onChange(handler) {
      return addHandler(stateHandlers, handler);
    },
  };

  const rawHandle: NovaRawHandle = {
    createChannel(spec) {
      if (ended) throw new NovaError("ended", endedMessage("raw.createChannel"));
      if (!started) throw new NovaError("not_started", notStartedMessage("raw.createChannel"));
      const parsed = novaRawChannelSpecSchema.safeParse(spec);
      assertValid(parsed.success, "nova.raw.createChannel options failed validation.");
      if (isReservedChannelName(spec.name)) {
        throw new NovaError(
          "reserved_channel",
          `Raw channel name "${spec.name}" is reserved by the Nova protocol.`,
        );
      }
      backend.createRawChannel(spec);
    },
    send(name, payload, options = {}) {
      if (ended) throw new NovaError("ended", endedMessage("raw.send"));
      if (!started) throw new NovaError("not_started", notStartedMessage("raw.send"));
      assertValid(
        novaChannelNameSchema.safeParse(name).success,
        "nova.raw.send: bad channel name.",
      );
      if (!isBinaryPayload(payload)) {
        assertStructuredCloneSafe(payload, `nova.raw.send payload on channel "${name}"`);
      }
      backend.sendRaw(name, payload, options);
    },
    onMessage(name, handler) {
      assertValid(
        novaChannelNameSchema.safeParse(name).success,
        "nova.raw.onMessage: bad channel name.",
      );
      let handlers = rawHandlers.get(name);
      if (handlers === undefined) {
        handlers = new Set();
        rawHandlers.set(name, handlers);
      }
      return addHandler(handlers, handler);
    },
  };

  const simulationHandle: NovaSimulationHandle = {
    register(handlers) {
      const onInput = handlers.onInput;
      const onSnapshot = handlers.onSnapshot;
      if (
        (onInput !== undefined && typeof onInput !== "function") ||
        (onSnapshot !== undefined && typeof onSnapshot !== "function")
      ) {
        throw new NovaError(
          "invalid_options",
          "nova.simulation.register expects onInput/onSnapshot functions.",
        );
      }
      simulationHandlers = handlers;
      backend.registerSimulation();
      return () => {
        if (simulationHandlers === handlers) {
          simulationHandlers = null;
        }
      };
    },
    sendInput(input) {
      if (ended) throw new NovaError("ended", endedMessage("simulation.sendInput"));
      if (!started) throw new NovaError("not_started", notStartedMessage("simulation.sendInput"));
      assertValid(
        novaSimulationInputSchema.safeParse(input).success,
        "nova.simulation.sendInput options failed validation.",
      );
      assertStructuredCloneSafe(input.payload, "nova.simulation.sendInput payload");
      backend.sendSimulationInput(input);
    },
  };

  const client: NovaClient = {
    version: backend.apiVersion,
    defineGame(options) {
      if (registered) {
        throw new NovaError(
          "already_registered",
          "nova.defineGame() was already called; call it exactly once.",
        );
      }
      const parsed = novaGameDeclarationSchema.safeParse(options);
      assertValid(parsed.success, "nova.defineGame options failed validation.");
      if (options.apiVersion !== undefined && !isSupportedApiVersion(options.apiVersion)) {
        throw new NovaError(
          "unsupported_api_version",
          `nova.defineGame() targets API version ${String(options.apiVersion)}, but this build supports version(s) [1].`,
        );
      }
      registered = true;
      backend.register(options);
    },
    ready() {
      if (!registered) {
        throw new NovaError(
          "not_registered",
          "nova.ready() must be called after nova.defineGame().",
        );
      }
      if (ended) {
        throw new NovaError("ended", endedMessage("ready"));
      }
      if (started) {
        throw new NovaError(
          "already_started",
          "nova.ready() is not available after the game starts.",
        );
      }
      if (readySent) {
        throw new NovaError("already_ready", "nova.ready() was already called.");
      }
      readySent = true;
      backend.ready();
    },
    log(...args) {
      console.log(...args);
    },
    get player() {
      return backend.self;
    },
    get players() {
      return [...players];
    },
    connectionStatus: "disconnected",
    onPlayerJoin(handler) {
      return addHandler(joinHandlers, handler);
    },
    onPlayerLeave(handler) {
      return addHandler(leaveHandlers, handler);
    },
    onConnectionChange(handler) {
      return addHandler(connectionHandlers, handler);
    },
    onStart(handler) {
      return addHandler(startHandlers, handler);
    },
    onEnd(handler) {
      return addHandler(endHandlers, handler);
    },
    onError(handler) {
      return addHandler(errorHandlers, handler);
    },
    dispatch(action) {
      if (ended) throw new NovaError("ended", endedMessage("dispatch"));
      if (!started) throw new NovaError("not_started", notStartedMessage("dispatch"));
      assertValid(
        novaActionSchema.safeParse(action).success,
        "nova.dispatch options failed validation.",
      );
      assertStructuredCloneSafe(action.payload, "nova.dispatch action payload");
      return backend.dispatch(action);
    },
    get state() {
      return stateHandle;
    },
    get raw() {
      return rawHandle;
    },
    get simulation() {
      return simulationHandle;
    },
    dispose() {
      unsubscribeEvents();
      joinHandlers.clear();
      leaveHandlers.clear();
      connectionHandlers.clear();
      startHandlers.clear();
      endHandlers.clear();
      errorHandlers.clear();
      stateHandlers.clear();
      rawHandlers.clear();
      simulationHandlers = null;
    },
  };

  return client;
}
