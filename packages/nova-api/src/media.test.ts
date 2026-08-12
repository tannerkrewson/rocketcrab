/**
 * A3 media transport — experimental surface tests.
 *
 * `nova.media` is the experimental media surface (option 5 verdict in
 * `docs/testing/media-bridging-findings.md`): games can probe platform
 * capability with `isSupported()` and must get a clear, stable
 * `media_unsupported` failure from `publish()` in this build. These tests
 * cover the probe, input validation, the lifecycle gating, and the stable
 * error code — including the stubbed-globals paths that only exist in real
 * browsers (the Node test environment has no `MediaStream`).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createNovaClient, type NovaClientBackend, type NovaSessionEvent } from "./client";
import { NOVA_ERROR_CODES } from "./errors";
import { isMediaInput, mediaUnsupportedError, probeMediaSupport } from "./media";

function fakeBackend(): NovaClientBackend {
  const listeners = new Set<(event: NovaSessionEvent) => void>();
  return {
    apiVersion: 1,
    self: null,
    register() {},
    ready() {},
    dispatch() {
      return Promise.resolve();
    },
    createRawChannel() {},
    closeRawChannel() {},
    sendRaw() {},
    registerSimulation() {},
    sendSimulationInput() {},
    onEvent(handler) {
      listeners.add(handler);
      return () => {
        listeners.delete(handler);
      };
    },
  };
}

/** A stub MediaStream class that survives structuredClone probes. */
class StubMediaStream {
  readonly id = "stub-stream";
}

/** A stub MediaStreamTrack class for input validation tests. */
class StubMediaStreamTrack {
  readonly kind = "video";
  readonly id = "stub-track";
}

/** A stub MediaStream as the DOM type (real instances only exist in browsers). */
function fakeStream(): MediaStream {
  return new StubMediaStream() as unknown as MediaStream;
}

/** A stub MediaStreamTrack as the DOM type. */
function fakeTrack(): MediaStreamTrack {
  return new StubMediaStreamTrack() as unknown as MediaStreamTrack;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("probeMediaSupport", () => {
  it("returns false when structuredClone or MediaStream is unavailable", () => {
    // Node test environment: no MediaStream, structuredClone exists.
    expect(typeof structuredClone).toBe("function");
    expect(probeMediaSupport()).toBe(false);
  });

  it("returns false when structuredClone is missing entirely", () => {
    vi.stubGlobal("structuredClone", undefined);
    vi.stubGlobal("MediaStream", StubMediaStream);
    expect(probeMediaSupport()).toBe(false);
  });

  it("returns false when cloning MediaStream throws DataCloneError", () => {
    vi.stubGlobal("structuredClone", () => {
      throw new DOMException("MediaStream could not be cloned.", "DataCloneError");
    });
    vi.stubGlobal("MediaStream", StubMediaStream);
    expect(probeMediaSupport()).toBe(false);
  });

  it("returns true when this realm can structured-clone a MediaStream", () => {
    vi.stubGlobal("structuredClone", (value: unknown) => value);
    vi.stubGlobal("MediaStream", StubMediaStream);
    expect(probeMediaSupport()).toBe(true);
  });
});

describe("isMediaInput", () => {
  it("accepts MediaStream and MediaStreamTrack instances", () => {
    vi.stubGlobal("MediaStream", StubMediaStream);
    vi.stubGlobal("MediaStreamTrack", StubMediaStreamTrack);
    expect(isMediaInput(new StubMediaStream())).toBe(true);
    expect(isMediaInput(new StubMediaStreamTrack())).toBe(true);
  });

  it("rejects non-media values", () => {
    vi.stubGlobal("MediaStream", StubMediaStream);
    vi.stubGlobal("MediaStreamTrack", StubMediaStreamTrack);
    expect(isMediaInput(null)).toBe(false);
    expect(isMediaInput(undefined)).toBe(false);
    expect(isMediaInput({})).toBe(false);
    expect(isMediaInput("camera")).toBe(false);
    expect(isMediaInput(42)).toBe(false);
    expect(isMediaInput(new Uint8Array([1]))).toBe(false);
  });
});

describe("media error contract", () => {
  it("registers the stable media_unsupported code", () => {
    expect(NOVA_ERROR_CODES.media_unsupported).toBe("media_unsupported");
  });

  it("builds a NovaError with the media_unsupported code", () => {
    const error = mediaUnsupportedError();
    expect(error.code).toBe("media_unsupported");
    expect(error.message).toContain("experimental");
  });
});

describe("nova.media handle", () => {
  function clientWithBackend(): {
    client: ReturnType<typeof createNovaClient>;
    start: () => void;
    end: () => void;
  } {
    const listeners = new Set<(event: NovaSessionEvent) => void>();
    const backend = fakeBackend();
    backend.onEvent = (handler) => {
      listeners.add(handler);
      return () => {
        listeners.delete(handler);
      };
    };
    const client = createNovaClient(backend);
    client.defineGame({ title: "Media Game" });
    client.ready();
    const start = () => {
      for (const listener of listeners) listener({ type: "start" });
    };
    const end = () => {
      for (const listener of listeners) listener({ type: "end", reason: "user_exit" });
    };
    return { client, start, end };
  }

  it("is part of the game-facing surface", () => {
    const { client } = clientWithBackend();
    expect(typeof client.media.isSupported).toBe("function");
    expect(typeof client.media.publish).toBe("function");
  });

  it("reports platform support without throwing", () => {
    const { client } = clientWithBackend();
    // Node environment: no MediaStream, so the honest answer is false.
    expect(client.media.isSupported()).toBe(false);
  });

  it("fails clearly before start and after end (lifecycle gating)", () => {
    vi.stubGlobal("MediaStream", StubMediaStream);
    const { client, start, end } = clientWithBackend();
    expect(() => client.media.publish(fakeStream())).toThrowError(
      expect.objectContaining({ code: "not_started" }),
    );
    start();
    expect(() => client.media.publish(fakeStream())).toThrowError(
      expect.objectContaining({ code: "media_unsupported" }),
    );
    end();
    expect(() => client.media.publish(fakeStream())).toThrowError(
      expect.objectContaining({ code: "ended" }),
    );
  });

  it("rejects non-media input with invalid_options", () => {
    const { client, start } = clientWithBackend();
    start();
    expect(() =>
      client.media.publish({ kind: "fake track" } as unknown as MediaStream),
    ).toThrowError(expect.objectContaining({ code: "invalid_options" }));
    // A plain object that happens to look like media still fails: only real
    // MediaStreamTrack/MediaStream instances are accepted.
    expect(() =>
      client.media.publish({ id: "x", kind: "video" } as unknown as MediaStream),
    ).toThrowError(expect.objectContaining({ code: "invalid_options" }));
  });

  it("never publishes in this build: valid media still fails with media_unsupported", () => {
    vi.stubGlobal("MediaStream", StubMediaStream);
    vi.stubGlobal("MediaStreamTrack", StubMediaStreamTrack);
    const { client, start } = clientWithBackend();
    start();
    expect(() => client.media.publish(fakeStream())).toThrowError(
      expect.objectContaining({ code: "media_unsupported" }),
    );
    expect(() => client.media.publish(fakeTrack())).toThrowError(
      expect.objectContaining({ code: "media_unsupported" }),
    );
  });
});
