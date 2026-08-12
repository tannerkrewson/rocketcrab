import { describe, expect, it } from "vitest";
import { createMemoryLifecycleSource } from "./lifecycle";

/**
 * M1 lifecycle-source tests: the deterministic in-memory source fires the
 * same events the browser source wires to (visibilitychange, pagehide,
 * pageshow, online, offline), and every subscription returns an
 * unsubscribe (engineering rule 22).
 */
describe("party lifecycle source", () => {
  it("emits hide and show with the visibility flag, in browser order", () => {
    const memory = createMemoryLifecycleSource();
    const events: string[] = [];
    memory.source.onVisibilityChange((hidden) =>
      events.push(hidden ? "visibility-hidden" : "visibility-visible"),
    );
    memory.source.onPageHide(() => events.push("pagehide"));
    memory.source.onPageShow(() => events.push("pageshow"));

    memory.hide();
    expect(events).toEqual(["pagehide", "visibility-hidden"]);
    memory.show();
    expect(events).toEqual(["pagehide", "visibility-hidden", "pageshow", "visibility-visible"]);
  });

  it("emits online and offline", () => {
    const memory = createMemoryLifecycleSource();
    const events: string[] = [];
    memory.source.onOnline(() => events.push("online"));
    memory.source.onOffline(() => events.push("offline"));
    memory.goOffline();
    memory.goOnline();
    expect(events).toEqual(["offline", "online"]);
  });

  it("unsubscribe removes the handler", () => {
    const memory = createMemoryLifecycleSource();
    const events: string[] = [];
    const unsubscribe = memory.source.onVisibilityChange((hidden) =>
      events.push(hidden ? "hidden" : "visible"),
    );
    unsubscribe();
    memory.hide();
    memory.show();
    expect(events).toEqual([]);
  });
});
