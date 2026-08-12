/**
 * Invite-fragment import (P4; ADR-0011).
 *
 * Invite secrets travel in the URL fragment. Before the party experience
 * renders, the fragment is parsed here, the secret is handed to the caller
 * (which imports it into engine/session memory), and the fragment is
 * stripped from the URL so the secret does not linger in browser history.
 * A module-level guard keeps StrictMode's double effect run from joining
 * twice on one page load.
 */
import { parseInviteFragment } from "@rocketcrab/party";

let inviteHandled = false;

/** Imported invite data (secret + optional four-letter code). */
export interface ImportedInvite {
  readonly secret: string;
  readonly code?: string;
}

/** The URL parts the importer needs (decoupled from window for tests). */
export interface InviteImportLocation {
  readonly hash: string;
  readonly pathname: string;
  readonly search: string;
}

/** Import an invite fragment once per page load; null when none applies. */
export function importInviteFromLocation(location: InviteImportLocation): ImportedInvite | null {
  if (inviteHandled) {
    return null;
  }
  inviteHandled = true;
  const data = parseInviteFragment(location.hash);
  if (data !== null && data.secret !== undefined) {
    // The secret lives in session memory from here on; remove the fragment
    // from the address bar and history.
    history.replaceState(null, "", location.pathname + location.search);
    return {
      secret: data.secret,
      ...(data.code !== undefined ? { code: data.code } : {}),
    };
  }
  if (location.hash.length > 0) {
    // A fragment with no valid invite data: drop it (ADR-0011 hygiene).
    history.replaceState(null, "", location.pathname + location.search);
  }
  return null;
}

/** Test-only reset so each test imports the fragment fresh. */
export function resetInviteImportForTests(): void {
  inviteHandled = false;
}
