import { afterEach, describe, expect, it, vi } from "vitest";
import { PROTOCOL_VERSION, htmlSourceBytes, htmlSourceWarnBytes } from "@rocketcrab/protocol";
import { InMemoryTransportHub, type InMemoryTransport } from "@rocketcrab/testing";
import {
  GAME_SOURCE_CHANNEL,
  GameSourceCoordinator,
  defaultGameSourceCompatibilityCheck,
  hashSource,
  utf8ByteLength,
  type GameSourceMetadataInfo,
  type GameSourceTransferEvent,
  type GameSourceCoordinatorOptions,
} from "./game-source";
import { newMessageId, nowSentAt } from "./messages";

const hubs: InMemoryTransportHub[] = [];
const coordinators: GameSourceCoordinator[] = [];
afterEach(() => {
  for (const c of coordinators.splice(0)) c.dispose();
  for (const h of hubs.splice(0)) h.dispose();
  vi.restoreAllMocks();
});
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
async function settle(hub: InMemoryTransportHub) {
  for (let i = 0; i < 20; i++) {
    hub.drain();
    await flush();
  }
}
function coordinator(
  transport: InMemoryTransport,
  options: Omit<GameSourceCoordinatorOptions, "transport"> = {},
) {
  const events: GameSourceTransferEvent[] = [];
  const instance = new GameSourceCoordinator({
    ...options,
    transport,
    onEvent: (event) => events.push(event),
  });
  coordinators.push(instance);
  return { instance, events };
}
async function world() {
  const hub = new InMemoryTransportHub();
  hubs.push(hub);
  const host = hub.createTransport({ memberId: "host", displayName: "Host" });
  const joiner = hub.createTransport({ memberId: "joiner", displayName: "Joiner" });
  await host.join({ room: "private", sessionId: "session" });
  await joiner.join({ room: "private", sessionId: "session" });
  return { hub, host, joiner };
}
function envelope(transport: InMemoryTransport, type: string) {
  return {
    version: PROTOCOL_VERSION,
    sessionId: transport.sessionId,
    senderMemberId: transport.selfMemberId,
    senderConnectionId: transport.selfConnectionId,
    messageId: newMessageId(),
    sentAt: nowSentAt(),
    type,
  };
}
async function announce(
  host: InMemoryTransport,
  metadata: GameSourceMetadataInfo,
  overrides: object = {},
) {
  await host.send({
    channel: GAME_SOURCE_CHANNEL,
    payload: { ...envelope(host, "game.source.metadata"), ...metadata, ...overrides },
  });
}
async function descriptor(source = "<html>🦀</html>"): Promise<GameSourceMetadataInfo> {
  return {
    gameId: "game",
    sourceSha256: await hashSource(source),
    sourceSizeBytes: utf8ByteLength(source),
  };
}
const received = (events: GameSourceTransferEvent[]) => events.filter((e) => e.type === "received");
const completed = (events: GameSourceTransferEvent[], direction: "send" | "receive") =>
  events.filter((e) => e.type === "complete" && e.direction === direction);

