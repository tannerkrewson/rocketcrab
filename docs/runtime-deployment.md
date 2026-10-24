# Rocketcrab Node/Brotli runtime deployment

Node is pinned to **22.23.4**, the Node 22 security release explicitly fixing
CVE-2026-111497. npm remains 10.x; application dependencies are unchanged.
Node 22 support ends 2027-04-30. The patched backport still reports Brotli 1.1.0;
verify the actual Node version, not the Brotli version string.

The old production herokuish image cannot resolve this Node version using its
bundled buildpack inventory. `.buildpacks` pins the official Node buildpack to
`2d8736ee6d8417530b8ec99d9fcd550f323d87fc`. The base herokuish image remains the
existing production digest; there is no host/global builder upgrade.

## Source and deployment mapping

Before this patch, local `dev`, `origin/prod`, the Dokku `master` ref, and Dokku's
recorded deployment all matched `5ad9ca69910acb75c140323624603a3d8c966a37`.
The former GitHub workflow checked out `prod` and git-pushed to Dokku. That workflow
is now **build/artifact only** on `prod` pushes or manual dispatch, with no
push-triggered deployment, to avoid
compiling Next on the shared 1CPU/2GB host or deploying twice.

`git:from-image` replaces the app's Dokku deploy-branch source with a generated
FROM-only Dockerfile. The application source remains in GitHub and the image's
OCI revision label; the generated Dokku commit is not the application source SHA.
The admin script protects the old image and bundles the original server Git refs
before this change. Read-only preparation confirmed Rocketcrab's effective original
routing is `http:80:5000 https:443:5000`, inferred rather than explicitly set.
The remote job re-reads the effective app mappings at deployment time, records
them privately, explicitly preserves them with app-only `dokku ports:set` before
import, and compares them immediately after switching. EXPOSE must not replace
public 80/443 mappings with inferred port-5000 mappings. Do not later git-push source to Dokku expecting this off-host
pipeline: that would trigger an on-host build again. GitHub `prod` pushes now
build artifacts only and do not SSH to Dokku.

## Off-host build and validation

Requirements: Linux amd64, Bash, Git, Podman, util-linux `flock`, sufficient local
RAM/disk (at least 4GiB available RAM; build capped at 3GiB/2 CPUs), and outbound access to GitHub, npm, Docker Hub and Node downloads.
Node for host tests is installed via `mise install`; use `mise exec -- npm ...`.
Build only committed source (local `.env`, secrets, node_modules and user artifacts
are excluded by `git archive`). No production build secrets are required.

```sh
bash scripts/build-image.sh HEAD
# The command prints the unique image name and archive path and writes
# <archive>.sha256, <archive>.image-id and <archive>.source-commit.
# Default artifact/source working directory: ~/.cache/rocketcrab-cve-build
# (disk-backed; RAM-backed archive destinations are rejected).
podman run -d --name rocketcrab-check -e PORT=5000 \
  -p 127.0.0.1:43188:5000 localhost/rocketcrab:node22-<source-sha-prefix>
mise exec -- node scripts/smoke-runtime.mjs http://127.0.0.1:43188
podman exec rocketcrab-check /app/.heroku/node/bin/node --version
podman exec rocketcrab-check /exec npm --version
podman logs rocketcrab-check
podman stop rocketcrab-check
podman rm rocketcrab-check
```

The build script serializes heavy local builds with the shared
`/tmp/dokku-cve-offhost-build.lock`. It also refuses to start while any
`rocketcrab-build-*` container is still running, because a killed client can
leave its container building after the lock fd closes. Interrupt/termination
traps remove only the owned build container, holding the lock through cleanup. Allow long enough for
lock waiting plus the entire build/archive save; do not use short harness timeouts
that may leave a container running after its client is killed. If interrupted,
reconcile that owned container before launching another build. Final metadata is `/start web`, port 5000,
with herokuish `/start`, `/exec` and generated `/app/Procfile` retained. Dokku
continues supplying runtime environment/config; none is copied from production.

