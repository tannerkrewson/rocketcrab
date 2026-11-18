# ADR-0008: Shared game runtime site

**Status:** Accepted. Physical Mobile Safari checks are tracked in
[PLAN.md](../../PLAN.md).

Host the runtime on a different site from the Nova app, using a different
registrable domain. This lets desktop browsers isolate their processes when
a game loops or uses too much CPU. A sibling subdomain is not sufficient for
that purpose, and process isolation still depends on the browser. See the
[runtime sandbox findings](../testing/runtime-sandbox-findings.md).

Games share the runtime origin. They can use remote dependencies, canvas,
audio, and user-approved camera or microphone access. Sharing the runtime
origin also means they can share origin-scoped storage and permission grants.
Keep Nova credentials, party secrets, and the saved game library on the app
origin. The runtime site blocks workers and clipboard permissions. Game frames
have no top-navigation permission.

A runtime origin per game would isolate storage and grants between games.
Keep the shared origin for games made and exchanged among friends. Revisit
that choice before encouraging players to load games from strangers.