describe("whole-source requests", () => {
  it.each([
    "",
    "<html>🦀漢字</html>",
    "\ufeff<html>preserve BOM</html>",
    "x".repeat(htmlSourceBytes),
  ])("verifies exact UTF-8 bytes and confirms application acceptance (%#)", async (source) => {
    const { hub, host, joiner } = await world();
    const a = coordinator(host);
    const b = coordinator(joiner);
    await a.instance.setSource({ gameId: "game", source });
    await settle(hub);
    expect(received(b.events)).toMatchObject([{ source, sourceSha256: await hashSource(source) }]);
    expect(b.instance.getCachedSource("game")).toBe(source);
    expect(completed(a.events, "send")).toHaveLength(1);
    expect(completed(b.events, "receive")).toHaveLength(1);
    expect(b.events.some((e) => e.type === "progress" && e.progress.fraction === 1)).toBe(true);
    expect(b.events.filter((e) => e.type === "error")).toEqual([]);
  });
  it("uses transport receive progress for a large response", async () => {
    const { hub, host, joiner } = await world();
    const a = coordinator(host);
    const b = coordinator(joiner);
    await a.instance.setSource({ gameId: "game", source: "🦀".repeat(80_000) });
    await settle(hub);
    const progress = b.events.filter((e) => e.type === "progress").map((e) => e.progress);
    expect(progress.some((p) => p.fraction > 0 && p.fraction < 1)).toBe(true);
    expect(progress.at(-1)).toMatchObject({
      fraction: 1,
      bytesTransferred: 320_000,
      totalBytes: 320_000,
    });
  });
  it("does not call transport send completion verified acceptance", async () => {
    const { host, joiner } = await world();
    const a = coordinator(host);
    await a.instance.setSource({ gameId: "game", source: "hello" });
    await joiner.request({
      channel: GAME_SOURCE_CHANNEL,
      targetConnectionId: host.selfConnectionId,
      payload: { gameId: "game", sourceSha256: await hashSource("hello") },
    });
    expect(completed(a.events, "send")).toEqual([]);
  });
  it("rejects unavailable/wrong-hash requests without exposing another source", async () => {
    const { host, joiner } = await world();
    const a = coordinator(host);
    await a.instance.setSource({ gameId: "game", source: "hello" });
    await expect(
      joiner.request({
        channel: GAME_SOURCE_CHANNEL,
        targetConnectionId: host.selfConnectionId,
        payload: { gameId: "game", sourceSha256: "0".repeat(64) },
      }),
    ).rejects.toThrow();
    expect(completed(a.events, "send")).toEqual([]);
  });
  it.each(["corrupt", "short", "long", "invalid UTF-8", "not binary"])(
    "rejects %s responses without caching or acceptance",
    async (variant) => {
      const { hub, host, joiner } = await world();
      const b = coordinator(joiner);
      const metadata = await descriptor("1234");
      host.handleRequest(GAME_SOURCE_CHANNEL, () =>
        variant === "corrupt"
          ? new TextEncoder().encode("4321")
          : variant === "short"
            ? new Uint8Array(3)
            : variant === "long"
              ? new Uint8Array(5)
              : variant === "invalid UTF-8"
                ? new Uint8Array([255, 255, 255, 255])
                : "1234",
      );
      const messages: unknown[] = [];
      host.on("message:received", (m) => messages.push(m.payload));
      await announce(host, metadata);
      await settle(hub);
      expect(received(b.events)).toEqual([]);
      expect(b.instance.hasSource("game")).toBe(false);
      expect(b.events.some((e) => e.type === "error")).toBe(true);
      expect(messages.some((m) => (m as { type?: string }).type === "game.source.accepted")).toBe(
        false,
      );
    },
  );
  it("does not automatically retry rejected responses; explicit refresh recovers", async () => {
    const { hub, host, joiner } = await world();
    const a = coordinator(host);
    const b = coordinator(joiner);
    const request = vi
      .spyOn(joiner, "request")
      .mockRejectedValueOnce(new Error("receive rejected"));
    await a.instance.setSource({ gameId: "game", source: "hello" });
    await settle(hub);
    expect(request).toHaveBeenCalledTimes(1);
    expect(received(b.events)).toEqual([]);
    await b.instance.refresh();
    await settle(hub);
    expect(request).toHaveBeenCalledTimes(2);
    expect(received(b.events)).toHaveLength(1);
  });
  it("deduplicates concurrent metadata and requests", async () => {
    const { hub, host, joiner } = await world();
    const b = coordinator(joiner);
    const metadata = await descriptor();
    let resolve!: (value: Uint8Array) => void;
    host.handleRequest(
      GAME_SOURCE_CHANNEL,
      () =>
        new Promise<Uint8Array>((r) => {
          resolve = r;
        }),
    );
    const request = vi.spyOn(joiner, "request");
    await announce(host, metadata);
    await settle(hub);
    await announce(host, metadata);
    await announce(host, metadata);
    await settle(hub);
    expect(request).toHaveBeenCalledTimes(1);
    resolve(new TextEncoder().encode("<html>🦀</html>"));
    await settle(hub);
    expect(received(b.events)).toHaveLength(1);
  });
  it("cancels a slow request and ignores its stale response", async () => {
    const { hub, host, joiner } = await world();
    const b = coordinator(joiner);
    const metadata = await descriptor();
    let resolve!: (value: Uint8Array) => void;
    host.handleRequest(
      GAME_SOURCE_CHANNEL,
      () =>
        new Promise<Uint8Array>((r) => {
          resolve = r;
        }),
    );
    await announce(host, metadata);
    await settle(hub);
    b.instance.cancelTransfer(metadata.gameId, metadata.sourceSha256, "user_cancelled");
    resolve(new TextEncoder().encode("<html>🦀</html>"));
    await settle(hub);
    expect(received(b.events)).toEqual([]);
    expect(b.events.some((e) => e.type === "cancelled" && e.reason === "user_cancelled")).toBe(
      true,
    );
  });
  it("aborts on disconnect and reconnects with a fresh whole request", async () => {
    const { hub, host, joiner } = await world();
    const a = coordinator(host);
    const b = coordinator(joiner);
    vi.spyOn(joiner, "request").mockImplementationOnce(
      (options) =>
        new Promise((_resolve, reject) =>
          options.signal?.addEventListener("abort", () => reject(new Error("aborted")), {
            once: true,
          }),
        ),
    );
    await a.instance.setSource({ gameId: "game", source: "hello" });
    await settle(hub);
    await joiner.reconnect();
    await settle(hub);
    expect(b.events.some((e) => e.type === "cancelled")).toBe(true);
    expect(received(b.events)).toMatchObject([{ source: "hello" }]);
  });
  it("recovers by cached acceptance after reconnect without transferring HTML again", async () => {
    const { hub, host, joiner } = await world();
    const a = coordinator(host);
    const b = coordinator(joiner);
    const request = vi.spyOn(joiner, "request");
    await a.instance.setSource({ gameId: "game", source: "hello" });
    await settle(hub);
    await joiner.reconnect();
    await settle(hub);
    expect(request).toHaveBeenCalledTimes(1);
    expect(received(b.events)).toHaveLength(1);
    expect(completed(a.events, "send")).toHaveLength(2);
  });
  it("retains full received metadata and serves a late joiner after creator departure", async () => {
    const { hub, host, joiner } = await world();
    const a = coordinator(host);
    const b = coordinator(joiner);
    await a.instance.setSource({
      gameId: "game",
      source: "hello",
      title: "Game",
      apiVersion: 1,
      mode: "raw",
    });
    await settle(hub);
    await host.leave();
    a.instance.dispose();
    const late = hub.createTransport({ memberId: "late", displayName: "Late" });
    await late.join({ room: "private", sessionId: "session" });
    const c = coordinator(late);
    await settle(hub);
    expect(received(c.events)).toMatchObject([{ source: "hello" }]);
    expect(c.events.find((e) => e.type === "metadata")).toMatchObject({
      metadata: { gameId: "game", title: "Game", apiVersion: 1, mode: "raw" },
    });
    expect(completed(b.events, "send")).toHaveLength(1);
  });
  it("does not reuse cached bytes for a different source hash under the same game ID", async () => {
    const { hub, host, joiner } = await world();
    const a = coordinator(host);
    const b = coordinator(joiner);
    await a.instance.setSource({ gameId: "game", source: "first" });
    await settle(hub);
    await a.instance.setSource({ gameId: "game", source: "second" });
    await settle(hub);
    expect(received(b.events).map((e) => e.source)).toEqual(["first", "second"]);
    expect(b.instance.getCachedSource("game", await hashSource("first"))).toBeUndefined();
  });
  it("caps the session source cache at eight documents", async () => {
    const { host } = await world();
    const a = coordinator(host);
    for (let i = 0; i < 10; i++)
      await a.instance.setSource({ gameId: `game${i}`, source: String(i) });
    expect(a.instance.hasSource("game0")).toBe(false);
    expect(a.instance.hasSource("game1")).toBe(false);
    expect(a.instance.hasSource("game2")).toBe(true);
    expect(a.instance.hasSource("game9")).toBe(true);
  });
});

