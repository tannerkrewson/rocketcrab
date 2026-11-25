import { afterEach, describe, expect, it, vi } from "vitest";
import { SignalingOutage } from "./signaling-outage";

const schedule = (callback: () => void, delay: number) => {
  const timer = setTimeout(callback, delay);
  return () => clearTimeout(timer);
};

afterEach(() => vi.useRealTimers());

describe("signaling outage", () => {
  it("warns only after five continuous seconds and clears on recovery", () => {
    vi.useFakeTimers();
    const changed = vi.fn();
    const outage = new SignalingOutage(schedule, changed);
    outage.update(false);
    vi.advanceTimersByTime(4_999);
    expect(changed).not.toHaveBeenCalled();
    outage.update(false);
    vi.advanceTimersByTime(1);
    expect(changed).toHaveBeenCalledExactlyOnceWith(true);
    outage.update(true);
    expect(changed).toHaveBeenLastCalledWith(false);
    outage.update(true);
    expect(changed).toHaveBeenCalledTimes(2);
  });

  it("cancels short outages and resets on cleanup", () => {
    vi.useFakeTimers();
    const changed = vi.fn();
    const outage = new SignalingOutage(schedule, changed);
    outage.update(false);
    vi.advanceTimersByTime(4_999);
    outage.update(true);
    outage.update(false);
    vi.advanceTimersByTime(4_999);
    expect(changed).not.toHaveBeenCalled();
    outage.reset();
    vi.advanceTimersByTime(10_000);
    expect(changed).not.toHaveBeenCalled();
  });
});
