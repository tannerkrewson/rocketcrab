# @rocketcrab/party

P2 — the four-letter rendezvous and secure admission layer (ADR-0004).
Preserves the simple Rocketcrab room-code experience **without a central
room-code server**: a four-letter code names a public rendezvous namespace,
a greeter advertises a minimal party summary there and explicitly admits
joiners, and the real party room is derived from a CSPRNG session secret —
so guessing a code never admits anyone, colliding parties stay
distinguishable, and invite links bypass four-letter discovery entirely.

## Room model

```
four-letter code (public)          session secret (private, CSPRNG)
        │                                   │
        ▼                                   ▼
nova-rv:CODE (rendezvous room)     derive (SHA-256, domain-separated)
adverts · join requests ·          ┌──────────────┬───────────────┐
admission · secret handoff         roomId        password        sessionId
        │ (post-admission only)          │
        ▼                                   ▼
                            party:<hex> (private room, password-protected)
```

- The code is a **namespace, never a secret** (engineering rule 6). 23-letter
  alphabet `ABCDEFGHJKMNPQRSTUVWXYZ` (no I/O/L — the easily confused
  letters), 279,841 codes, normalized to uppercase on entry.
- The secret is 32 random bytes (Web Crypto `getRandomValues`, unpadded
  base64url). The private room name, Trystero password, and session ID are
  all derived with `SHA-256(label || 0x00 || secret)` (see `secrets.ts`) —
  the secret is the only private material that ever travels: to an admitted
  joiner over the established encrypted peer connection, and inside
  invite-link fragments (ADR-0011). It never enters the rendezvous adverts,
  the game plane, or the game DOM.

## Flows

- `createParty` — generate a code, join its rendezvous room, listen briefly
  for an existing party advert (collision → regenerate, up to
  `collisionRetries`), derive the private room, join it, then advertise a
  minimal party summary (`party.identity`) and re-advertise on a cadence
  (relays have no history; F5 F3). Joiners are admitted **explicitly** via
  the `onJoinRequest` policy hook (absent ⇒ reject); approved joiners get the
  secret over the peer connection.
- `joinPartyByCode` — normalize the code, join the rendezvous room, discover
  adverts (a collision picker via `selectParty` when several parties share
  the code), send a `join.request`, wait for approval, receive the secret,
  derive the private room, join it, and **leave the rendezvous** (joiner
  step 9 / rule 22). Rejected and timed-out joiners fail fast and leave too
  (F4 — stale handles churn the greeter's offer pool).
- `joinPartyByInvite` — bypass four-letter discovery using the fragment
  secret (`buildInviteUrl` / `parseInviteUrl`, `invite.ts`).
- **Greeter migration** — the creator is the first greeter. When the greeter
  leaves (or its rendezvous drops), the remaining admitted members
  deterministically elect the lowest memberId as the next greeter, who
  re-joins the rendezvous room and keeps the code usable for late joiners.
  Greeter status is separate from game authority (ADR-0007; S3 owns
  authority) — the creator is never permanently privileged.

## Transport neutrality

The party layer drives the transport-neutral `NovaTransport` interface
through a `PartyTransportFactory`, so the same flows run over
`InMemoryTransport` (deterministic tests, `@rocketcrab/testing`) and
`TrysteroTransport` (real parties, `@rocketcrab/trystero-transport`). The
factory receives the derived password when creating the private-room
transport so room admission stays at the transport level (Trystero room
password, F8).

Composition for real parties (P4):

```ts
const factory: PartyTransportFactory = {
  createRendezvousTransport: (id) => new TrysteroTransport({ ...id, appId }),
  createPrivateTransport: (id) => new TrysteroTransport({ ...id, appId, password: id.password }),
};
const party = await createParty({ memberId, transportFactory: factory, onJoinRequest });
// party.privateTransport is joined; party.material holds the derived
// roomId/password/sessionId for the game plane (S1 NovaSession rides the
// same private transport on the `nova.protocol` channel).
```

## Cleanup

Every transport listener and timer has explicit teardown (engineering rule
22; F11): `leave()` leaves both rooms, stops the advert timer, and detaches
all handlers; rejected joiners leave the rendezvous immediately (F4); the
greeter's advert timer is cancelled on step-down.

## Testing

- `src/*.test.ts` — deterministic unit tests: code generation/normalization,
  secret derivation (Web Crypto, deterministic output), invite link
  build/parse, party control message validation, and full flow tests
  (creation, join-by-code, approval, rejection, malformed requests,
  party-full, admission timeout, code guessing, collisions + picker +
  regeneration, greeter migration, invite bypass, secret non-leakage,
  listener cleanup) over `InMemoryTransport` with an injected fake clock —
  no real timers, no network, reproducible in CI.
- Real-browser e2e over Trystero relays is optional/light; the lobby UI
  (P4) owns the browser-level coverage of these flows.
