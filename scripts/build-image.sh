#!/usr/bin/env bash
# Build committed source off-host; never reads Dokku config or local .env files.
set -euo pipefail
cd "$(dirname "$0")/.."
revision=$(git rev-parse "${1:-HEAD}^{commit}")
image=${2:-localhost/rocketcrab:node22-${revision:0:12}}
archive=${3:-/tmp/rocketcrab-${revision:0:12}.tar}
base='docker.io/gliderlabs/herokuish@sha256:475ba6ea9eaa02934eb694d842c61adcdd49a564f4003aa45dc6a81b276a7b74'
command -v podman >/dev/null
exec 9>/tmp/dokku-cve-offhost-build.lock
flock 9
source_dir=$(mktemp -d)
container="rocketcrab-build-${revision:0:12}-$$"
cleanup() {
    podman rm -f "$container" >/dev/null 2>&1 || true
    rm -rf "$source_dir"
}
trap cleanup EXIT
git archive "$revision" | tar -x -C "$source_dir"
podman pull "$base"
podman create --name "$container" --entrypoint /bin/bash "$base" -lc 'cd /app; /build'
podman cp "$source_dir/." "$container:/app"
podman start -a "$container"
test "$(podman inspect "$container" --format '{{.State.ExitCode}}')" = 0
test "$(podman inspect "$container" --format '{{.State.OOMKilled}}')" = false
podman commit --change 'ENTRYPOINT ["/start"]' --change 'CMD ["web"]' \
    --change 'EXPOSE 5000' --change "LABEL org.opencontainers.image.revision=$revision" \
    "$container" "$image"
podman save --format docker-archive -o "$archive" "$image"
podman image inspect "$image" --format '{{.Id}}' > "$archive.image-id"
sha256sum "$archive" > "$archive.sha256"
printf 'Source: %s\nImage: %s\nArchive: %s\n' "$revision" "$image" "$archive"
