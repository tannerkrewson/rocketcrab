import type { GameMode } from "@rocketcrab/protocol";
import { sessionSecretSchema } from "@rocketcrab/protocol";

/** localStorage key for the party recovery record. */
export const PARTY_RECOVERY_KEY = "nova:party:recovery:v1";
/** Record schema version; bumping it invalidates old records. */
export const PARTY_RECOVERY_VERSION = 1;

/** Everything the shell needs to rejoin a party after a page reload. */
export interface PartyRecoveryRecord {
  readonly version: typeof PARTY_RECOVERY_VERSION;
  /** Epoch-ms time the record was written. */
  readonly savedAt: number;
  /** The role this player held when the record was written. */
  readonly role: "creator" | "joiner";
  /** Four-letter code, when known (invite-only parties may lack it). */
  /** Party session secret (ADR-0011); derives the private room. */
  readonly secret: string;
  /** This player's stable member identity (ADR-0007). */
  readonly memberId: string;
  readonly displayName: string;
  /** What the party was playing, when known. */
  readonly game: {
    readonly gameId: string;
    readonly title: string;
    readonly mode: GameMode;
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

/** Read and validate the recovery record, or null when absent/invalid. */
export function readPartyRecovery(): PartyRecoveryRecord | null {
  try {
    const raw = window.localStorage.getItem(PARTY_RECOVERY_KEY);
    if (raw === null) {
      return null;
    }
    return parsePartyRecovery(raw);
  } catch {
    return null;
  }
}

/** Remove the recovery record (clean leave / explicit dismiss). */
export function clearPartyRecovery(): void {
  try {
    window.localStorage.removeItem(PARTY_RECOVERY_KEY);
  } catch {
    // Storage unavailable — nothing to clear.
  }
}

/** Parse + strictly validate a serialized record; null when invalid. */
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
  if (typeof record.memberId !== "string" || record.memberId.length === 0) {
    return null;
  }
  if (typeof record.displayName !== "string" || record.displayName.length === 0) {
    return null;
  }
  let game: PartyRecoveryRecord["game"] = null;
  if (record.game !== null && record.game !== undefined) {
    const gameRecord = record.game as Record<string, unknown>;
    if (
      typeof gameRecord.gameId !== "string" ||
      typeof gameRecord.title !== "string" ||
      typeof gameRecord.mode !== "string"
    ) {
      return null;
    }
    game = {
      gameId: gameRecord.gameId,
      title: gameRecord.title,
      mode: gameRecord.mode as GameMode,
    };
  }
  return {
    version: PARTY_RECOVERY_VERSION,
    savedAt: record.savedAt,
    role: record.role,
    secret: record.secret,
    memberId: record.memberId,
    displayName: record.displayName,
    game,
  };
}

/** Test-only reset so tests start with no recovery record. */
export function resetPartyRecoveryForTests(): void {
  clearPartyRecovery();
}
