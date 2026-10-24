# ADR-0011: Secrets and invite-link handling

- **Status:** Accepted; updated for private invites
- **Owner:** Rocketcrab Nova
- **Related:** ADR-0004 (private parties), ADR-0008 (runtime isolation), ADR-0010 (trust)

## Decision

Generate a 32-byte CSPRNG secret using Web Crypto. Derive the private Trystero
room ID, password, and session ID via SHA-256 with separate domain labels.
Invites use `/join#secret=…`: only the fragment contains the capability, never
paths or queries. Fragments are not sent in HTTP requests. The trusted shell
imports it and strips it from the address bar/history before opening game frames.
No application logging, analytics or game messages may contain the secret.

The main origin stores a small local recovery record (identity, capability,
last game metadata) to survive Mobile Safari page discard/reload. It stores no
transferred HTML. Clean leave/dismiss clears the record. Main-origin scripts,
browser extensions and devtools can access it; runtime-origin game frames cannot.
This deliberate recovery tradeoff is not a claim of memory-only secrecy.

Native sharing, clipboard fallback and QR encode the same private invite.
Some channels strip fragments: use another sharing channel or the QR, not a
code/admission fallback. Copy the full link, not the fragment-free address bar.

## Limitations

The link is a reusable bearer capability, not a one-time ticket. Anyone holding
it can forward it and join while a peer remains. Cooperative removal cannot ban
the holder. Retire a leaked invite by leaving and creating a new party with a
new secret. There is no backend reservation or history after everyone leaves.

Static deployment browser tests assert that invite fragments do not enter HTTP
paths/queries. The isolated runtime bundle must contain no party-secret logic.
