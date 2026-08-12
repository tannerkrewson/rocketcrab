# @rocketcrab/protocol — Versioning and compatibility

This package defines the shared Zod schemas and TypeScript types for every
message that crosses a Rocketcrab Nova trust boundary:

- **Peer plane** — messages between party members over the transport
  (`InMemoryTransport` U5, `TrysteroTransport` P1), including the rendezvous
  pre-admission messages (ADR-0004).
- **Runtime plane** — messages between the Nova shell and the runtime frame
  over the dedicated `MessageChannel` (U3, ADR-0001, ADR-0008).

Both planes share one protocol version, carried in the `version` field of
every envelope.

## The version field

- `version` is a single non-negative integer (currently `1`,
  `PROTOCOL_VERSION` in `src/version.ts`).
- Every peer message envelope carries: `version`, `type`, `sessionId`,
  `senderMemberId`, `senderConnectionId`, `messageId`, `sentAt`, and — for
  ordered families (actions, state, authority, simulation) — a per-sender
  monotonic `seq`.
- Every runtime message envelope carries: `version`, `type`,
  `runtimeInstanceId`, optional `sessionId`, `messageId`, and `sentAt`.
- **Unknown versions must fail.** `parsePeerMessage` / `parseRuntimeMessage`
  (and the standalone `protocolVersionSchema`) reject any version outside
  `SUPPORTED_PROTOCOL_VERSIONS` with a useful error naming the supported
  versions. Receivers must never guess, coerce, or silently accept an
  unrecognized version (threat-model T10; engineering rules 15/21).

## What "backward compatible" means

Within a single protocol version, changes are classified as follows:

| Change                                                            | Compatible?                          | Notes                                                                                              |
| ----------------------------------------------------------------- | ------------------------------------ | -------------------------------------------------------------------------------------------------- |
| Adding an **optional field** to an existing message               | Yes                                  | Old receivers ignore it; old senders omit it.                                                      |
| Widening a **limit** (see `src/limits.ts`)                        | Yes, with coordination               | Only if every live receiver enforces the widened limit; otherwise treat as breaking.               |
| Adding a **new message type**                                     | Yes, after coordinated rollout       | Old receivers reject it as `unknown_message_type` — a loud, safe failure, never silent corruption. |
| Adding a new **enum value**                                       | No                                   | Zod enums reject unknown values; an old receiver would fail the message. Requires a version bump.  |
| Removing, renaming, or changing the **type/semantics** of a field | No                                   | Requires a version bump.                                                                           |
| Changing **required → optional** or **optional → required**       | No (optional → required is breaking) | Required → optional is compatible for receivers.                                                   |
| Removing a message type                                           | No                                   | Requires a version bump.                                                                           |

The envelope fields are mandatory from version 1 and must never be removed,
renamed, or made optional in any future version of the same message family.

## Changing the version

1. Bump `PROTOCOL_VERSION` and add the old version to
   `SUPPORTED_PROTOCOL_VERSIONS` **only if** this build still parses it. If
   support for an old version is dropped, `SUPPORTED_PROTOCOL_VERSIONS` is
   the single source of truth for what is accepted — old peers then fail with
   the "Unsupported protocol version" error, which is the intended fail-fast
   behavior.
2. Add the new message schemas as new members of `peerMessagesSchema` /
   `runtimeMessagesSchema` (discriminated by `type`) so the union and the
   parse helpers pick them up automatically.
3. Update `PEER_MESSAGE_TYPES` / `RUNTIME_MESSAGE_TYPES` (they are derived
   from the unions — nothing to hand-maintain).
4. Add/update tests: a valid example and an invalid example for every new
   message family (`src/messages/*.test.ts`), and an unknown-version case in
   `src/errors.test.ts`.
5. Document the change here and in the issue that required it.

### Change log

- **Protocol version 1 additions (S1, Nova API):** added peer-plane lifecycle
  messages `game.ready`, `game.start`, and `game.end` (the ready lifecycle,
  game start, and game end concepts of the game-facing Nova API, S1). All
  three are new message types within version 1 (compatible per the table
  above); receivers that predate S1 reject them as `unknown_message_type` —
  a loud, safe failure. `gameEndReasonSchema` in `src/messages/shared.ts` is
  now shared by the peer `game.end` announcement and the runtime `game.end`
  teardown request (same values as before, no wire change).

## Limits

Initial limits live in `src/limits.ts` as typed constants:

| Limit                        | Constant                     | Value            |
| ---------------------------- | ---------------------------- | ---------------- |
| HTML source size             | `htmlSourceBytes`            | 2 MiB            |
| Message size before chunking | `messageBytesBeforeChunking` | 64 KiB           |
| State snapshot size          | `stateSnapshotBytes`         | 512 KiB          |
| Action payload size          | `actionPayloadBytes`         | 16 KiB           |
| Action rate                  | `actionRatePerSecond`        | 20 /s per player |
| Runtime log rate             | `runtimeLogRatePerSecond`    | 50 /s per frame  |
| Error-report rate            | `errorReportRatePerSecond`   | 5 /s per frame   |
| Handshake timeout            | `handshakeTimeoutMs`         | 30 000 ms        |
| Action timeout               | `actionTimeoutMs`            | 10 000 ms        |

Every hard limit has a warn threshold (`LIMIT_WARN_FRACTION = 0.8`); senders
should warn, rate-limit, compress, or chunk before the hard limit is hit.
String limits (source, names, digests) are enforced inside the Zod schemas;
byte-size limits on `unknown` payloads are enforced at serialization
boundaries (the host bridge and transport adapters) using these constants,
because Zod cannot measure serialized byte size. Raising a hard limit is a
breaking change for peers that enforce it (see table above); tuning these
values is expected after real play-testing (P3, S3, M1).

## Schema hygiene

- Schemas are **pure data + Zod**: no `.transform()`, `.refine()`,
  `.superRefine()`, or custom callbacks are embedded. Cross-field invariants
  that cannot be expressed declaratively (for example
  `chunkIndex < chunkCount` on `game.source.chunk`) are documented on the
  schema and enforced by receiver logic.
- No `any` at protocol boundaries: `parsePeerMessage` / `parseRuntimeMessage`
  take `unknown` and return typed values or a structured `ProtocolError`
  (`ParseResult`).
- This package depends on `zod` only and must never import React or any
  browser/DOM-only API, so both `apps/nova` and `apps/runtime` can consume it.
