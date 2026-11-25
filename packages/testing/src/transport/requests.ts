import type {
  NovaTransport,
  TransportRequestHandler,
  TransportRequestOptions,
  TransportMessage,
} from "@rocketcrab/core";

/** In-memory counterpart of Trystero request actions. Test/arena only: uses the
 * hub's fault-injected send/chunk/progress path, with no retries/reliability shim.
 */
export class MemoryRequests {
  private readonly handlers = new Map<string, TransportRequestHandler>();
  private readonly pending = new Map<
    string,
    {
      options: TransportRequestOptions;
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      dispose: () => void;
    }
  >();
  private readonly incoming = new Map<
    string,
    { connection: string; controller: AbortController }
  >();
  private readonly unsubscribers: Array<() => void>;
  constructor(private readonly transport: NovaTransport) {
    this.unsubscribers = [
      transport.on("message:received", (message) => {
        void this.receive(message);
      }),
      transport.on("transfer:progress", (progress) => {
        const id = progress.channel.startsWith("@nova.r:") ? progress.channel.slice(8) : "";
        this.pending.get(id)?.options.onProgress?.(progress.fraction);
      }),
      transport.on("peer:left", (peer) => this.cancel(peer.connectionId)),
      transport.on("connection:state", (state) => {
        if (state !== "connected") this.cancel();
      }),
    ];
  }
  handle(channel: string, handler: TransportRequestHandler): () => void {
    if (this.handlers.has(channel)) throw new Error("Request handler already registered.");
    this.handlers.set(channel, handler);
    return () => {
      if (this.handlers.get(channel) === handler) this.handlers.delete(channel);
    };
  }
  request(options: TransportRequestOptions): Promise<unknown> {
    if (
      this.transport.connectionState !== "connected" ||
      !this.transport.peers.some((p) => p.connectionId === options.targetConnectionId)
    )
      return Promise.reject(new Error("Peer disconnected."));
    if (options.signal?.aborted) return Promise.reject(new Error("Request aborted."));
    if (this.pending.size >= 32) return Promise.reject(new Error("Too many requests."));
    if (!/^[a-zA-Z0-9._-]{1,23}$/.test(options.channel))
      return Promise.reject(new Error("Invalid request channel."));
    if (
      [...this.pending.values()].some(
        (p) =>
          p.options.channel === options.channel &&
          p.options.targetConnectionId === options.targetConnectionId,
      )
    )
      return Promise.reject(new Error("A request to this peer/channel is already active."));
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const fail = (error: Error) => {
        const pending = this.pending.get(id);
        if (!pending) return;
        this.pending.delete(id);
        pending.dispose();
        reject(error);
      };
      const timer = setTimeout(
        () => fail(new Error("Request timed out.")),
        options.timeoutMs ?? 120_000,
      );
      const abort = () => fail(new Error("Request aborted."));
      options.signal?.addEventListener("abort", abort, { once: true });
      this.pending.set(id, {
        options,
        resolve,
        reject: fail,
        dispose: () => {
          clearTimeout(timer);
          options.signal?.removeEventListener("abort", abort);
        },
      });
      void this.transport
        .send({
          channel: "@nova.q",
          targetConnectionId: options.targetConnectionId,
          payload: { id, channel: options.channel, payload: options.payload },
        })
        .catch((error) => fail(error instanceof Error ? error : new Error("Request failed.")));
    });
  }
  private async receive(message: TransportMessage): Promise<void> {
    if (message.channel.startsWith("@nova.r:") || message.channel.startsWith("@nova.e:")) {
      const id = message.channel.slice(8);
      const pending = this.pending.get(id);
      if (!pending || pending.options.targetConnectionId !== message.senderConnectionId) return;
      const bytes =
        message.payload instanceof Uint8Array
          ? message.payload.byteLength
          : new TextEncoder().encode(JSON.stringify(message.payload)).byteLength;
      if (
        message.channel.startsWith("@nova.e:") ||
        bytes > (pending.options.maxResponseBytes ?? 2 * 1024 * 1024)
      ) {
        pending.reject(new Error("Request rejected or response exceeded the receive limit."));
        return;
      }
      this.pending.delete(id);
      pending.dispose();
      pending.options.onProgress?.(1);
      pending.resolve(message.payload);
      return;
    }
    if (message.channel !== "@nova.q" || !message.payload || typeof message.payload !== "object")
      return;
    const request = message.payload as { id?: unknown; channel?: unknown; payload?: unknown };
    if (
      typeof request.id !== "string" ||
      request.id.length > 64 ||
      typeof request.channel !== "string" ||
      this.incoming.has(request.id)
    )
      return;
    const handler = this.handlers.get(request.channel);
    const controller = new AbortController();
    this.incoming.set(request.id, { connection: message.senderConnectionId, controller });
    let response: unknown,
      error = false;
    try {
      if (
        !handler ||
        this.incoming.size > 32 ||
        new TextEncoder().encode(JSON.stringify(request.payload)).byteLength > 16 * 1024
      )
        throw new Error("Rejected request.");
      response = await handler(request.payload, {
        senderMemberId: message.senderMemberId,
        senderConnectionId: message.senderConnectionId,
        signal: controller.signal,
      });
      if (response === undefined) throw new Error("Request handler returned undefined.");
    } catch {
      error = true;
      response = "Request rejected.";
    }
    this.incoming.delete(request.id);
    if (controller.signal.aborted || this.transport.connectionState !== "connected") return;
    try {
      await this.transport.send({
        channel: `@nova.${error ? "e" : "r"}:${request.id}`,
        payload: response,
        binary: response instanceof Uint8Array,
        targetConnectionId: message.senderConnectionId,
      });
    } catch {
      /* a peer disconnect aborts the corresponding request */
    }
  }
  private cancel(connection?: string): void {
    for (const pending of this.pending.values())
      if (connection === undefined || pending.options.targetConnectionId === connection)
        pending.reject(new Error("Peer disconnected."));
    for (const [id, entry] of this.incoming)
      if (connection === undefined || entry.connection === connection) {
        entry.controller.abort();
        this.incoming.delete(id);
      }
  }
  dispose(): void {
    this.cancel();
    for (const unsubscribe of this.unsubscribers) unsubscribe();
    this.handlers.clear();
  }
}
