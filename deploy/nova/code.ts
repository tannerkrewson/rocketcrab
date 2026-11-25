/**
 * Four-letter party codes: `rocketcrab.com/abcd` resolves to a party's invite
 * secret. One PartyCode Durable Object per code holds the secret while members
 * keep renewing it, so the Worker learns the secret of every party that shows
 * a code. Invite links and QR codes never come through here.
 */
import { json, jsonError, readBodyText, type ObjectNamespace } from "./http";

export interface CodeEnv {
  PARTY_CODE?: ObjectNamespace;
}

interface Entry {
  secret: string;
  expiresAt: number;
}

interface CodeState {
  storage: {
    get<T>(key: string): Promise<T | undefined>;
    put(key: string, value: unknown): Promise<void>;
    deleteAll(): Promise<void>;
    setAlarm(time: number): Promise<void>;
  };
}

/** Members renew every few minutes; a code lapses this long after the last renewal. */
export const CODE_TTL_MS = 10 * 60 * 1000;
// No i, o or l: they read and type like 1, 0 and each other.
const ALPHABET = "abcdefghjkmnpqrstuvwxyz";
const CODE_SPACE = ALPHABET.length ** 4;
// Words a party should never be handed, plus names a future route may want.
const BLOCKED = new Set([
  "anus",
  "arse",
  "butt",
  "crap",
  "cums",
  "cunt",
  "damn",
  "dumb",
  "dyke",
  "fagg",
  "fags",
  "fcuk",
  "fuck",
  "fukk",
  "fuks",
  "fvck",
  "japs",
  "jerk",
  "kunt",
  "kyke",
  "nazy",
  "nude",
  "phuk",
  "rape",
  "scum",
  "sexx",
  "sexy",
  "spaz",
  "tard",
  "turd",
  "twat",
  "wank",
  "game",
  "help",
  "join",
  "play",
]);
const SECRET = /^[A-Za-z0-9_-]{43}$/;
const CODE = /^[a-z]{4}$/;
const REQUEST_BYTES = 256;
const encoder = new TextEncoder();

/**
 * Up to eight codes derived from the secret, in claim order. Every member
 * derives the same list, so they all land on the same code.
 */
export async function codeCandidates(secret: string): Promise<string[]> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    encoder.encode(`nova-party-code\0${secret}`),
  );
  const words = new DataView(digest);
  const codes: string[] = [];
  for (let offset = 0; offset < digest.byteLength; offset += 4) {
    let index = words.getUint32(offset) % CODE_SPACE;
    let code = "";
    for (let i = 0; i < 4; i++) {
      code = ALPHABET[index % ALPHABET.length] + code;
      index = Math.floor(index / ALPHABET.length);
    }
    if (!BLOCKED.has(code) && !codes.includes(code)) codes.push(code);
  }
  return codes;
}

/** Holds one code's secret until it expires. */
export class PartyCode {
  constructor(private readonly state: CodeState) {}

  async fetch(request: Request): Promise<Response> {
    const entry = await this.liveEntry();
    if (request.method === "GET") {
      return entry ? new Response(entry.secret) : new Response(null, { status: 404 });
    }
    const secret = await request.text();
    if (entry && entry.secret !== secret) return new Response(null, { status: 409 });
    const expiresAt = Date.now() + CODE_TTL_MS;
    await this.state.storage.put("entry", { secret, expiresAt } satisfies Entry);
    await this.state.storage.setAlarm(expiresAt);
    return new Response(null, { status: 204 });
  }

  async alarm(): Promise<void> {
    const entry = await this.liveEntry();
    if (entry) await this.state.storage.setAlarm(entry.expiresAt);
    else await this.state.storage.deleteAll();
  }

  private async liveEntry(): Promise<Entry | null> {
    const entry = await this.state.storage.get<Entry>("entry");
    return entry && entry.expiresAt > Date.now() ? entry : null;
  }
}

async function readFields(request: Request): Promise<Record<string, unknown>> {
  try {
    const body: unknown = JSON.parse(await readBodyText(request.body, REQUEST_BYTES));
    return typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  } catch {
    // Oversized, non-UTF-8 or non-JSON bodies.
    return {};
  }
}

function text(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function stub(env: CodeEnv, code: string) {
  return env.PARTY_CODE!.get(env.PARTY_CODE!.idFromName(code));
}

function unavailable(): Response {
  console.error({ event: "code_binding_missing" });
  return jsonError(503, "unavailable", "party codes unavailable");
}

/** `{secret}` → `{code}`: claim or renew this party's code. */
export async function handleCodeClaim(request: Request, env: CodeEnv): Promise<Response> {
  const secret = text((await readFields(request)).secret);
  if (secret === null || !SECRET.test(secret)) {
    return jsonError(400, "invalid_secret", "secret must be a party secret");
  }
  if (!env.PARTY_CODE) return unavailable();
  for (const code of await codeCandidates(secret)) {
    const response = await stub(env, code).fetch(
      new Request("https://party-code/", { method: "PUT", body: secret }),
    );
    if (response.status === 204) return json(200, { code });
  }
  return jsonError(503, "code_unavailable", "no party code is free for this party");
}

/** `{code}` → `{secret}` while the code is live. */
export async function handleCodeLookup(request: Request, env: CodeEnv): Promise<Response> {
  const code = text((await readFields(request)).code)?.toLowerCase() ?? null;
  if (code === null || !CODE.test(code)) {
    return jsonError(400, "invalid_code", "code must be four letters");
  }
  if (!env.PARTY_CODE) return unavailable();
  const response = await stub(env, code).fetch(new Request("https://party-code/"));
  if (response.status !== 200) return jsonError(404, "code_not_found", "no party has that code");
  return json(200, { secret: await response.text() });
}
