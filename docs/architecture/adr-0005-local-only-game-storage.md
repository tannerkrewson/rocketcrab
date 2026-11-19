# ADR-0005: Local-only game storage

- **Status:** Accepted
- **Date:** 2026-08-01
- **Owner:** Rocketcrab Nova planning (Phase 1)
- **Related:** U2 (browser-local repository), ADR-0001 (origins), ADR-0011
  (secrets), P3 (source distribution)

## Context

Rocketcrab Nova has no accounts, no cloud sync, and no public catalog. Saved
games are personal artifacts of the creator. The plan (section 3.5) requires
game source and metadata to be stored in **IndexedDB on Nova's main origin**
— never in the runtime origin, never uploaded to Nova infrastructure.

## Decision

- Saved game source and metadata live in **IndexedDB on the main origin**
  (`https://nova.example`), accessed through **Dexie** (`dexie@4.4.4`).
- The repository (U2) provides create, read, update, delete, duplicate, list,
  search, and test-result recording, plus Web Crypto SHA-256 source hashing
  and storage-error handling.
- Games are **not** stored in runtime-origin storage (the runtime frame has no
  persistence authority over game source) and are **never uploaded** to Nova
  infrastructure.
- Non-cryptographic local identifiers use `nanoid`; cryptographic material
  (source hashes, session secrets) uses Web Crypto directly.
- TanStack Query manages async resource lifecycles and invalidation _around_
  the local repository. Live peer-to-peer game state is **not** stored in
  TanStack Query (plan engineering rule 8).

## Alternatives considered

1. **localStorage.** Rejected: synchronous, small quota (~5 MB), string-only;
   multi-megabyte game HTML and metadata need IndexedDB.
2. **Cloud sync / accounts.** Out of scope for v1; explicitly deferred to the
   backlog (cloud game libraries, accounts).
3. **File System Access API.** Rejected as the primary store: user gesture
   requirements and permission prompts make it unsuitable for a silent
   autosave model; it may appear later for file import/export (deferred
   backlog: portable `.html`/`.nova` file sharing).
4. **Storing source in the runtime origin.** Rejected: the runtime origin is
   intentionally untrusted (ADR-0001, ADR-0008); storing source there would
   defeat the isolation model and could be read by other games.

## Tradeoffs

- **Device-bound.** Games live in one browser profile; clearing site data
  loses them. Acceptable for v1 (no accounts), and the P2P transfer path (P3)
  is the sharing mechanism.
- **Quota pressure.** Large games and many saves consume IndexedDB quota;
  U2 must surface storage errors and never destroy the prior saved version on
  a failed write.

## Consequences

- Games survive reloads (acceptance: U2) and are never sent over the network
  during save operations.
- When playing, the initiating player transfers the exact source
  peer-to-peer (P3), so storage stays local while play remains shared.
- A failed write must not destroy the prior saved version; delete requires
  confirmation (U2 acceptance).

## Saving a friend's game (2026-11-19)

Every player in a party already receives and hash-verifies the selected Nova
game (P3). The engine keeps the newest verified source of each game shared
during the party session (at most 10, cleared on leaving), so any player,
not only the host, can save it to their own local repository from the lobby,
the game's details page, the in-game **About this game** sheet, or the
lobby browser's **Friends' games** category. Nothing new is uploaded.

A saved copy records `copiedFrom` (the shared game's id in the party, the
saved version's hash, and who shared it). When a later party shares that id
again with a different hash:

- an **unedited** copy (its hash still equals `copiedFrom.sourceHash`) is
  offered **Update my copy**, which replaces it in place;
- an **edited** copy is never overwritten: **Save their version** adds the
  new version as a separate game;
- any saved game with the exact same hash counts as already saved.

Duplicating a game in the editor drops `copiedFrom`: the duplicate is the
player's own fork. Players only see games that were selected in a party they
joined; browsing friends' whole libraries is not supported.
