// F5 spike driver: wraps Trystero (Nostr strategy) behind a small window API
// so a Playwright spec can simulate multiple peers, and a human can drive it
// from the page UI for cross-device tests.
//
// Deliberately uses only Trystero's built-in surfaces: join errors
// (onJoinError), peer admission (onPeerHandshake), relay socket state
// (getRelaySockets), latency (room.ping), and transfer progress handlers.
import { defaultRelayUrls, getRelaySockets, joinRoom, selfId } from "trystero";

type LogLevel = "info" | "warn" | "error";

interface LogEntry {
  at: number;
  level: LogLevel;
  msg: string;
}

interface MessageRecord {
  ns: string;
  peerId: string;
  kind: string;
  size: number;
  at: number;
}

interface ProgressRecord {
  ns: string;
  dir: "send" | "recv";
  percent: number;
  at: number;
}

interface ErrorRecord {
  error: string;
  at: number;
}

interface HarnessState {
  ready: boolean;
  appId: string;
  selfId: string | null;
  room: string | null;
  peers: string[];
  log: LogEntry[];
  messages: MessageRecord[];
  progress: ProgressRecord[];
  errors: ErrorRecord[];
  relays: Array<{ url: string; readyState: number }>;
  timings: Record<string, number | undefined>;
  largeReceived: Array<{ size: number; durationMs: number; hash: number }>;
  pingResults: Array<{ peerId: string; ms: number }>;
  lastStruct: unknown;
  connectionStates: Record<string, string>;
}

interface AdmissionPolicy {
  mode: "all" | "none" | "allow-list";
  allowIds: string[];
}

interface RoomOptions {
  room: string;
  password?: string;
  relays?: string[];
  redundancy?: number;
  admission?: AdmissionPolicy;
  handshakeTimeoutMs?: number;
}

const APP_ID = "rocketcrab-f5-spike";
const LARGE_SIZE = 5 * 1024 * 1024; // 5 MiB default

