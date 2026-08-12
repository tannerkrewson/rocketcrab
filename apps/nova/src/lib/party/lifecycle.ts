/**
 * Party-engine page-lifecycle wiring (M1; ADR-0012, Blocker Register B6).
 *
 * Mobile Safari suspends background pages: timers stop, WebRTC connections
 * die, and the page may be frozen (or, in the extreme, reloaded). The shell
 * must react to the events the browser actually offers — `visibilitychange`,
 * `pagehide`/`pageshow`, and `online`/`offline` — rather than assuming
 * timers or connections survive backgrounding.
 *
 * This module defines the small event surface the party engine subscribes
 * to, plus two implementations:
 * - {@link browserLifecycleSource} — production wiring on `window`/`document`
 *   (every subscription returns an unsubscribe; the engine never leaves
 *   listeners behind, engineering rule 22);
 * - {@link createMemoryLifecycleSource} — a deterministic in-memory source
 *   for unit tests (fake lifecycle events, no timers, no DOM dependence).
 */

/** The page-lifecycle events the party engine reacts to. */
export interface PartyLifecycleSource {
  /** The document became hidden/visible (`visibilitychange`). */
  onVisibilityChange(handler: (hidden: boolean) => void): () => void;
  /** The page is being hidden (backgrounding / freeze / unload). */
  onPageHide(handler: () => void): () => void;
  /** The page came back (BFCache restore, foreground, or fresh load). */
  onPageShow(handler: () => void): () => void;
  /** The browser reports the network came back (`online`). */
  onOnline(handler: () => void): () => void;
  /** The browser reports the network went away (`offline`). */
  onOffline(handler: () => void): () => void;
}

/** Production lifecycle wiring on the browser's window/document events. */
export function browserLifecycleSource(): PartyLifecycleSource {
  const visibilityHandlers = new Set<(hidden: boolean) => void>();
  const pageHideHandlers = new Set<() => void>();
  const pageShowHandlers = new Set<() => void>();
  const onlineHandlers = new Set<() => void>();
  const offlineHandlers = new Set<() => void>();

  const onVisibilityChange = (): void => {
    const hidden = typeof document !== "undefined" ? document.hidden : false;
    for (const handler of visibilityHandlers) {
      handler(hidden);
    }
  };
  const onPageHide = (): void => {
    for (const handler of pageHideHandlers) {
      handler();
    }
  };
  const onPageShow = (): void => {
    for (const handler of pageShowHandlers) {
      handler();
    }
  };
  const onOnline = (): void => {
    for (const handler of onlineHandlers) {
      handler();
    }
  };
  const onOffline = (): void => {
    for (const handler of offlineHandlers) {
      handler();
    }
  };

  // The party engine outlives routes (one per page), so these listeners are
  // installed once for the page lifetime; each individual subscription still
  // returns an unsubscribe (rule 22).
  if (typeof window !== "undefined") {
    window.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("pageshow", onPageShow);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
  }

  return {
    onVisibilityChange(handler) {
      visibilityHandlers.add(handler);
      return () => {
        visibilityHandlers.delete(handler);
      };
    },
    onPageHide(handler) {
      pageHideHandlers.add(handler);
      return () => {
        pageHideHandlers.delete(handler);
      };
    },
    onPageShow(handler) {
      pageShowHandlers.add(handler);
      return () => {
        pageShowHandlers.delete(handler);
      };
    },
    onOnline(handler) {
      onlineHandlers.add(handler);
      return () => {
        onlineHandlers.delete(handler);
      };
    },
    onOffline(handler) {
      offlineHandlers.add(handler);
      return () => {
        offlineHandlers.delete(handler);
      };
    },
  };
}

/** In-memory lifecycle source with explicit emit helpers (deterministic). */
export interface MemoryLifecycle {
  readonly source: PartyLifecycleSource;
  /** The page went to the background (visibility hidden + pagehide). */
  hide(): void;
  /** The page came back to the foreground (pageshow + visibility visible). */
  show(): void;
  goOnline(): void;
  goOffline(): void;
}

/** Deterministic lifecycle source for unit tests (no DOM, no timers). */
export function createMemoryLifecycleSource(): MemoryLifecycle {
  const visibilityHandlers = new Set<(hidden: boolean) => void>();
  const pageHideHandlers = new Set<() => void>();
  const pageShowHandlers = new Set<() => void>();
  const onlineHandlers = new Set<() => void>();
  const offlineHandlers = new Set<() => void>();

  const source: PartyLifecycleSource = {
    onVisibilityChange(handler) {
      visibilityHandlers.add(handler);
      return () => {
        visibilityHandlers.delete(handler);
      };
    },
    onPageHide(handler) {
      pageHideHandlers.add(handler);
      return () => {
        pageHideHandlers.delete(handler);
      };
    },
    onPageShow(handler) {
      pageShowHandlers.add(handler);
      return () => {
        pageShowHandlers.delete(handler);
      };
    },
    onOnline(handler) {
      onlineHandlers.add(handler);
      return () => {
        onlineHandlers.delete(handler);
      };
    },
    onOffline(handler) {
      offlineHandlers.add(handler);
      return () => {
        offlineHandlers.delete(handler);
      };
    },
  };

  return {
    source,
    hide() {
      for (const handler of pageHideHandlers) {
        handler();
      }
      for (const handler of visibilityHandlers) {
        handler(true);
      }
    },
    show() {
      for (const handler of pageShowHandlers) {
        handler();
      }
      for (const handler of visibilityHandlers) {
        handler(false);
      }
    },
    goOnline() {
      for (const handler of onlineHandlers) {
        handler();
      }
    },
    goOffline() {
      for (const handler of offlineHandlers) {
        handler();
      }
    },
  };
}
