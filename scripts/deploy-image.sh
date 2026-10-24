#!/usr/bin/env bash
# ADMIN ONLY: run after coordinator grants Rocketcrab the production slot.
set -euo pipefail
if [[ ${ROCKETCRAB_DEPLOY_APPROVED:-} != yes || $# != 4 ]]; then
    echo 'Usage: ROCKETCRAB_DEPLOY_APPROVED=yes bash scripts/deploy-image.sh <archive> <unique-image-tag> <image-id> <source-commit>' >&2
    exit 1
fi
archive=$1
script_dir=$(cd "$(dirname "$0")" && pwd)
# Fail before any mutation if local smoke-test runtime is unavailable.
node -e 'if (typeof WebSocket !== "function") process.exit(1)'
image=$2
expected=${3#sha256:}
revision=$4
[[ -f $archive && $image =~ ^localhost/rocketcrab:[a-zA-Z0-9._-]+$ && $expected =~ ^[a-f0-9]{64}$ && $revision =~ ^[a-f0-9]{40}$ ]]
ssh_options=(-o BatchMode=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=15)
# Verify an existing checksum sidecar before computing the transfer digest.
if [[ -f $archive.sha256 ]]; then
    recorded=$(awk 'NR == 1 {print $1}' "$archive.sha256")
    [[ $(sha256sum "$archive" | awk '{print $1}') == "$recorded" ]]
fi
host=${DOKKU_SSH_HOST:-root@134.209.222.77}
checksum=$(sha256sum "$archive" | awk '{print $1}')
bytes=$(stat -c %s "$archive")
release="rocketcrab-$(date -u +%Y%m%dT%H%M%SZ)-${expected:0:12}"
remote="/root/$release"
# Check headroom before uploading. No compilation occurs on the host.
ssh "${ssh_options[@]}" "$host" bash -s -- "$remote" "$bytes" <<'REMOTE'
set -euo pipefail
available=$(df -B1 --output=avail /var/lib/docker | tail -1)
required=$(($2 * 2 + 2147483648))
(( available > required )) || { echo 'Insufficient disk headroom'; exit 1; }
mem=$(awk '/MemAvailable:/ {print $2}' /proc/meminfo)
(( mem > 524288 )) || { echo 'Insufficient RAM headroom'; exit 1; }
mkdir -m 700 "$1"
REMOTE
scp "${ssh_options[@]}" "$archive" "$host:$remote/image.tar"
ssh "${ssh_options[@]}" "$host" bash -s -- "$remote" "$checksum" "$image" "$expected" "$release" "$revision" <<'REMOTE'
set -euo pipefail
exec 9>/var/lock/dokku-cve-deploy.lock
flock -n 9 || { echo 'Another app deployment is active'; exit 1; }
umask 077
cd "$1"
printf '%s  image.tar\n' "$2" | sha256sum -c -
old_container=$(docker ps -q --filter name='^/rocketcrab.web.1$')
[[ -n $old_container ]]
old_image=$(docker inspect "$old_container" --format '{{.Image}}')
rollback="dokku/rocketcrab:rollback-$5"
docker tag "$old_image" "$rollback"
[[ $(docker image inspect "$rollback" --format '{{.Id}}') == "$old_image" ]]
printf '%s\n' "$rollback" > rollback-image.txt
chmod 600 rollback-image.txt
git --git-dir=/home/dokku/rocketcrab show-ref --verify refs/heads/master > source-ref.txt
git --git-dir=/home/dokku/rocketcrab bundle create source-before.bundle --all
git --git-dir=/home/dokku/rocketcrab bundle verify source-before.bundle
# docker load is import-only; git:from-image does a tiny FROM-only build.
docker load -i image.tar
actual=$(docker image inspect "$3" --format '{{.Id}}')
[[ ${actual#sha256:} == "$4" ]] || { echo 'Image ID mismatch'; exit 1; }
[[ $(docker image inspect "$3" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}') == "$6" ]]
printf '%s\n' "$6" > new-source-commit.txt
[[ $(docker image inspect "$3" --format '{{json .Config.Entrypoint}}') == '["/start"]' ]]
[[ $(docker image inspect "$3" --format '{{json .Config.Cmd}}') == '["web"]' ]]
rollback_on_failure() {
    echo 'Deployment/runtime check failed; restoring old image (restores vulnerable Node).' >&2
    dokku git:from-image rocketcrab "$rollback"
    exit 1
}
dokku git:from-image rocketcrab "$3" || rollback_on_failure
container=$(docker ps -q --filter name='^/rocketcrab.web.1$')
[[ -n $container ]] || rollback_on_failure
if ! docker exec "$container" /app/.heroku/node/bin/node --version | grep -x 'v22.23.4'; then
    rollback_on_failure
fi
if ! docker exec "$container" /exec npm --version | grep -E '^10\.'; then
    rollback_on_failure
fi
ip=$(docker inspect "$container" --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}')
curl -fsS --max-time 15 "http://$ip:5000/api/stats" >/dev/null || rollback_on_failure
dokku ps:report rocketcrab
# Retain source/rollback metadata, remove only our successfully consumed upload.
rm -- image.tar
printf 'Preserved rollback reference and source bundle in %s\n' "$1"
printf 'Runtime check passed; running external HTTP/assets/party/WebSocket checks next.\n'
REMOTE
if ! node "$script_dir/smoke-runtime.mjs" https://rocketcrab.com; then
    echo 'External health check failed; restoring old image (restores vulnerable Node).' >&2
    ssh "${ssh_options[@]}" "$host" bash -s -- "$remote" <<'ROLLBACK'
set -euo pipefail
rollback=$(<"$1/rollback-image.txt")
dokku git:from-image rocketcrab "$rollback"
ROLLBACK
    exit 1
fi
