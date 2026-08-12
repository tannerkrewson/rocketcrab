/**
 * Shared test harness for the U6 arena: a fake runtime host (the same seams
 * RuntimeHostClient exposes) plus drive helpers, so both the engine tests
 * and the ArenaPage UI tests exercise the real runtime protocol without any
 * real iframes or channels.
 */
import { expect, vi } from "vitest";
import type { ChannelPort } from "../runtime-host";
import type { ArenaSeams } from "./engine";
import type { ArenaRunOutcome } from "./types";

export interface FakePort extends ChannelPort {
  sent: unknown[];
  closed: boolean;
}

export function createFakePort(): FakePort {
  const port: FakePort = {
    sent: [],
    closed: false,
    onmessage: null,
    onmessageerror: null,
    postMessage(message: unknown): void {
      port.sent.push(message);
    },
    close(): void {
      port.closed = true;
    },
  };
  return port;
}

export function deliver(port: FakePort, message: unknown): void {
  port.onmessage?.({ data: message } as MessageEvent);
}

export interface FakeChannel {
  port1: FakePort;
  port2: FakePort;
}

export interface ArenaHarness {
  seams: ArenaSeams;
  channels: FakeChannel[];
  frames: HTMLIFrameElement[];
  windowMessages: Array<{ data: unknown }>;
  containers: Map<string, HTMLDivElement>;
  /** Recorded clean-run outcomes (persisted test results). */
  outcomes: ArenaRunOutcome[];
}

export function createHarness(): ArenaHarness {
  const channels: FakeChannel[] = [];
  const frames: HTMLIFrameElement[] = [];
  const windowMessages: ArenaHarness["windowMessages"] = [];
  const containers = new Map<string, HTMLDivElement>();
  return {
    seams: {
      createChannel() {
        const port1 = createFakePort();
        const port2 = createFakePort();
        channels.push({ port1, port2 });
        return { port1, port2 };
      },
      async waitForFrameLoad(iframe) {
        frames.push(iframe);
        iframe.contentWindow?.addEventListener("message", (event: MessageEvent) => {
          windowMessages.push({ data: event.data });
        });
      },
    },
    channels,
    frames,
    windowMessages,
    containers,
    outcomes: [],
  };
}

export function mountContainer(harness: ArenaHarness, id: string): HTMLDivElement {
  const div = document.createElement("div");
  div.setAttribute("data-player", id);
  document.body.appendChild(div);
  harness.containers.set(id, div);
  return div;
}

export function readyMessage(): Record<string, unknown> {
  return {
    version: 1,
    runtimeInstanceId: "runtime-1",
    messageId: "message-ready",
    sentAt: 1_700_000_000_000,
    type: "runtime.ready",
    status: "ready",
  };
}

export function registrationMessage(title: string, gameMode = "state"): Record<string, unknown> {
  return {
    version: 1,
    runtimeInstanceId: "runtime-1",
    messageId: "message-reg",
    sentAt: 1_700_000_000_001,
    type: "game.registration",
    gameId: "game-1",
    title,
    gameMode,
  };
}

export function apiCallMessage(method: string, payload: unknown): Record<string, unknown> {
  return {
    version: 1,
    runtimeInstanceId: "runtime-1",
    messageId: `message-${method}`,
    sentAt: 1_700_000_000_002,
    type: "game.apiCall",
    method,
    payload,
  };
}

export function runtimeErrorMessage(category: string, message: string): Record<string, unknown> {
  return {
    version: 1,
    runtimeInstanceId: "runtime-1",
    messageId: "message-error",
    sentAt: 1_700_000_000_003,
    type: "runtime.error",
    category,
    message,
  };
}

/** Ready every player's runtime frame in load order (baseline = existing channels). */
export async function readyAll(
  channels: FakeChannel[],
  count: number,
  baseline = 0,
): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    await vi.waitFor(() => expect(channels.length).toBe(baseline + index + 1));
    deliver(channels[baseline + index]!.port1, readyMessage());
  }
}

/** Register + ready every player so the arena reaches game start. */
export async function runToStart(
  channels: FakeChannel[],
  count: number,
  baseline = 0,
): Promise<void> {
  await readyAll(channels, count, baseline);
  for (let index = 0; index < count; index += 1) {
    deliver(channels[baseline + index]!.port1, registrationMessage(`Game ${index + 1}`));
    deliver(channels[baseline + index]!.port1, apiCallMessage("ready", {}));
  }
}
