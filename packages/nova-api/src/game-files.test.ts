import { afterEach, describe, expect, it, vi } from "vitest";
import { actionTimeoutMs, gameFileBytes, gameFilesTotalBytes } from "@rocketcrab/protocol";
import { GameFiles } from "./game-files";
import { createInMemoryHarness } from "./harness";
import { useRealTime, useSimulatedTime } from "./simulated-time.test-helper";

const helloRef = "nova-file:2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824";
const hello = () => ({ bytes: new TextEncoder().encode("hello").buffer, mimeType: "text/plain" });
const files: GameFiles[] = [];

afterEach(() => {
  for (const store of files.splice(0)) store.dispose();
  useRealTime();
});

function setup() {
  useSimulatedTime();
  const harness = createInMemoryHarness();
  let authority = "member-a";
  async function join(
    memberId: string,
    prepare?: (transport: ReturnType<typeof harness.createTransport>) => void,
  ) {
    const transport = harness.createTransport({ memberId });
    prepare?.(transport);
    const store = new GameFiles(
      transport,
      "game",
      () => authority,
      () => {},
    );
    files.push(store);
    store.attach();
    await transport.join({ room: "files", sessionId: "session-files" });
    return { store, transport };
  }
  return {
    join,
    handover(memberId: string) {
      authority = memberId;
      for (const store of files) store.retryDownloads();
    },
    async deliver() {
      for (let step = 0; step < 8; step++) {
        harness.drain();
        await vi.advanceTimersByTimeAsync(0);
      }
    },
  };
}

describe("shared file cache", () => {
  it("rejects a binary upload when the advertised hash does not match", async () => {
    const { join, deliver } = setup();
    const authority = await join("member-a");
    const sender = await join("member-b", (transport) => {
      const handle = transport.handleRequest.bind(transport);
      vi.spyOn(transport, "handleRequest").mockImplementation((channel, handler) =>
        handle(channel, channel === "nova.file.upload" ? () => new Uint8Array(6) : handler),
      );
    });
    const upload = expect(sender.store.put(hello())).rejects.toMatchObject({
      code: "file_unavailable",
      message: expect.stringContaining("SHA-256"),
    });
    await deliver();
    await upload;
    expect(authority.store.canCommit(new Set([helloRef]))).toBe(false);
  });

  it("expires pending uploads and retains committed files until state removes them", async () => {
    const { join } = setup();
    const { store } = await join("member-a");
    const ref = await store.put(hello());
    expect(store.canCommit(new Set([ref]))).toBe(true);
    await vi.advanceTimersByTimeAsync(actionTimeoutMs);
    expect(store.canCommit(new Set([ref]))).toBe(false);
    await store.put(hello());
    store.updateRefs(new Set([ref]));
    await vi.advanceTimersByTimeAsync(actionTimeoutMs);
    expect(store.canCommit(new Set([ref]))).toBe(true);
    store.updateRefs(new Set());
    expect(store.canCommit(new Set([ref]))).toBe(false);
  });

  it("enforces total bytes and stores identical content only once", async () => {
    const { join } = setup();
    const { store } = await join("member-a");
    const refs = new Set<string>();
    for (let value = 0; value < gameFilesTotalBytes / gameFileBytes; value++) {
      const bytes = new Uint8Array(gameFileBytes);
      bytes[0] = value;
      refs.add(await store.put({ bytes: bytes.buffer, mimeType: "" }));
    }
    store.updateRefs(refs);
    await expect(store.put(hello())).rejects.toMatchObject({ code: "file_storage_full" });
    expect(refs.has(await store.put({ bytes: new ArrayBuffer(gameFileBytes), mimeType: "" }))).toBe(
      true,
    );
  });

  it("lets a rejoining player read their turn file ahead of queued gallery files", async () => {
    const { join, deliver } = setup();
    const authority = await join("member-a");
    const put = (text: string) =>
      authority.store.put({ bytes: new TextEncoder().encode(text).buffer, mimeType: "text/plain" });
    const first = await put("first");
    const gallery = await put("gallery");
    const turn = await put("current turn");
    const refs = new Set([first, gallery, turn]);
    authority.store.updateRefs(refs);

    const rejoining = await join("member-b");
    const request = vi.spyOn(rejoining.transport, "request");
    const requestedRefs = () =>
      request.mock.calls.map(([call]) => (call.payload as { ref: string }).ref);
    rejoining.store.updateRefs(refs);
    expect(requestedRefs()).toEqual([first]);

    const readTurn = Promise.all([rejoining.store.get(turn), rejoining.store.get(turn)]).then(
      (results) => {
        for (const result of results)
          expect(new TextDecoder().decode(result.bytes)).toBe("current turn");
        expect(rejoining.store.canCommit(new Set([first, turn]))).toBe(true);
        expect(rejoining.store.canCommit(new Set([gallery]))).toBe(false);
      },
    );
    expect(requestedRefs()).toEqual([first]);

    await Promise.all([deliver(), readTurn]);
    expect(requestedRefs()).toEqual([first, turn, gallery]);
    expect(rejoining.store.canCommit(refs)).toBe(true);
  });

  it("skips a corrupt new authority and fetches from another peer", async () => {
    const { join, deliver, handover } = setup();
    const original = await join("member-a");
    const next = await join("member-b", (transport) => {
      const handle = transport.handleRequest.bind(transport);
      vi.spyOn(transport, "handleRequest").mockImplementation((channel, handler) =>
        handle(channel, channel === "nova.file.get" ? () => new Uint8Array(6) : handler),
      );
    });
    const replica = await join("member-c");
    const ref = await original.store.put(hello());
    for (const peer of [original, next, replica]) peer.store.updateRefs(new Set([ref]));
    await deliver();
    expect(next.store.canCommit(new Set([ref]))).toBe(true);
    expect(replica.store.canCommit(new Set([ref]))).toBe(true);

    await original.transport.leave();
    handover("member-b");
    const late = await join("member-d");
    // A frame can receive its view before its shell finishes accepting the snapshot.
    const download = late.store.get(ref);
    late.store.updateRefs(new Set([ref]));
    await deliver();
    const result = await download;
    expect(result.mimeType).toBe("text/plain");
    expect(new TextDecoder().decode(result.bytes)).toBe("hello");
  });
});
