/**
 * Import invite secrets into session memory and strip their URL fragment
 * before rendering. A page-level guard prevents StrictMode's
 * double effect run from joining twice. A party code's secret arrives by
 * in-memory handoff instead, so it never touches the URL.
 */
import { parseInviteFragment } from "@rocketcrab/party";

let inviteHandled = false;
let handedOff: ImportedInvite | null = null;

/**
 * Queue an invite for the next `/party` mount: party-code joins, and
 * external-game transfers, whose first arrival creates the party instead.
 */
export function handOffInvite(secret: string, create = false): void {
  handedOff = create ? { secret, create: true } : { secret };
}

/** True while an invite waits in the URL fragment or a handoff. */
export function invitePending(location: Pick<InviteImportLocation, "hash">): boolean {
  return handedOff !== null || location.hash.length > 0;
}

export interface ImportedInvite {
  readonly secret: string;
  /** Create the party with this secret rather than join it. */
  readonly create?: true;
}

/** The URL parts the importer needs (decoupled from window for tests). */
export interface InviteImportLocation {
  readonly hash: string;
  readonly pathname: string;
  readonly search: string;
}

/** Import an invite fragment once per page load; null when none applies. */
export function importInviteFromLocation(location: InviteImportLocation): ImportedInvite | null {
  if (handedOff !== null) {
    const invite = handedOff;
    handedOff = null;
    return invite;
  }
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
    // A fragment with no valid invite data: drop it.
    history.replaceState(null, "", location.pathname + location.search);
  }
  return null;
}

/** Test-only reset so each test imports the fragment fresh. */
export function resetInviteImportForTests(): void {
  inviteHandled = false;
  handedOff = null;
}
