import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PARTY_CODE_RENEW_MS,
  PartyCodeError,
  PartyCodeLease,
  lookupPartyCode,
  normalizePartyCode,
  phoneticCode,
} from "./party-code";

const challenge = vi.hoisted(() => ({ token: null as string | null }));
vi.mock("./turnstile", () => ({
  turnstileEnabled: true,
  consumeChallengeToken: async (action: string) =>
    action === "code_lookup" ? challenge.token : null,
}));

afterEach(() => vi.unstubAllGlobals());

function fakeSchedule() {
  const timers: Array<{ callback: () => void; delayMs: number; active: boolean }> = [];
  const schedule = (callback: () => void, delayMs: number) => {
    const timer = { callback, delayMs, active: true };
    timers.push(timer);
    return () => {
      timer.active = false;
    };
  };
  const runNext = () => {
    const timer = timers.find((candidate) => candidate.active);
    if (!timer) throw new Error("no timer scheduled");
    timer.active = false;
    timer.callback();
    return timer.delayMs;
  };
  return { schedule, runNext, pending: () => timers.filter((timer) => timer.active).length };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("lookupPartyCode", () => {
  it("sends a code-lookup token and resolves the secret", async () => {
    challenge.token = "lookup-token";
    const fetchMock = vi.fn(async (_path: string, _init: RequestInit) =>
      Response.json({ secret: "s" }),
    );
    vi.stubGlobal("fetch", fetchMock);
    expect(await lookupPartyCode("abcd")).toBe("s");
    const headers = new Headers(fetchMock.mock.calls[0]![1].headers);
    expect(headers.get("X-Turnstile-Token")).toBe("lookup-token");
  });

  it("reports a blocked check without asking the Worker, and a rejected one", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 403 }));
    vi.stubGlobal("fetch", fetchMock);
    challenge.token = null;
    const blocked = await lookupPartyCode("abcd").catch((error: unknown) => error);
    expect(blocked).toBeInstanceOf(PartyCodeError);
    expect((blocked as PartyCodeError).verificationBlocked).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();

    challenge.token = "stale";
    const rejected = await lookupPartyCode("abcd").catch((error: unknown) => error);
    expect((rejected as PartyCodeError).verificationBlocked).toBe(true);
  });
});

describe("party code text", () => {
  it("normalizes typed codes and spells them phonetically", () => {
    expect(normalizePartyCode(" AbCd ")).toBe("abcd");
    expect(normalizePartyCode("abc")).toBeNull();
    expect(normalizePartyCode("ab1d")).toBeNull();
    expect(phoneticCode("rcxq")).toBe("romeo charlie xray quebec");
  });
});

describe("PartyCodeLease", () => {
  it("claims once per secret, renews, and keeps the last code through a failed renewal", async () => {
    const { schedule, runNext } = fakeSchedule();
    const onChange = vi.fn();
    const claim = vi
      .fn<(secret: string) => Promise<string | null>>()
      .mockResolvedValueOnce("abcd")
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce("abcd");
    const lease = new PartyCodeLease(schedule, claim, onChange);

    lease.start("secret");
    lease.start("secret");
    await flush();
    expect(claim).toHaveBeenCalledTimes(1);
    expect(lease.code).toBe("abcd");
    expect(onChange).toHaveBeenCalledTimes(1);

    expect(runNext()).toBe(PARTY_CODE_RENEW_MS);
    await flush();
    expect(lease.code).toBe("abcd");
    // A failed renewal retries sooner than the normal cadence.
    expect(runNext()).toBeLessThan(PARTY_CODE_RENEW_MS);
    await flush();
    expect(claim).toHaveBeenCalledTimes(3);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("stops renewing and clears the code on stop, ignoring a late claim", async () => {
    const { schedule, pending } = fakeSchedule();
    let resolve!: (code: string) => void;
    const lease = new PartyCodeLease(
      schedule,
      () => new Promise((done) => (resolve = done)),
      vi.fn(),
    );
    lease.start("secret");
    lease.stop();
    resolve("abcd");
    await flush();
    expect(lease.code).toBeNull();
    expect(pending()).toBe(0);
  });

  it("does nothing without a claim function", () => {
    const { schedule, pending } = fakeSchedule();
    const lease = new PartyCodeLease(schedule, null, vi.fn());
    lease.start("secret");
    expect(pending()).toBe(0);
    expect(lease.code).toBeNull();
  });
});
