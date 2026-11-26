import { afterEach, describe, expect, it, vi } from "vitest";
import { actionTimeoutMs, gameBytesBurst, gameFilesTotalBytes } from "@rocketcrab/protocol";
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
    const store = new GameFiles(transport, "game", () => authority);
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
    async deliver(ms = 0) {
      for (let step = 0; step < 8; step++) {
        harness.drain();
        await vi.advanceTimersByTimeAsync(ms / 8);
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

  it("enforces total bytes, counting headers, and stores identical content only once", async () => {
    const { join } = setup();
    const { store } = await join("member-a");
    // Each file also costs its 37-byte batch header (no MIME type here).
    const half = gameFilesTotalBytes / 2 - 37;
    const refs = new Set<string>();
    for (const value of [1, 2]) {
      const bytes = new Uint8Array(half);
      bytes[0] = value;
      refs.add(await store.put({ bytes: bytes.buffer, mimeType: "" }));
    }
    store.updateRefs(refs);
    await expect(store.put({ bytes: new ArrayBuffer(0), mimeType: "" })).rejects.toMatchObject({
      code: "file_storage_full",
    });
    const again = new Uint8Array(half);
    again[0] = 1;
    expect(refs.has(await store.put({ bytes: again.buffer, mimeType: "" }))).toBe(true);
  });

  it("replicates hundreds of files to a late joiner in a few batches", async () => {
    const { join, deliver } = setup();
    const authority = await join("member-a");
    const refs = new Set<string>();
    for (let value = 0; value < 400; value++)
      refs.add(
        await authority.store.put({
          bytes: new TextEncoder().encode(`drawing ${value}`).buffer,
          mimeType: "image/svg+xml",
        }),
      );
    authority.store.updateRefs(refs);
    const late = await join("member-b");
    const request = vi.spyOn(late.transport, "request");
    late.store.updateRefs(refs);
    await deliver();
    expect(late.store.canCommit(refs)).toBe(true);
    // About 190 refs fit in one request.
    expect(request.mock.calls.map(([call]) => call.channel)).toEqual(
      Array(3).fill("nova.file.sync"),
    );
  });

  it("fetches a file the game waits on directly while a batch is in flight", async () => {
    const { join, deliver } = setup();
    const authority = await join("member-a");
    const put = (text: string) =>
      authority.store.put({ bytes: new TextEncoder().encode(text).buffer, mimeType: "text/plain" });
    const gallery = new Set([await put("first"), await put("second")]);
    authority.store.updateRefs(gallery);
    const rejoining = await join("member-b");
    const request = vi.spyOn(rejoining.transport, "request");
    rejoining.store.updateRefs(gallery);

    const turn = await put("current turn");
    const refs = new Set([...gallery, turn]);
    authority.store.updateRefs(refs);
    rejoining.store.updateRefs(refs);
    const read = rejoining.store.get(turn);
    expect(request.mock.calls.map(([call]) => [call.channel, call.payload])).toEqual([
      ["nova.file.sync", { gameId: "game", refs: [...gallery] }],
      ["nova.file.get", { gameId: "game", ref: turn }],
    ]);
    await deliver();
    expect(new TextDecoder().decode((await read).bytes)).toBe("current turn");
    expect(rejoining.store.canCommit(refs)).toBe(true);
  });

  it("reads files from an older peer that can't send batches", async () => {
    const { join, deliver } = setup();
    const older = await join("member-a", (transport) => {
      const handle = transport.handleRequest.bind(transport);
      vi.spyOn(transport, "handleRequest").mockImplementation((channel, handler) =>
        channel === "nova.file.sync" ? () => {} : handle(channel, handler),
      );
    });
    const ref = await older.store.put(hello());
    older.store.updateRefs(new Set([ref]));
    const late = await join("member-b");
    late.store.updateRefs(new Set([ref]));
    const read = late.store.get(ref);
    await deliver();
    expect(new TextDecoder().decode((await read).bytes)).toBe("hello");
  });

  it("uploads a file larger than the burst, then waits out the debt for the next", async () => {
    const { join, deliver } = setup();
    const authority = await join("member-a");
    const sender = await join("member-b");
    const big = new Uint8Array(gameBytesBurst + 512 * 1024);
    let second = false;
    const uploads = Promise.all([
      sender.store.put({ bytes: big.buffer, mimeType: "" }),
      sender.store.put(hello()).then((ref) => ((second = true), ref)),
    ]);
    await deliver();
    expect(second).toBe(false);
    await deliver(4_000);
    const [bigRef, helloRefStored] = await uploads;
    expect(authority.store.canCommit(new Set([bigRef, helloRefStored]))).toBe(true);
  });

  it("skips a corrupt new authority and fetches from another peer", async () => {
    const { join, deliver, handover } = setup();
    const original = await join("member-a");
    const next = await join("member-b", (transport) => {
      const handle = transport.handleRequest.bind(transport);
      vi.spyOn(transport, "handleRequest").mockImplementation((channel, handler) =>
        handle(
          channel,
          channel === "nova.file.get" || channel === "nova.file.sync"
            ? () => new Uint8Array(6)
            : handler,
        ),
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
