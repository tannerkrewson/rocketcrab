/**
 * Four-letter party codes (`rocketcrab.com/abcd`). The Worker maps a code to
 * the party's invite secret while members keep renewing it; every member
 * derives the same code, so the party protocol carries nothing extra.
 */
import type { Scheduler } from "@rocketcrab/party";

/** Members renew well inside the Worker's 10-minute lease. */
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

async function postCode(path: string, body: unknown): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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
}

export const claimPartyCode: ClaimPartyCode = async (secret) => {
  const body = (await postCode("/api/code/claim", { secret })) as { code?: unknown } | null;
  return typeof body?.code === "string" ? body.code : null;
};

/** The secret behind a live code, or null when no party has it. Throws on network failure. */
export async function lookupPartyCode(code: string): Promise<string | null> {
  const body = (await postCode("/api/code/lookup", { code })) as { secret?: unknown } | null;
  return typeof body?.secret === "string" ? body.secret : null;
}

/**
 * Keeps this member's party code claimed while it is in the party. A failed
 * renewal keeps showing the last code (it outlives a few missed renewals)
 * and retries sooner.
 */
export class PartyCodeLease {
  code: string | null = null;
  private secret: string | null = null;
  private cancelTimer: (() => void) | null = null;

  constructor(
    private readonly schedule: Scheduler,
    private readonly claim: ClaimPartyCode | null,
    private readonly onChange: () => void,
  ) {}

  start(secret: string): void {
    if (this.claim === null || this.secret === secret) return;
    this.stop();
    this.secret = secret;
    void this.renew(secret);
  }

  stop(): void {
    this.secret = null;
    this.cancelTimer?.();
    this.cancelTimer = null;
    if (this.code !== null) {
      this.code = null;
      this.onChange();
    }
  }

  private async renew(secret: string): Promise<void> {
    let code: string | null;
    try {
      code = await this.claim!(secret);
    } catch {
      code = null;
    }
    if (this.secret !== secret) return;
    if (code !== null && code !== this.code) {
      this.code = code;
      this.onChange();
    }
    this.cancelTimer = this.schedule(
      () => void this.renew(secret),
      code === null ? RETRY_MS : PARTY_CODE_RENEW_MS,
    );
  }
}
