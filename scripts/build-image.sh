#!/usr/bin/env bash
# Build committed source off-host; never reads Dokku config or local .env files.
set -euo pipefail
cd "$(dirname "$0")/.."
revision=$(git rev-parse "${1:-HEAD}^{commit}")
image=${2:-localhost/rocketcrab:node22-${revision:0:12}}
artifact_dir=${ROCKETCRAB_ARTIFACT_DIR:-${XDG_CACHE_HOME:-$HOME/.cache}/rocketcrab-cve-build}
mkdir -p "$artifact_dir"
archive=${3:-$artifact_dir/rocketcrab-${revision:0:12}.tar}
# /tmp may be RAM-backed; keep source trees and archives on disk.
if [[ $(findmnt -no FSTYPE -T "$(dirname "$archive")") == tmpfs ]]; then
    echo 'Refusing an archive destination on RAM-backed tmpfs' >&2
    exit 1
fi
available_kb=$(awk '/MemAvailable:/ {print $2}' /proc/meminfo)
(( available_kb > 4194304 )) || { echo 'Need at least 4GiB available RAM for build'; exit 1; }
base='docker.io/gliderlabs/herokuish@sha256:475ba6ea9eaa02934eb694d842c61adcdd49a564f4003aa45dc6a81b276a7b74'
command -v podman >/dev/null
exec 9>/tmp/dokku-cve-offhost-build.lock
flock 9
# A client killed while attached can leave its container building after the lock
# fd closes. Refuse to overlap with any such orphan; reconcile it explicitly.
if podman ps --filter name='^/rocketcrab-build-' --format '{{.Names}}' | grep -q .; then
    echo 'An existing Rocketcrab build container is still running; reconcile it first' >&2
    exit 1
fi
source_dir=$(mktemp -d "$artifact_dir/source.XXXXXX")
container="rocketcrab-build-${revision:0:12}-$$"
cleanup() {
    podman rm -f "$container" >/dev/null 2>&1 || true
    rm -rf "$source_dir"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM HUP
git archive "$revision" | tar -x -C "$source_dir"
podman pull "$base"
podman create --name "$container" --memory=3g --cpus=2 \
    -e NODE_OPTIONS=--max-old-space-size=1536 \
    --entrypoint /bin/bash "$base" -lc 'cd /app; /build'
podman cp "$source_dir/." "$container:/app"
podman start -a "$container"
test "$(podman inspect "$container" --format '{{.State.ExitCode}}')" = 0
test "$(podman inspect "$container" --format '{{.State.OOMKilled}}')" = false
podman commit --change 'ENTRYPOINT ["/start"]' --change 'CMD ["web"]' \
    --change 'EXPOSE 5000' --change 'ENV NODE_OPTIONS=' \
    --change "LABEL org.opencontainers.image.revision=$revision" \
    "$container" "$image"
podman save --format docker-archive -o "$archive" "$image"
image_id=$(podman image inspect "$image" --format '{{.Id}}')
printf 'sha256:%s\n' "${image_id#sha256:}" > "$archive.image-id"
printf '%s\n' "$revision" > "$archive.source-commit"
sha256sum "$archive" > "$archive.sha256"
printf 'Source: %s\nImage: %s\nArchive: %s\n' "$revision" "$image" "$archive"