// FNV-1a 32-bit over a string, deterministic for integrity comparison.
function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function bytesToHash(bytes: Uint8Array): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i += 1) {
    hash ^= bytes[i]!;
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

const state: HarnessState = {
  ready: false,
  appId: APP_ID,
  selfId: null,
  room: null,
  peers: [],
  log: [],
  messages: [],
  progress: [],
  errors: [],
  relays: [],
  timings: {},
  largeReceived: [],
  pingResults: [],
  lastStruct: null,
  connectionStates: {},
};

let room: ReturnType<typeof joinRoom> | null = null;
let admissionPolicy: AdmissionPolicy = { mode: "all", allowIds: [] };
let actionSenders: Record<string, (data: unknown, options?: unknown) => Promise<void>> = {};

function log(level: LogLevel, msg: string): void {
  state.log.push({ at: Date.now(), level, msg });
  const line = `[${new Date().toISOString().slice(11, 23)}] ${msg}`;
  const el = document.querySelector<HTMLDivElement>("#log");
  if (el) {
    el.textContent = `${el.textContent}\n${line}`.trim();
    el.scrollTop = el.scrollHeight;
  }
}

function snapshotRelays(): void {
  const sockets = getRelaySockets() as Record<string, WebSocket>;
  state.relays = Object.entries(sockets).map(([url, socket]) => ({
    url,
    readyState: socket.readyState,
  }));
}

function snapshotConnections(): void {
  if (!room) {
    state.connectionStates = {};
    return;
  }
  state.connectionStates = Object.fromEntries(
    Object.entries(room.getPeers()).map(([id, pc]) => [id, pc.connectionState]),
  );
}

function renderStatus(): void {
  const el = document.querySelector<HTMLDivElement>("#status");
  const peersEl = document.querySelector<HTMLDivElement>("#peers");
  if (!el || !peersEl) return;
  el.innerHTML = room
    ? `In room <b>${state.room}</b> · self <b>${state.selfId}</b> · peers: <b>${state.peers.length}</b>`
    : "Not in a room.";
  peersEl.textContent = state.peers.join(", ") || "(no peers)";
}

function setButtons(joined: boolean): void {
  const map: Record<string, boolean> = {
    createBtn: !joined,
    joinBtn: !joined,
    leaveBtn: joined,
    dropRelayBtn: joined,
    sendStructBtn: joined,
    sendBinBtn: joined,
    sendLargeBtn: joined,
    pingBtn: joined && state.peers.length > 0,
  };
  for (const [id, enabled] of Object.entries(map)) {
    const el = document.querySelector<HTMLButtonElement>(`#${id}`);
    if (el) el.disabled = !enabled;
  }
}

function decideAdmission(peerId: string): boolean {
  if (admissionPolicy.mode === "all") return true;
  if (admissionPolicy.mode === "none") return false;
  return admissionPolicy.allowIds.includes(peerId);
}

// Symmetric admission handshake: both sides exchange their decision for the
// peer. If either side decides false, both sides fail fast with a structured
// error. Works regardless of which side is the handshake initiator.
function policyHandshake(
  peerId: string,
  send: (data: { decision: boolean }) => Promise<void>,
  receive: () => Promise<{ data: { decision?: boolean } }>,
): Promise<void> {
  const myDecision = decideAdmission(peerId);
  return (async () => {
    await send({ decision: myDecision });
    const { data } = await receive();
    if (!myDecision) throw new Error("admission policy rejected peer");
    if (data?.decision === false) throw new Error("peer rejected admission");
  })();
}

function wireRoomActions(nextRoom: ReturnType<typeof joinRoom>): void {
  const recordMessage = (
    ns: string,
    kind: string,
    size: number,
    context: { peerId: string },
  ): void => {
    state.messages.push({ ns, peerId: context.peerId, kind, size, at: Date.now() });
  };

  const struct = nextRoom.makeAction("struct", {
    onMessage: (data, context) => {
      state.lastStruct = data;
      recordMessage("struct", typeof data, JSON.stringify(data).length, context);
      log("info", `struct from ${context.peerId}: ${JSON.stringify(data).slice(0, 120)}`);
    },
  });
  const bin = nextRoom.makeAction("bin", {
    onMessage: (data, context) => {
      const view = data instanceof Uint8Array ? data : new Uint8Array(data as ArrayBuffer);
      const size = view.byteLength;
      recordMessage(
        "bin",
        data instanceof Uint8Array ? "Uint8Array" : "ArrayBuffer",
        size,
        context,
      );
      state.largeReceived.push({ size, durationMs: 0, hash: bytesToHash(view) });
      log("info", `bin from ${context.peerId}: ${size} bytes`);
    },
    onReceiveProgress: (percent, _ctx) => {
      state.progress.push({ ns: "bin", dir: "recv", percent, at: Date.now() });
    },
  });
  const large = nextRoom.makeAction("large", {
    onMessage: (data, context) => {
      const metadata = context.metadata as { sentAt?: number } | undefined;
      const sentAt = metadata?.sentAt ?? Date.now();
      const durationMs = Date.now() - sentAt;
      const size = String(data).length;
      state.largeReceived.push({ size, durationMs, hash: fnv1a(String(data)) });
      recordMessage("large", "string", size, context);
      log("info", `large from ${context.peerId}: ${size} chars in ${durationMs}ms`);
    },
    onReceiveProgress: (percent, _ctx) => {
      state.progress.push({ ns: "large", dir: "recv", percent, at: Date.now() });
    },
  });

  actionSenders = {
    struct: (data) => struct.send(data as never),
    bin: (data) => bin.send(data as never),
    large: (data, options) =>
      large.send(data as string, options as Parameters<typeof large.send>[1]),
  };
}

function enterRoom(options: RoomOptions): string {
  admissionPolicy = options.admission ?? { mode: "all", allowIds: [] };
  const config: Parameters<typeof joinRoom>[0] = { appId: state.appId };
  if (options.password) config.password = options.password;
  if (options.relays) {
    config.relayConfig = { urls: options.relays, redundancy: options.redundancy ?? 5 };
  } else if (options.redundancy) {
    config.relayConfig = { redundancy: options.redundancy };
  }
  const callbacks: Parameters<typeof joinRoom>[2] = {
    onJoinError: (details) => {
      state.errors.push({ error: details.error, at: Date.now() });
      log("error", `join error: ${details.error}`);
    },
    onPeerHandshake: (peerId, send, receive) =>
      policyHandshake(peerId, send as never, receive as never),
    handshakeTimeoutMs: options.handshakeTimeoutMs ?? 20000,
  };
  state.timings.joinCallAt = Date.now();
  room = joinRoom(config, options.room, callbacks);
  state.selfId = selfId;
  state.room = options.room;
  wireRoomActions(room);
  room.onPeerJoin = (peerId) => {
    if (!state.peers.includes(peerId)) state.peers.push(peerId);
    if (state.timings.firstPeerJoinAt === undefined) {
      state.timings.firstPeerJoinAt = Date.now();
      state.timings.discoveryMs =
        (state.timings.firstPeerJoinAt ?? 0) - (state.timings.joinCallAt ?? 0);
    }
    snapshotRelays();
    snapshotConnections();
    log("info", `peer joined: ${peerId} (peers: ${state.peers.length})`);
    renderStatus();
    setButtons(true);
  };
  room.onPeerLeave = (peerId) => {
    state.peers = state.peers.filter((p) => p !== peerId);
    snapshotConnections();
    log("info", `peer left: ${peerId} (peers: ${state.peers.length})`);
    renderStatus();
    setButtons(true);
  };
  log("info", `entered room ${options.room} as ${selfId}`);
  renderStatus();
  setButtons(true);
  return selfId;
}

function createRoom(options: RoomOptions): string {
  return enterRoom(options);
}

function joinRoomByCode(options: RoomOptions): string {
  return enterRoom(options);
}

async function leaveRoom(): Promise<void> {
  const current = room;
  room = null;
  state.peers = [];
  if (current) await current.leave();
  log("info", "left room");
  renderStatus();
  setButtons(false);
}

async function sendLarge(size = LARGE_SIZE): Promise<void> {
  if (!room || !state.peers[0]) throw new Error("not joined or no peers");
  const sender = actionSenders["large"];
  if (!sender) throw new Error("large action not wired");
  const payload = "x".repeat(size);
  const start = Date.now();
  state.timings.largeSendStartAt = start;
  await sender(payload, {
    metadata: { sentAt: start, totalBytes: size },
    onProgress: (percent: number) => {
      state.progress.push({ ns: "large", dir: "send", percent, at: Date.now() });
    },
  });
  state.timings.largeSendDoneAt = Date.now();
  log("info", `sent ${size} chars in ${(state.timings.largeSendDoneAt ?? 0) - start}ms`);
}

async function sendStruct(): Promise<void> {
  if (!room || !state.peers[0]) throw new Error("not joined or no peers");
  const sender = actionSenders["struct"];
  if (!sender) throw new Error("struct action not wired");
  const payload = {
    type: "action.test",
    seq: 1,
    player: state.selfId,
    payload: { score: 42, tags: ["a", "b"], nested: { ok: true } },
  };
  await sender(payload);
  log("info", "sent structured action");
}

async function sendBinary(bytes: Uint8Array): Promise<void> {
  if (!room || !state.peers[0]) throw new Error("not joined or no peers");
  const sender = actionSenders["bin"];
  if (!sender) throw new Error("bin action not wired");
  await sender(bytes);
  log("info", `sent ${bytes.byteLength} binary bytes`);
}

async function pingFirstPeer(): Promise<number | null> {
  if (!room || !state.peers[0]) return null;
  const target = state.peers[0]!;
  const ms = await room.ping(target);
  state.pingResults.push({ peerId: target, ms });
  log("info", `ping ${target}: ${ms}ms`);
  return ms;
}

async function dropFirstRelay(): Promise<string | null> {
  const sockets = getRelaySockets() as Record<string, WebSocket>;
  const url = Object.keys(sockets)[0];
  if (!url) return null;
  log("warn", `closing relay ${url}`);
  sockets[url]!.close();
  return url;
}

function setAdmissionAllowList(ids: string[]): void {
  admissionPolicy = { mode: "allow-list", allowIds: ids };
  log("info", `admission allow-list set to ${ids.join(",") || "(empty)"}`);
}

function setAdmissionMode(mode: "all" | "none"): void {
  admissionPolicy = { mode, allowIds: [] };
  log("info", `admission mode set to ${mode}`);
}

function getState(): HarnessState {
  snapshotRelays();
  snapshotConnections();
  return state;
}

function getConnectionStates(): Record<string, string> {
  snapshotConnections();
  return state.connectionStates;
}

// ---- window API for the Playwright spec -----------------------------------
declare global {
  interface Window {
    __harness: {
      ready: boolean;
      createRoom: (options: RoomOptions) => string;
      joinRoomByCode: (options: RoomOptions) => string;
      leave: () => Promise<void>;
      sendLarge: (size?: number) => Promise<void>;
      sendStruct: () => Promise<void>;
      sendBinary: (bytes: Uint8Array) => Promise<void>;
      ping: () => Promise<number | null>;
      dropFirstRelay: () => Promise<string | null>;
      setAdmissionAllowList: (ids: string[]) => void;
      setAdmissionMode: (mode: "all" | "none") => void;
      getState: () => HarnessState;
      getSelfId: () => string | null;
      getConnectionStates: () => Record<string, string>;
      defaultRelayUrls: string[];
      LARGE_SIZE: number;
    };
  }
}

// ---- UI wiring --------------------------------------------------------------
function bindUI(): void {
  const value = (id: string): string => {
    const el = document.querySelector<HTMLInputElement | HTMLSelectElement>(`#${id}`);
    return el?.value ?? "";
  };
  document.querySelector("#createBtn")?.addEventListener("click", () => {
    createRoom({
      room: value("room").trim() || Math.random().toString(36).slice(2, 6).toUpperCase(),
      password: value("password") || undefined,
      admission: { mode: value("admission") as "all" | "none", allowIds: [] },
    });
  });
  document.querySelector("#joinBtn")?.addEventListener("click", () => {
    joinRoomByCode({
      room: value("room").trim() || Math.random().toString(36).slice(2, 6).toUpperCase(),
      password: value("password") || undefined,
    });
  });
  document.querySelector("#leaveBtn")?.addEventListener("click", () => {
    void leaveRoom();
  });
  document.querySelector("#sendStructBtn")?.addEventListener("click", () => {
    void sendStruct();
  });
  document.querySelector("#sendBinBtn")?.addEventListener("click", () => {
    void sendBinary(new Uint8Array(1024 * 1024).map((_, i) => i % 251));
  });
  document.querySelector("#sendLargeBtn")?.addEventListener("click", () => {
    void sendLarge();
  });
  document.querySelector("#pingBtn")?.addEventListener("click", () => {
    void pingFirstPeer();
  });
  document.querySelector("#dropRelayBtn")?.addEventListener("click", () => {
    void dropFirstRelay();
  });
  document.querySelector("#appId")?.addEventListener("change", (event) => {
    state.appId = (event.target as HTMLInputElement).value || APP_ID;
    log("info", `appId set to ${state.appId}`);
  });
}

window.__harness = {
  ready: true,
  createRoom,
  joinRoomByCode,
  leave: leaveRoom,
  sendLarge,
  sendStruct,
  sendBinary,
  ping: pingFirstPeer,
  dropFirstRelay,
  setAdmissionAllowList,
  setAdmissionMode,
  getState,
  getSelfId: () => selfId,
  getConnectionStates,
  defaultRelayUrls,
  LARGE_SIZE,
};

state.ready = true;
log("info", `harness ready · selfId ${selfId}`);
bindUI();
