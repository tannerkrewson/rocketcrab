/**
 * Test doubles for runtime tests: jsdom has no MessageChannel/MessagePort
 * (verified during U3), so instances and the bootstrap listener are driven
 * through a minimal port double.
 */
import type { FrameFactory, PortLike } from "../runtime-instance";

export interface FakePort extends PortLike {
  sent: unknown[];
  closed: boolean;
}

export function createFakePort(): FakePort {
  const port: FakePort = {
    sent: [],
    closed: false,
    onmessage: null,
    postMessage(message: unknown): void {
      port.sent.push(message);
    },
    close(): void {
      port.closed = true;
    },
  };
  return port;
}

/** Deliver an incoming message to the port's onmessage handler. */
export function receiveOnPort(port: FakePort, message: unknown): void {
  port.onmessage?.({ data: message } as MessageEvent);
}

export interface FakeFrameRecord {
  source: string;
  allowTokens: readonly string[];
  window: Window | null;
  destroyed: boolean;
  /** Recorded host-pushed session events (kind + payload). */
  received: Array<{ kind: string; payload: unknown }>;
}

export interface FakeFrameHost {
  frames: FakeFrameRecord[];
  factory: FrameFactory;
}

/** A frame factory that records created frames instead of touching the DOM. */
export function createFakeFrameFactory(): FakeFrameHost {
  const frames: FakeFrameRecord[] = [];
  const factory: FrameFactory = {
    create(source: string, allowTokens: readonly string[]) {
      const record: FakeFrameRecord = {
        source,
        allowTokens: [...allowTokens],
        window: null,
        destroyed: false,
        received: [],
      };
      // The runtime delivers host-pushed events through the same-origin
      // bridge hook; the double records them for assertions.
      const bridge = {
        receive: (kind: string, payload: unknown) => {
          record.received.push({ kind, payload });
        },
      };
      const windowLike = { __novaGameBridge: bridge } as unknown as Window;
      record.window = windowLike;
      frames.push(record);
      return {
        window: record.window,
        destroy() {
          record.destroyed = true;
        },
      };
    },
  };
  return { frames, factory };
}
