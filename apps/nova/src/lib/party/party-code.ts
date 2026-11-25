/**
 * Four-letter party codes (`rocketcrab.com/abcd`). The Worker maps a code to
 * the party's invite secret while the host keeps renewing it. A claim is
 * idempotent, so other members claim once to learn the code and the party
 * protocol carries nothing extra.
 */
import type { Scheduler } from "@rocketcrab/party";
import { consumeChallengeToken, turnstileEnabled } from "./turnstile";

/** The host renews well inside the Worker's 10-minute lease. */
export const PARTY_CODE_RENEW_MS = 3 * 60 * 1000;
const RETRY_MS = 30 * 1000;
const TIMEOUT_MS = 5_000;

/** Claim (or renew) this party's code; null when none is available. */
export type ClaimPartyCode = (secret: string) => Promise<string | null>;

/** Lowercase a typed code; null unless it is exactly four letters. */
export function normalizePartyCode(input: string): string | null {
  const code = input.trim().toLowerCase();
  return /^[a-z]{4}$/.test(code) ? code : null;
}

/** The short link a code opens, on this deployment's origin. */
export function partyCodeUrl(code: string): string {
  return `${window.location.origin}/${code}`;
}

/** NATO spelling, for reading a code aloud: "abcd" → "alpha bravo charlie delta". */
export function phoneticCode(code: string): string {
  return [...code].map((letter) => NATO[letter] ?? letter).join(" ");
}

const NATO: Readonly<Record<string, string>> = {
  a: "alpha",
  b: "bravo",
  c: "charlie",
  d: "delta",
  e: "echo",
  f: "foxtrot",
  g: "golf",
  h: "hotel",
  i: "india",
  j: "juliett",
  k: "kilo",
  l: "lima",
  m: "mike",
  n: "november",
  o: "oscar",
  p: "papa",
  q: "quebec",
  r: "romeo",
  s: "sierra",
  t: "tango",
  u: "uniform",
  v: "victor",
  w: "whiskey",
  x: "xray",
  y: "yankee",
  z: "zulu",
};

async function postCode(
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (response.status === 404) return null;
    if (!response.ok) throw new PartyCodeError(response.status);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

export class PartyCodeError extends Error {
  constructor(readonly status: number) {
    super(`Party code request failed with HTTP ${status}.`);
  }

  /** The browser or network blocked the Turnstile check a lookup needs. */
  get verificationBlocked(): boolean {
    return this.status === 403;
  }
}

export const claimPartyCode: ClaimPartyCode = async (secret) => {
  const body = (await postCode("/api/code/claim", { secret })) as { code?: unknown } | null;
  return typeof body?.code === "string" ? body.code : null;
};

/**
 * The secret behind a live code, or null when no party has it. Throws on
 * network failure, or a `PartyCodeError` with `verificationBlocked`.
 */
export async function lookupPartyCode(code: string): Promise<string | null> {
  const token = await consumeChallengeToken("code_lookup");
  if (turnstileEnabled && !token) throw new PartyCodeError(403);
  const body = (await postCode(
    "/api/code/lookup",
    { code },
    token ? { "X-Turnstile-Token": token } : {},
  )) as { secret?: unknown } | null;
  return typeof body?.secret === "string" ? body.secret : null;
}

/**
 * This member's view of the party code. The host renews it; everyone else
 * claims until they know it, then stops, so requests don't grow with party
 * size. A failed renewal keeps showing the last code (it outlives a few
 * missed renewals) and retries sooner. A new host takes over at once.
 */
export class PartyCodeLease {
  code: string | null = null;
  private secret: string | null = null;
  private renewing = false;
  /** Bumped per claim, so only the latest claim schedules the next one. */
  private generation = 0;
  private cancelTimer: (() => void) | null = null;

  constructor(
    private readonly schedule: Scheduler,
    private readonly claim: ClaimPartyCode | null,
    private readonly onChange: () => void,
  ) {}

  start(secret: string, renew: boolean): void {
    if (this.claim === null) return;
    if (this.secret === secret) return this.setRenewing(renew);
    this.stop();
    this.secret = secret;
    this.renewing = renew;
    void this.claimNow();
  }

  /** True while this member is the host. */
  setRenewing(renew: boolean): void {
    if (this.secret === null || renew === this.renewing) return;
    this.renewing = renew;
    if (renew) {
      void this.claimNow();
    } else {
      this.cancel();
      this.scheduleNext();
    }
  }

  stop(): void {
    this.secret = null;
    this.renewing = false;
    this.cancel();
    if (this.code !== null) {
      this.code = null;
      this.onChange();
    }
  }

  private cancel(): void {
    this.generation++;
    this.cancelTimer?.();
    this.cancelTimer = null;
  }

  private async claimNow(): Promise<void> {
    this.cancel();
    const { generation, secret } = this;
    let code: string | null;
    try {
      code = await this.claim!(secret!);
    } catch {
      code = null;
    }
    if (this.generation !== generation) return;
    if (code !== null && code !== this.code) {
      this.code = code;
      this.onChange();
    }
    this.scheduleNext(code === null);
  }

  private scheduleNext(failed = this.code === null): void {
    if (!this.renewing && this.code !== null) return;
    const generation = this.generation;
    this.cancelTimer = this.schedule(
      () => {
        if (this.generation === generation) void this.claimNow();
      },
      failed ? RETRY_MS : PARTY_CODE_RENEW_MS,
    );
  }
}
