/**
 * Mobile Safari may freeze timers, kill WebRTC, or reload a background page.
 * Drive recovery from visibility, page, and network events rather
 * than assuming connections survive. Browser and in-memory implementations
 * share an event surface; every subscription returns a cleanup function.
 */

export interface PartyLifecycleSource {
  /** The document became hidden/visible (`visibilitychange`). */
  onVisibilityChange(handler: (hidden: boolean) => void): () => void;
  /** The page is being hidden (backgrounding / freeze / unload). */
  onPageHide(handler: () => void): () => void;
  /** The page came back (BFCache restore, foreground, or fresh load). */
  onPageShow(handler: () => void): () => void;
  onOnline(handler: () => void): () => void;
  onOffline(handler: () => void): () => void;
}

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

  // The party engine outlives routes, so browser listeners live for the page;
  // individual engine subscriptions still return cleanup functions.
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
