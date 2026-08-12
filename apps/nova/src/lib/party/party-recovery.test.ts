import { beforeEach, describe, expect, it } from "vitest";
import {
  PARTY_RECOVERY_VERSION,
  clearPartyRecovery,
  parsePartyRecovery,
  readPartyRecovery,
  savePartyRecovery,
  type PartyRecoveryInput,
} from "./party-recovery";

/**
 * M1 recovery-record tests: the shell persists just enough local
 * information (code + invite secret + identity + game) for a one-tap
 * rejoin after a Mobile Safari page reload, validates strictly on read,
 * and clears on leave/dismiss. The game source is deliberately never
 * stored (ADR-0005); rejoin re-fetches it from the party (P3).
 */

const SECRET = "A".repeat(43); // valid unpadded base64url session secret

function input(overrides: Partial<PartyRecoveryInput> = {}): PartyRecoveryInput {
  return {
    role: "joiner",
    code: "ABCD",
    secret: SECRET,
    memberId: "member-a",
    displayName: "Player A",
    game: { gameId: "game-1", title: "Rocket Rumble", mode: "state" },
    ...overrides,
  };
}

beforeEach(() => {
  clearPartyRecovery();
});

describe("party recovery record", () => {
  it("round-trips a record through localStorage", () => {
    expect(savePartyRecovery(input(), () => 1_700_000_000_000)).toBe(true);
    const record = readPartyRecovery();
    expect(record).not.toBeNull();
    expect(record?.version).toBe(PARTY_RECOVERY_VERSION);
    expect(record?.savedAt).toBe(1_700_000_000_000);
    expect(record?.role).toBe("joiner");
    expect(record?.code).toBe("ABCD");
    expect(record?.secret).toBe(SECRET);
    expect(record?.memberId).toBe("member-a");
    expect(record?.game).toEqual({
      gameId: "game-1",
      title: "Rocket Rumble",
      mode: "state",
    });
  });

  it("supports records without a code (invite-only) and without game info", () => {
    savePartyRecovery(input({ code: null, game: null }));
    const record = readPartyRecovery();
    expect(record?.code).toBeNull();
    expect(record?.game).toBeNull();
  });

  it("clear removes the record", () => {
    savePartyRecovery(input());
    expect(readPartyRecovery()).not.toBeNull();
    clearPartyRecovery();
    expect(readPartyRecovery()).toBeNull();
  });

  it("rejects malformed or stale records", () => {
    expect(parsePartyRecovery("not json")).toBeNull();
    expect(parsePartyRecovery(JSON.stringify({ ...input(), version: 99 }))).toBeNull();
    expect(parsePartyRecovery(JSON.stringify({ ...input(), role: "admin" }))).toBeNull();
    expect(parsePartyRecovery(JSON.stringify({ ...input(), secret: "not-a-secret" }))).toBeNull();
    expect(parsePartyRecovery(JSON.stringify({ ...input(), code: 1234 }))).toBeNull();
    expect(parsePartyRecovery(JSON.stringify({ ...input(), memberId: "" }))).toBeNull();
    expect(parsePartyRecovery(JSON.stringify({ ...input(), game: { gameId: 1 } }))).toBeNull();
  });

  it("returns null when storage is unavailable or corrupted", () => {
    // A malformed localStorage value must not crash the shell.
    window.localStorage.setItem("nova:party:recovery:v1", "{broken");
    expect(readPartyRecovery()).toBeNull();
  });
});
