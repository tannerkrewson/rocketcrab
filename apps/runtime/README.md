# Game runtime

The Nova app embeds the runtime on a separate site and bootstraps it over
a dedicated `MessageChannel`. The runtime checks the app origin and parent
window before accepting the channel. Set `VITE_MAIN_ORIGIN` for production
and for LAN development. Localhost uses the app's default development port.

Each game runs in a fresh iframe within the runtime site. The runtime
prepends the same Nova API client used by the API contract tests, validates
messages to and from Nova, and forwards game errors and logs. On reload,
the host replaces the game frame.

Games share the runtime origin. Keep party secrets and saved games on the
app site. Production headers block workers and clipboard capabilities, and
the iframe sandbox prevents the game from navigating the app. See the
[shared runtime decision](../../docs/architecture/adr-0008-shared-runtime-origin-limitations.md).

From the repository root, run `npm run dev` for local development or
`npm run test:e2e -- e2e/runtime.spec.ts` for runtime browser tests. Follow
the [deployment guide](../../docs/architecture/deployment.md) for HTTPS
development, build pins, and header verification.