describe("validation, compatibility and cleanup", () => {
  it("enforces the 2 MiB limit using actual bytes, not caller-provided counts", async () => {
    const { host } = await world();
    const a = coordinator(host);
    await expect(
      a.instance.setSource({
        gameId: "game",
        source: "x".repeat(htmlSourceBytes + 1),
        sourceSizeBytes: 1,
      }),
    ).rejects.toMatchObject({ code: "too_large" });
  });
  it.each([{ sourceSizeBytes: 1 }, { sourceSha256: "0".repeat(64) }])(
    "rejects incorrect precomputed metadata %j",
    async (metadata) => {
      const { host } = await world();
      const a = coordinator(host);
      await expect(
        a.instance.setSource({ gameId: "game", source: "hello", ...metadata }),
      ).rejects.toMatchObject({ code: "hash_mismatch" });
    },
  );
  it("warns at the soft limit and rejects oversized incoming descriptors before requesting bytes", async () => {
    const { hub, host, joiner } = await world();
    const a = coordinator(host);
    const b = coordinator(joiner);
    await a.instance.setSource({ gameId: "game", source: "x".repeat(htmlSourceWarnBytes) });
    await settle(hub);
    expect(a.events.some((e) => e.type === "warning")).toBe(true);
    const request = vi.spyOn(joiner, "request");
    await announce(host, { ...(await descriptor()), sourceSizeBytes: htmlSourceBytes + 1 });
    await settle(hub);
    expect(request).not.toHaveBeenCalled();
    expect(b.events.some((e) => e.type === "error" && e.error.code === "too_large")).toBe(true);
  });
  it("rejects unsupported API versions before requesting", async () => {
    const { hub, host, joiner } = await world();
    const a = coordinator(host);
    const b = coordinator(joiner);
    const request = vi.spyOn(joiner, "request");
    await a.instance.setSource({ gameId: "game", source: "hello", apiVersion: 999 });
    await settle(hub);
    expect(request).not.toHaveBeenCalled();
    expect(b.events.some((e) => e.type === "incompatible")).toBe(true);
    expect(completed(a.events, "send")).toEqual([]);
  });
  it("honors the compatibility policy and supported API override", async () => {
    expect(
      defaultGameSourceCompatibilityCheck({ ...(await descriptor()), apiVersion: 999 }, [999])
        .compatible,
    ).toBe(true);
    const { hub, host, joiner } = await world();
    const a = coordinator(host);
    const b = coordinator(joiner, {
      compatibilityCheck: () => ({ compatible: false, reason: "Policy refused" }),
    });
    await a.instance.setSource({ gameId: "game", source: "hello" });
    await settle(hub);
    expect(b.events).toContainEqual(
      expect.objectContaining({ type: "incompatible", reason: "Policy refused" }),
    );
  });
  it("ignores an obsolete async compatibility result after a new selection", async () => {
    const { hub, host, joiner } = await world();
    let finish!: (value: { compatible: boolean }) => void;
    const b = coordinator(joiner, {
      compatibilityCheck: (metadata) =>
        metadata.gameId === "old"
          ? new Promise((r) => {
              finish = r;
            })
          : { compatible: true },
    });
    host.handleRequest(GAME_SOURCE_CHANNEL, () => new TextEncoder().encode("new"));
    await announce(host, { ...(await descriptor("old")), gameId: "old" });
    await settle(hub);
    await announce(host, { ...(await descriptor("new")), gameId: "new" });
    await settle(hub);
    finish({ compatible: true });
    await settle(hub);
    expect(received(b.events)).toMatchObject([{ gameId: "new", source: "new" }]);
    expect(b.events.filter((e) => e.type === "metadata").map((e) => e.metadata.gameId)).toEqual([
      "new",
    ]);
  });
  it.each([
    { senderMemberId: "impostor" },
    { senderConnectionId: "stale" },
    { sessionId: "other" },
  ])("rejects spoofed/mismatched control envelopes %j", async (override) => {
    const { hub, host, joiner } = await world();
    const b = coordinator(joiner);
    const request = vi.spyOn(joiner, "request");
    await announce(host, await descriptor(), override);
    await settle(hub);
    expect(request).not.toHaveBeenCalled();
    expect(received(b.events)).toEqual([]);
  });
  it("ignores unsolicited or wrong-hash acceptance messages", async () => {
    const { hub, host, joiner } = await world();
    const a = coordinator(host);
    await a.instance.setSource({ gameId: "game", source: "hello" });
    await joiner.send({
      channel: GAME_SOURCE_CHANNEL,
      payload: {
        ...envelope(joiner, "game.source.accepted"),
        gameId: "game",
        sourceSha256: "0".repeat(64),
      },
    });
    await settle(hub);
    expect(completed(a.events, "send")).toEqual([]);
  });
  it("drops malformed source control and binary messages", async () => {
    const { hub, host, joiner } = await world();
    const b = coordinator(joiner);
    await host.send({ channel: GAME_SOURCE_CHANNEL, payload: { type: "bogus" } });
    await host.send({
      channel: GAME_SOURCE_CHANNEL,
      binary: true,
      payload: new Uint8Array([1, 2]),
    });
    await settle(hub);
    expect(received(b.events)).toEqual([]);
    expect(b.events.filter((e) => e.type === "error")).toHaveLength(2);
  });
  it("does not transfer across private rooms", async () => {
    const { hub, host } = await world();
    const a = coordinator(host);
    const outsider = hub.createTransport({ memberId: "outside", displayName: "Outside" });
    await outsider.join({ room: "other", sessionId: "session" });
    const b = coordinator(outsider);
    await a.instance.setSource({ gameId: "game", source: "hello" });
    await b.instance.refresh();
    await settle(hub);
    expect(received(b.events)).toEqual([]);
    await expect(
      outsider.request({
        channel: GAME_SOURCE_CHANNEL,
        targetConnectionId: host.selfConnectionId,
        payload: {},
      }),
    ).rejects.toThrow();
  });
  it("detaches handlers, clears cache and suppresses async completions on dispose", async () => {
    const { hub, host, joiner } = await world();
    const a = coordinator(host);
    const b = coordinator(joiner);
    await a.instance.setSource({ gameId: "game", source: "hello" });
    await settle(hub);
    b.instance.dispose();
    const count = b.events.length;
    await a.instance.setSource({ gameId: "game", source: "changed" });
    await settle(hub);
    expect(b.events).toHaveLength(count);
    expect(b.instance.hasSource("game")).toBe(false);
    await expect(b.instance.refresh()).rejects.toMatchObject({ code: "invalid_state" });
    const replacement = coordinator(joiner);
    await replacement.instance.refresh();
    await settle(hub);
    expect(received(replacement.events)).toMatchObject([{ source: "changed" }]);
  });
});
