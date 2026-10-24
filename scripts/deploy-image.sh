#!/usr/bin/env bash
# ADMIN ONLY: run after coordinator grants Rocketcrab the production slot.
# Starts a durable remote job and returns its monitoring location, not success.
set -euo pipefail
if [[ ${ROCKETCRAB_DEPLOY_APPROVED:-} != yes || $# != 4 ]]; then
    echo 'Usage: ROCKETCRAB_DEPLOY_APPROVED=yes bash scripts/deploy-image.sh <archive> <unique-image-tag> <image-id> <source-commit>' >&2
    exit 1
fi
archive=$1
script_dir=$(cd "$(dirname "$0")" && pwd)
image=$2
expected=${3#sha256:}
revision=$4
[[ -f $archive && $image =~ ^localhost/rocketcrab:[a-zA-Z0-9._-]+$ && $expected =~ ^[a-f0-9]{64}$ && $revision =~ ^[a-f0-9]{40}$ ]]
if [[ $(findmnt -no FSTYPE -T "$(dirname "$archive")") == tmpfs ]]; then
    echo 'Refusing to read a multi-GB archive from RAM-backed tmpfs' >&2
    exit 1
fi
ssh_options=(-o BatchMode=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=15)
checksum=$(sha256sum "$archive" | awk '{print $1}')
if [[ -f $archive.sha256 ]]; then
    recorded=$(awk 'NR == 1 {print $1}' "$archive.sha256")
    [[ $checksum == "$recorded" ]]
fi
host=${DOKKU_SSH_HOST:-root@134.209.222.77}
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
scp "${ssh_options[@]}" "$script_dir/deploy-image-remote.sh" "$script_dir/smoke-runtime.mjs" "$host:$remote/"
ssh "${ssh_options[@]}" "$host" bash -s -- "$remote" "$checksum" "$image" "$expected" "$release" "$revision" <<'REMOTE'
set -euo pipefail
umask 077
cd "$1"
# Entire import/check/rollback sequence survives SSH/harness disconnects.
nohup bash ./deploy-image-remote.sh "$@" > deploy.log 2>&1 < /dev/null &
printf '%s\n' "$!" > deploy.pid
chmod 600 deploy.log deploy.pid
printf 'Durable Rocketcrab job started: %s\n' "$1"
REMOTE
printf '\nNOT YET VERIFIED. Monitor %s:%s/deploy.log and exit-status.\n' "$host" "$remote"
printf 'Wait for exit-status=0 AND independently verify runtime/public health/other app state.\n'
printf 'On timeout/disconnect, reconcile this job first; never launch a duplicate deployment.\n'
