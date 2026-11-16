/**
 * Import invite secrets into session memory and strip their URL fragment
 * before rendering (ADR-0011). A page-level guard prevents StrictMode's
 * double effect run from joining twice.
 */
import { parseInviteFragment } from "@rocketcrab/party";

let inviteHandled = false;

export interface ImportedInvite {
  readonly secret: string;
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
    history.replaceState(null, "", location.pathname + location.search);
    return {
      secret: data.secret,
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
