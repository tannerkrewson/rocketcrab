// P1 real-browser integration harness for TrysteroTransport.
//
// Serves the adapter behind a small `window.__harness` (same pattern as the
// F5 spike) so Playwright can simulate multiple peers on one machine. Uses
// ONLY the adapter's public surface — never raw Trystero — so this is a true
// end-to-end test of the P1 adapter over real Nostr relays + WebRTC.
import { TrysteroTransport } from "@rocketcrab/trystero-transport";
import type { TrysteroTransportDiagnostics } from "@rocketcrab/trystero-transport";
import { GameSourceCoordinator } from "@rocketcrab/party";

interface HarnessState {
  ready: boolean;
  appId: string;
  selfMemberId: string;
  selfConnectionId: string | null;
  connectionState: string;
  room: string | null;
  peers: Array<{ memberId: string; connectionId: string; displayName?: string }>;
  relays: Array<{ url: string; readyState: number; connected: boolean }> | null;
  messages: Array<{
    channel: string;
    senderMemberId: string;
    kind: string;
    size: number;
  }>;
  progress: Array<{ dir: string; fraction: number; channel: string }>;
  pings: number[];
  errors: string[];
  /** P3 game-source transfer state (host announcement / joiner receipt). */
  source: {
    gameId: string | null;
    sourceSha256: string | null;
    sourceSizeBytes: number | null;
    received: boolean;
    receivedLength: number | null;
    events: string[];
  };
}

interface JoinOptions {
  room: string;
  appId?: string;
  relays?: string[];
  relayConnectTimeoutMs?: number;
  joinTimeoutMs?: number;
}

const SESSION_PREFIX = "e2e-session-";

