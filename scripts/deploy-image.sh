#!/usr/bin/env bash
# ADMIN ONLY: run after coordinator grants Rocketcrab the production slot.
set -euo pipefail
if [[ ${ROCKETCRAB_DEPLOY_APPROVED:-} != yes || $# != 3 ]]; then
    echo 'Usage: ROCKETCRAB_DEPLOY_APPROVED=yes bash scripts/deploy-image.sh <archive> <unique-image-tag> <image-id>' >&2
    exit 1
fi
archive=$1
image=$2
expected=${3#sha256:}
[[ -f $archive && $image =~ ^localhost/rocketcrab:[a-zA-Z0-9._-]+$ && $expected =~ ^[a-f0-9]{64}$ ]]
host=${DOKKU_SSH_HOST:-root@134.209.222.77}
checksum=$(sha256sum "$archive" | awk '{print $1}')
bytes=$(stat -c %s "$archive")
release="rocketcrab-$(date -u +%Y%m%dT%H%M%SZ)-${expected:0:12}"
remote="/root/$release"
# Check headroom before uploading. No compilation occurs on the host.
ssh "$host" bash -s -- "$remote" "$bytes" <<'REMOTE'
set -euo pipefail
available=$(df -B1 --output=avail /var/lib/docker | tail -1)
required=$(($2 * 2 + 2147483648))
(( available > required )) || { echo 'Insufficient disk headroom'; exit 1; }
mem=$(awk '/MemAvailable:/ {print $2}' /proc/meminfo)
(( mem > 524288 )) || { echo 'Insufficient RAM headroom'; exit 1; }
mkdir -m 700 "$1"
REMOTE
scp "$archive" "$host:$remote/image.tar"
ssh "$host" bash -s -- "$remote" "$checksum" "$image" "$expected" "$release" <<'REMOTE'
set -euo pipefail
exec 9>/var/lock/dokku-cve-deploy.lock
flock -n 9 || { echo 'Another app deployment is active'; exit 1; }
cd "$1"
printf '%s  image.tar\n' "$2" | sha256sum -c -
old_container=$(docker ps -q --filter name='^/rocketcrab.web.1$')
[[ -n $old_container ]]
old_image=$(docker inspect "$old_container" --format '{{.Image}}')
rollback="dokku/rocketcrab:rollback-$5"
docker tag "$old_image" "$rollback"
printf '%s\n' "$rollback" > rollback-image.txt
chmod 600 rollback-image.txt
git --git-dir=/home/dokku/rocketcrab bundle create source-before.bundle --all
git --git-dir=/home/dokku/rocketcrab bundle verify source-before.bundle
# docker load is import-only; git:from-image does a tiny FROM-only build.
docker load -i image.tar
actual=$(docker image inspect "$3" --format '{{.Id}}')
[[ ${actual#sha256:} == "$4" ]] || { echo 'Image ID mismatch'; exit 1; }
[[ $(docker image inspect "$3" --format '{{json .Config.Entrypoint}}') == '["/start"]' ]]
[[ $(docker image inspect "$3" --format '{{json .Config.Cmd}}') == '["web"]' ]]
dokku git:from-image rocketcrab "$3"
container=$(docker ps -q --filter name='^/rocketcrab.web.1$')
[[ -n $container ]]
docker exec "$container" /app/.heroku/node/bin/node --version | grep -x 'v22.23.4'
docker exec "$container" /exec npm --version
dokku ps:report rocketcrab
printf 'Preserved rollback reference and source bundle in %s\n' "$1"
printf 'Run HTTP/assets/party/WebSocket smoke checks now; deployment is not verified by this script alone.\n'
REMOTE
