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
is now **manual build/artifact only**, with no push-triggered deployment, to avoid
compiling Next on the shared 1CPU/2GB host or deploying twice.

`git:from-image` replaces the app's Dokku deploy-branch source with a generated
FROM-only Dockerfile. The application source remains in GitHub and the image's
OCI revision label; the generated Dokku commit is not the application source SHA.
The admin script protects the old image and bundles the original server Git refs
before this change. Do not later git-push source to Dokku expecting this off-host
pipeline: that would trigger an on-host build again.

## Off-host build and validation

Requirements: Linux amd64, Bash, Git, Podman, util-linux `flock`, sufficient local
RAM/disk, and outbound access to GitHub, npm, Docker Hub and Node downloads.
Node for host tests is installed via `mise install`; use `mise exec -- npm ...`.
Build only committed source (local `.env`, secrets, node_modules and user artifacts
are excluded by `git archive`). No production build secrets are required.

```sh
bash scripts/build-image.sh HEAD
# The command prints the unique image name and archive path and writes
# <archive>.sha256 and <archive>.image-id.
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
`/tmp/dokku-cve-offhost-build.lock`. Final metadata is `/start web`, port 5000,
with herokuish `/start`, `/exec` and generated `/app/Procfile` retained. Dokku
continues supplying runtime environment/config; none is copied from production.

The GitHub workflow offers the same build as a downloadable archive with checksum
and image ID. It requires only GitHub `contents: read`, artifact storage and a
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
ROCKETCRAB_DEPLOY_APPROVED=yes bash scripts/deploy-image.sh \
  /tmp/rocketcrab-<source-prefix>.tar \
  localhost/rocketcrab:node22-<source-prefix> <expected-image-id>
```

The script checks disk/RAM headroom, uploads the archive, verifies its SHA256,
locks deployment, tags the current image for rollback, verifies a Git source
bundle, imports without compilation, checks exact image ID/entrypoint/command,
and calls `dokku git:from-image rocketcrab <unique-tag>`. It does not change Dokku
config, restart other apps, prune, or upgrade the host. The tiny FROM-only Docker
build is expected; an application compilation is not.

After switching, verify the **actual running web container**, not `dokku run`:
Node v22.23.4, npm10.x, no startup errors/OOM/restart loop; then run
`mise exec -- node scripts/smoke-runtime.mjs https://rocketcrab.com` and review
`https://kids.rocketcrab.com` lightly. The smoke test creates one in-memory party.
Check other apps' container state only; do not create games on them. Existing
Rocketcrab in-memory parties are lost during the authorized restart.

## Failure containment and rollback

If a deploy fails, inspect whether the existing container still serves traffic;
do not repeat builds blindly. The admin script leaves its root-only release
directory containing `rollback-image.txt`, `source-before.bundle` and the imported
archive. Preserve these until explicitly approved for cleanup. Roll back only
Rocketcrab with `dokku git:from-image rocketcrab <preserved-rollback-tag>` and repeat
health checks. **The old Node20 image restores the CVE exposure**; report that
clearly. Restoring server source refs is a separate reviewed operation, not needed
for image rollback. Never force-push the generated Dokku source history.

References:
- https://nodejs.org/en/blog/vulnerability/october-2026-security-releases
- https://nodejs.org/en/blog/release/v22.23.4
- https://github.com/dokku/dokku/blob/v0.36.3/docs/deployment/methods/image.md