function randomRoom(): string {
  return `p1-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
}

function payloadKind(payload: unknown): string {
  if (payload instanceof Uint8Array) {
    return "Uint8Array";
  }
  if (payload instanceof ArrayBuffer) {
    return "ArrayBuffer";
  }
  if (typeof payload === "string") {
    return "string";
  }
  return "json";
}

function payloadSize(payload: unknown): number {
  if (payload instanceof Uint8Array) {
    return payload.byteLength;
  }
  if (payload instanceof ArrayBuffer) {
    return payload.byteLength;
  }
  if (typeof payload === "string") {
    return new TextEncoder().encode(payload).byteLength;
  }
  return new TextEncoder().encode(JSON.stringify(payload) ?? "").byteLength;
}

const state: HarnessState = {
  ready: false,
  appId: "rocketcrab-nova-dev",
  selfMemberId: `member-${Math.random().toString(36).slice(2, 10)}`,
  selfConnectionId: null,
  connectionState: "idle",
  room: null,
  peers: [],
  relays: null,
  messages: [],
  progress: [],
  pings: [],
  errors: [],
  source: {
    gameId: null,
    sourceSha256: null,
    sourceSizeBytes: null,
    received: false,
    receivedLength: null,
    events: [],
  },
};

let transport: TrysteroTransport | null = null;
let sourceCoordinator: GameSourceCoordinator | null = null;

/** Resolve the join: "joined" or an error category string. */
async function enterRoom(options: JoinOptions): Promise<string> {
  const sessionId = `${SESSION_PREFIX}${options.room}`;
  const next = new TrysteroTransport({
    memberId: state.selfMemberId,
    displayName: `player-${state.selfMemberId.slice(-4)}`,
    appId: options.appId,
    relays: options.relays,
    relayConnectTimeoutMs: options.relayConnectTimeoutMs ?? 10_000,
    joinTimeoutMs: options.joinTimeoutMs ?? 45_000,
    onJoinError: (error) => {
      state.errors.push(`${error.category}: ${error.message}`);
    },
  });
  next.on("connection:state", (s) => {
    state.connectionState = s;
  });
  next.on("peer:joined", (peer) => {
    state.peers.push({
      memberId: peer.memberId,
      connectionId: peer.connectionId,
      displayName: peer.displayName,
    });
  });
  next.on("peer:left", (peer) => {
    state.peers = state.peers.filter((p) => p.connectionId !== peer.connectionId);
  });
  next.on("message:received", (message) => {
    state.messages.push({
      channel: message.channel,
      senderMemberId: message.senderMemberId,
      kind: message.binary ? "binary" : payloadKind(message.payload),
      size: payloadSize(message.payload),
    });
  });
  next.on("transfer:progress", (progress) => {
    state.progress.push({
      dir: progress.direction,
      fraction: progress.fraction,
      channel: progress.channel,
    });
  });
  try {
    await next.join({ room: options.room, sessionId });
  } catch (error) {
    const category =
      error instanceof Error && "category" in error
        ? String((error as { category: unknown }).category)
        : "error";
    state.errors.push(`${category}: ${error instanceof Error ? error.message : String(error)}`);
    state.connectionState = "idle";
    return category;
  }
  transport = next;
  state.selfConnectionId = next.selfConnectionId;
  state.appId = next.appId;
  state.room = options.room;
  state.relays = snapshotRelays(next);
  return "joined";
}

function snapshotRelays(current: TrysteroTransport): HarnessState["relays"] {
  const diagnostics = current.getRelayDiagnostics();
  if (diagnostics === null) {
    return null;
  }
  return diagnostics.relays.map((relay) => ({
    url: relay.url,
    readyState: relay.readyState,
    connected: relay.connected,
  }));
}

async function leaveRoom(): Promise<void> {
  sourceCoordinator?.dispose();
  sourceCoordinator = null;
  state.source = {
    gameId: null,
    sourceSha256: null,
    sourceSizeBytes: null,
    received: false,
    receivedLength: null,
    events: [],
  };
  if (transport !== null) {
    await transport.leave();
    transport = null;
  }
  state.selfConnectionId = null;
  state.room = null;
  state.peers = [];
  state.relays = null;
  state.messages = [];
  state.progress = [];
}

function requireTransport(): TrysteroTransport {
  if (transport === null) {
    throw new Error("not joined");
  }
  return transport;
}

async function sendStruct(): Promise<void> {
  const current = requireTransport();
  const payload = {
    type: "action.dispatch",
    seq: state.messages.length + 1,
    player: state.selfMemberId,
    payload: { score: 42, tags: ["a", "b"], nested: { ok: true } },
  };
  await current.send({ channel: "raw", payload, seq: state.messages.length + 1, version: 1 });
}

async function sendBinary(bytes: Uint8Array): Promise<void> {
  await requireTransport().send({ channel: "raw", payload: bytes, binary: true });
}

async function sendLarge(size: number): Promise<void> {
  const current = requireTransport();
  const payload = "x".repeat(size);
  await current.send({
    channel: "large",
    payload,
    onProgress: (progress) => {
      state.progress.push({ dir: "send", fraction: progress.fraction, channel: "large" });
    },
  });
}

async function pingFirst(): Promise<number | null> {
  const current = requireTransport();
  const peer = current.peers[0];
  if (peer === undefined) {
    return null;
  }
  const ms = await current.ping(peer.connectionId);
  if (ms !== null) {
    state.pings.push(ms);
  }
  return ms;
}

// ---------------------------------------------------------------------------
// P3: peer-to-peer game source transfer over the established party transport
// ---------------------------------------------------------------------------

/** Host role: register the game source and announce it to the party. */
async function sourceHostStart(gameId: string, source: string): Promise<void> {
  const current = requireTransport();
  sourceCoordinator?.dispose();
  sourceCoordinator = new GameSourceCoordinator({
    transport: current,
    onEvent: (event) => {
      state.source.events.push(event.type);
    },
  });
  const metadata = await sourceCoordinator.setSource({ gameId, title: "E2E Game", source });
  state.source.gameId = metadata.gameId;
  state.source.sourceSha256 = metadata.sourceSha256;
  state.source.sourceSizeBytes = metadata.sourceSizeBytes;
}

/** Joiner role: attach the coordinator and wait for the verified source. */
async function sourceJoinerStart(): Promise<void> {
  const current = requireTransport();
  sourceCoordinator?.dispose();
  sourceCoordinator = new GameSourceCoordinator({
    transport: current,
    onEvent: (event) => {
      state.source.events.push(event.type);
      if (event.type === "received") {
        state.source.gameId = event.gameId;
        state.source.sourceSha256 = event.sourceSha256;
        state.source.received = true;
        state.source.receivedLength = event.source.length;
        state.source.sourceSizeBytes = new TextEncoder().encode(event.source).byteLength;
      }
    },
  });
  // The coordinator may have missed the host's announcement; ask for it.
  await sourceCoordinator.refresh();
}

function getSourceState(): HarnessState["source"] {
  return state.source;
}

function getDiagnostics(): TrysteroTransportDiagnostics | null {
  return transport?.getDiagnostics() ?? null;
}

declare global {
  interface Window {
    __harness: {
      ready: boolean;
      createRoom: (options: JoinOptions) => Promise<string>;
      joinRoomByCode: (options: JoinOptions) => Promise<string>;
      leave: () => Promise<void>;
      sendStruct: () => Promise<void>;
      sendBinary: (bytes: Uint8Array) => Promise<void>;
      sendLarge: (size?: number) => Promise<void>;
      ping: () => Promise<number | null>;
      getState: () => HarnessState;
      getDiagnostics: () => TrysteroTransportDiagnostics | null;
      sourceHostStart: (gameId: string, source: string) => Promise<void>;
      sourceJoinerStart: () => Promise<void>;
      getSourceState: () => HarnessState["source"];
      randomRoom: () => string;
    };
  }
}

window.__harness = {
  ready: true,
  createRoom: (options) => enterRoom(options),
  joinRoomByCode: (options) => enterRoom(options),
  leave: leaveRoom,
  sendStruct,
  sendBinary,
  sendLarge: (size = 256 * 1024) => sendLarge(size),
  ping: pingFirst,
  getState: () => state,
  getDiagnostics,
  sourceHostStart,
  sourceJoinerStart: () => sourceJoinerStart(),
  getSourceState,
  randomRoom,
};

state.ready = true;