Pushing the non-deploy `security/node22-brotli` branch triggers only CI tests;
pushing `prod` triggers only the artifact build. The GitHub workflow offers the
same build as a downloadable archive with checksum, image ID and source commit. It requires only GitHub `contents: read`, artifact storage and a
runner with Podman; it uses no production SSH secret. A workflow_dispatch workflow
must be present on the default branch before GitHub exposes its manual trigger.
Until this change reaches default `dev`, use the local script above. Dispatch only
source refs containing these scripts. Download all artifact files together;
recompute/check the checksum using the local archive filename after extraction
(the sidecar records the build machine's absolute path).

## Serialized admin deployment

**Obtain the coordinator's Rocketcrab production slot first.** No builds, pushes to
old auto-deploy branches, imports or configuration mutations outside that slot.
SSH requires existing administrative access, a trusted known_hosts entry, and
permission for Docker/Dokku/Git commands; no new credentials or registry needed.

```sh
ROCKETCRAB_DEPLOY_APPROVED=yes mise exec -- bash scripts/deploy-image.sh \
  "$HOME/.cache/rocketcrab-cve-build/rocketcrab-<source-prefix>.tar" \
  localhost/rocketcrab:node22-<source-prefix> <expected-image-id> <built-source-commit>
```

The launcher refuses an archive on RAM-backed tmpfs, checks disk/RAM headroom,
uploads the archive and reviewed
`deploy-image-remote.sh` plus smoke script, then starts a **durable nohup remote
job** with a private `deploy.log`, `deploy.pid`, and final `exit-status` marker.
The launcher returns after dispatch, **not after successful deployment**. The
whole import/check/rollback sequence survives SSH/harness disconnects. Monitor
the printed release directory, checking for the marker before reading its value;
never blindly retry a timed-out command. Use generous transfer timeouts or a
disk-logged durable local launcher as well. Only exit-status `0`, independent
health/runtime checks, and old-container retirement establish success.

The remote job verifies SHA256,
locks deployment, tags the current image for rollback, verifies a Git source
bundle, imports without compilation, checks exact image ID/entrypoint/command,
and calls `dokku git:from-image rocketcrab <unique-tag>`. It verifies the loaded
image's source revision label and metadata, the running Node/npm versions, a full
HTTP/assets/party/WebSocket smoke inside the actual running container on its own
port, host-side public routing/assets GETs through nginx (including the kids
domain), and that the container stays running with no restart and its startup
log captured.
Failures trigger
rollback to the protected old image, explicitly restoring the old CVE exposure.
SSH is batch-only with strict host-key verification. It changes only this app's
preserved port mappings; it does not alter unrelated or global Dokku config,
restart other apps, prune, or upgrade the host. The tiny FROM-only Docker build
is expected; an application compilation is not.

The remote job also waits for old-container retirement before exit `0`. Exit `2`
means the new app passed checks but retirement remains pending: keep the slot held
and reconcile state, do not roll back or repeat the import blindly.

After switching (and after the job exits), independently verify the **actual
running web container**, not `dokku run`:
Node v22.23.4, npm10.x, no startup errors/OOM/restart loop; then run
`mise exec -- node scripts/smoke-runtime.mjs https://rocketcrab.com` and review
`https://kids.rocketcrab.com` lightly. The external smoke test creates one in-memory
party and checks the public WebSocket path; if it fails, roll back rather than
leaving a bad deployment. Check other apps' container state only; do not create
games on them. Existing Rocketcrab in-memory parties are lost during the authorized
restart.

## Failure containment and rollback

If a deploy fails, inspect whether the existing container still serves traffic;
do not repeat builds blindly. The admin script leaves its root-only release
directory containing `rollback-image.txt`, `source-before.bundle`, source ref and
new built-source commit, original/after routing reports and durable job logs/exit
marker. It removes only its successfully consumed upload archive.
Preserve the backup metadata/images until explicitly approved for cleanup. Roll back only
Rocketcrab with app-only commands: `dokku ports:set rocketcrab http:80:5000
https:443:5000`, then `dokku git:from-image rocketcrab <rollback-tag>` (read the
exact tag from the release directory's `rollback-image.txt`), then repeat health
checks. Dokku's deploy pipeline drops non-latest `dokku/<app>` tags and prunes
the previous image, so the remote job stores the rollback tag in the
`localhost/rocketcrab-rollback:<stamp>` namespace and additionally exports the
old image to `old-image.tar` in the release directory; verify the tag (or load
the tar) before relying on it. **The old Node20 image restores the CVE
exposure**; report that clearly. Restoring server source refs is a separate
reviewed operation, not needed for image rollback. Never force-push the
generated Dokku source history.

References:
- https://nodejs.org/en/blog/vulnerability/october-2026-security-releases
- https://nodejs.org/en/blog/release/v22.23.4
- https://github.com/dokku/dokku/blob/v0.36.3/docs/deployment/methods/image.md
