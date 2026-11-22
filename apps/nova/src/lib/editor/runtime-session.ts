import { useCallback, useEffect, useRef, useState } from "react";
import {
  RuntimeHostClient,
  type ChannelPort,
  type LoadGameInput,
  type RuntimeHostEvent,
  type RuntimeHostOptions,
} from "../runtime-host";

/** Each Run destroys and recreates the runtime frame and its bridge channel; never HMR. */

export type RuntimeStatus = "idle" | "starting" | "running" | "stopped" | "failed";

export interface RuntimeSessionOptions {
  /** Full origin of the runtime app (dev: http://localhost:2723). */
  runtimeOrigin: string;
  /** Container for the hidden diagnostics runtime. */
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** Event sink for validated runtime-plane events (diagnostics). */
  onEvent: (event: RuntimeHostEvent) => void;
  /** Test seams, forwarded to RuntimeHostClient. */
  createChannel?: () => { port1: ChannelPort; port2: unknown };
  waitForFrameLoad?: (iframe: HTMLIFrameElement) => Promise<void>;
  bootstrapTimeoutMs?: number;
}

export function useRuntimeSession(options: RuntimeSessionOptions) {
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const clientRef = useRef<RuntimeHostClient | null>(null);
  const clientContainerRef = useRef<HTMLElement | null>(null);
  const [status, setStatus] = useState<RuntimeStatus>("idle");

  /** Rebind when the container changes, disposing the previous client and frame. */
  const ensureClient = useCallback((container: HTMLElement) => {
    const existing = clientRef.current;
    if (existing && clientContainerRef.current === container) return existing;
    if (existing) existing.dispose();
    const hostOptions: RuntimeHostOptions = {
      runtimeOrigin: optionsRef.current.runtimeOrigin,
      container,
      onEvent: (event) => optionsRef.current.onEvent(event),
      ...(optionsRef.current.createChannel !== undefined
        ? { createChannel: optionsRef.current.createChannel }
        : {}),
      ...(optionsRef.current.waitForFrameLoad !== undefined
        ? { waitForFrameLoad: optionsRef.current.waitForFrameLoad }
        : {}),
      ...(optionsRef.current.bootstrapTimeoutMs !== undefined
        ? { bootstrapTimeoutMs: optionsRef.current.bootstrapTimeoutMs }
        : {}),
    };
    const client = new RuntimeHostClient(hostOptions);
    clientRef.current = client;
    clientContainerRef.current = container;
    return client;
  }, []);

  /**
   * Run the given source in a completely fresh runtime frame: tear the old
   * frame down first, then bootstrap. Resolves once the runtime reports
   * ready; rejects on bootstrap/startup failure (callers surface the error
   * as a "runtime startup" diagnostic).
   */
  const run = useCallback(
    async (game: LoadGameInput) => {
      const container = optionsRef.current.containerRef.current ?? document.body;
      const client = ensureClient(container);
      client.destroy("host_closed");
      setStatus("starting");
      try {
        await client.load(game);
        setStatus("running");
      } catch (error) {
        setStatus("failed");
        throw error;
      }
    },
    [ensureClient],
  );

  const stop = useCallback(() => {
    clientRef.current?.destroy("user_exit");
    setStatus("stopped");
  }, []);

  const diagnose = useCallback(() => clientRef.current?.diagnose() ?? null, []);

  useEffect(() => {
    return () => clientRef.current?.dispose();
  }, []);

  return { status, run, stop, diagnose };
}
