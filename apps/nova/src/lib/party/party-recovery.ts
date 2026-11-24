import { sessionSecretSchema } from "@rocketcrab/protocol";

export const PARTY_RECOVERY_KEY = "nova:party:recovery:v1";
/** Record schema version; bumping it invalidates old records. */
export const PARTY_RECOVERY_VERSION = 1;
const RECOVERY_TTL_MS = 24 * 60 * 60 * 1_000;

export interface PartyRecoveryRecord {
  readonly version: typeof PARTY_RECOVERY_VERSION;
  /** Epoch-ms time the record was written. */
  readonly savedAt: number;
  readonly role: "creator" | "joiner";
  /** Party session secret; derives the private room. */
  readonly secret: string;
  readonly displayName: string;
  /** What the party was playing, when known. */
  readonly game: {
    readonly gameId: string;
    readonly title: string;
  } | null;
}

export type PartyRecoveryInput = Omit<PartyRecoveryRecord, "version" | "savedAt">;

/**
 * Persist the recovery record. Returns false when storage is unavailable
 * or full (private mode / quota) — the party still works, the player just
 * loses one-tap rejoin after a reload.
 */
export function savePartyRecovery(
  input: PartyRecoveryInput,
  now: () => number = Date.now,
): boolean {
  try {
    const record: PartyRecoveryRecord = {
      version: PARTY_RECOVERY_VERSION,
      savedAt: now(),
      ...input,
    };
    window.localStorage.setItem(PARTY_RECOVERY_KEY, JSON.stringify(record));
    return true;
  } catch {
    return false;
  }
}

export function readPartyRecovery(now: () => number = Date.now): PartyRecoveryRecord | null {
  try {
    const raw = window.localStorage.getItem(PARTY_RECOVERY_KEY);
    if (raw === null) {
      return null;
    }
    const record = parsePartyRecovery(raw);
    if (record === null || now() - record.savedAt >= RECOVERY_TTL_MS) {
      clearPartyRecovery();
      return null;
    }
    return record;
  } catch {
    return null;
  }
}

export function clearPartyRecovery(): void {
  try {
    window.localStorage.removeItem(PARTY_RECOVERY_KEY);
  } catch {
    // Storage unavailable — nothing to clear.
  }
}

export function parsePartyRecovery(raw: string): PartyRecoveryRecord | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) {
    return null;
  }
  const record = parsed as Record<string, unknown>;
  if (record.version !== PARTY_RECOVERY_VERSION) {
    return null;
  }
  if (typeof record.savedAt !== "number" || !Number.isFinite(record.savedAt)) {
    return null;
  }
  if (record.role !== "creator" && record.role !== "joiner") {
    return null;
  }
  if (typeof record.secret !== "string" || !sessionSecretSchema.safeParse(record.secret).success) {
    return null;
  }
  if (typeof record.displayName !== "string" || record.displayName.length === 0) {
    return null;
  }
  let game: PartyRecoveryRecord["game"] = null;
  if (record.game !== null && record.game !== undefined) {
    const gameRecord = record.game as Record<string, unknown>;
    if (typeof gameRecord.gameId !== "string" || typeof gameRecord.title !== "string") {
      return null;
    }
    game = { gameId: gameRecord.gameId, title: gameRecord.title };
  }
  return {
    version: PARTY_RECOVERY_VERSION,
    savedAt: record.savedAt,
    role: record.role,
    secret: record.secret,
    displayName: record.displayName,
    game,
  };
}
