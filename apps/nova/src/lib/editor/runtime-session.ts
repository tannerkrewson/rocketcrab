import { useCallback, useEffect, useRef, useState } from "react";
import {
  RuntimeHostClient,
  type ChannelPort,
  type LoadGameInput,
  type RuntimeHostEvent,
  type RuntimeHostOptions,
} from "../runtime-host";

/**
 * React binding around U3's RuntimeHostClient for the U4 editor. Every Run
 * completely destroys and recreates the runtime frame (issue U4: no
 * hot-module replacement): the session tears the previous frame down before
 * bootstrapping the new source, and the underlying bridge always starts a
 * fresh runtime instance on a fresh channel.
 */

export type RuntimeStatus = "idle" | "starting" | "running" | "stopped" | "failed";

export interface RuntimeSessionOptions {
  /** Full origin of the runtime app (dev: http://localhost:5174). */
  runtimeOrigin: string;
  /** Element that hosts the runtime iframe (the preview panel's container). */
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

  /**
   * Create (or reuse) a host client bound to the given container. The editor
   * has two preview spots (desktop column and the phone preview tab); when
   * the active spot changes, the old client is disposed so the next run
   * embeds its frame in the currently visible container.
   */
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

  /** Stop the current run: destroy the frame and return to idle. */
  const stop = useCallback(() => {
    clientRef.current?.destroy("user_exit");
    setStatus("stopped");
  }, []);

  /** Latest host-bridge diagnostic snapshot (runtime instance id etc.). */
  const diagnose = useCallback(() => clientRef.current?.diagnose() ?? null, []);

  // Never leak a live runtime frame: dispose the bridge on unmount.
  useEffect(() => {
    return () => clientRef.current?.dispose();
  }, []);

  return { status, run, stop, diagnose };
}
