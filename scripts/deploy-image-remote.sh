#!/usr/bin/env bash
# Uploaded/launched by deploy-image.sh under nohup, never run during preparation.
set -euo pipefail
cd "${1:?release directory}"
umask 077
trap 'result=$?; printf "%s\n" "$result" > exit-status' EXIT
exec 9>/var/lock/dokku-cve-deploy.lock
flock -n 9 || { echo 'Another app deployment is active'; exit 1; }
printf '%s  image.tar\n' "$2" | sha256sum -c -
mem=$(awk '/MemAvailable:/ {print $2}' /proc/meminfo)
(( mem > 524288 )) || { echo 'Insufficient RAM headroom'; exit 1; }
old_container=$(docker ps -q --filter name='^/rocketcrab.web.1$')
[[ -n $old_container ]]
old_image=$(docker inspect "$old_container" --format '{{.Image}}')
rollback="dokku/rocketcrab:rollback-$5"
docker tag "$old_image" "$rollback"
[[ $(docker image inspect "$rollback" --format '{{.Id}}') == "$old_image" ]]
printf '%s\n' "$rollback" > rollback-image.txt
printf '%s\n' "$old_container" > old-container.txt
git --git-dir=/home/dokku/rocketcrab show-ref --verify refs/heads/master > source-ref.txt
git --git-dir=/home/dokku/rocketcrab bundle create source-before.bundle --all
git --git-dir=/home/dokku/rocketcrab bundle verify source-before.bundle
# Capture EFFECTIVE original routing, including inferred mappings, before import.
dokku ports:report rocketcrab > ports-before.txt
configured=$(dokku ports:report rocketcrab --ports-map)
detected=$(dokku ports:report rocketcrab --ports-map-detected)
read -r -a mappings <<< "${configured:-$detected}"
(( ${#mappings[@]} > 0 ))
for mapping in "${mappings[@]}"; do
    [[ $mapping =~ ^https?:[0-9]+:[0-9]+$ ]] || { echo 'Unexpected port mapping'; exit 1; }
done
printf '%s\n' "${mappings[@]}" > original-mappings.txt
# docker load imports only; git:from-image does a tiny FROM-only build.
docker load -i image.tar
actual=$(docker image inspect "$3" --format '{{.Id}}')
[[ ${actual#sha256:} == "$4" ]] || { echo 'Image ID mismatch'; exit 1; }
[[ $(docker image inspect "$3" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}') == "$6" ]]
printf '%s\n' "$6" > new-source-commit.txt
[[ $(docker image inspect "$3" --format '{{json .Config.Entrypoint}}') == '["/start"]' ]]
[[ $(docker image inspect "$3" --format '{{json .Config.Cmd}}') == '["web"]' ]]
if docker image inspect "$3" --format '{{json .Config.Env}}' | grep -q 'NODE_OPTIONS='; then
    echo 'Refusing image with baked NODE_OPTIONS; keep runtime tuning in Dokku' >&2
    exit 1
fi
rollback_on_failure() {
    echo 'Deployment/health check failed; restoring old image (restores vulnerable Node).' >&2
    dokku ports:set rocketcrab "${mappings[@]}"
    dokku git:from-image rocketcrab "$rollback"
    exit 1
}
# Explicit app-only preservation prevents EXPOSE from changing inferred routing.
dokku ports:set rocketcrab "${mappings[@]}"
dokku git:from-image rocketcrab "$3" || rollback_on_failure
current=$(dokku ports:report rocketcrab --ports-map)
if [[ $(tr ' ' '\n' <<< "$current" | sort) != $(sort original-mappings.txt) ]]; then
    rollback_on_failure
fi
dokku ports:report rocketcrab > ports-after.txt
container=$(docker ps -q --filter name='^/rocketcrab.web.1$')
[[ -n $container && $container != "$old_container" ]] || rollback_on_failure
if ! docker exec "$container" /app/.heroku/node/bin/node --version | grep -x 'v22.23.4'; then
    rollback_on_failure
fi
if ! docker exec "$container" /exec npm --version | grep -E '^10\.'; then
    rollback_on_failure
fi
# In-container application smoke against its own port (no production game state
# beyond one in-memory party; the app already serves this network path).
if ! timeout 60 docker exec -i "$container" /app/.heroku/node/bin/node \
    --input-type=module - http://127.0.0.1:5000 < smoke-runtime.mjs; then
    rollback_on_failure
fi
# Host-side nginx routing/assets checks. --resolve avoids relying on hairpin NAT
# while still validating the public hostname/TLS/routing configuration.
for host_path in rocketcrab.com:/ rocketcrab.com:/join rocketcrab.com:/library kids.rocketcrab.com:/; do
    name=${host_path%%:*}
    path=${host_path#*:}
    curl -fsS --max-time 20 --resolve "$name:443:127.0.0.1" "https://$name$path" >/dev/null || rollback_on_failure
done
sleep 5
if [[ $(docker inspect "$container" --format '{{.State.Running}}') != true ]]; then
    rollback_on_failure
fi
if [[ $(docker inspect "$container" --format '{{.RestartCount}}') != 0 ]]; then
    echo 'New web container restarted during startup' >&2
    rollback_on_failure
fi
docker logs --tail 40 "$container" > container-startup.log 2>&1 || true
dokku ps:report rocketcrab > ps-after.txt
printf 'Runtime, preserved routing, and health checks passed.\n'
# Retain source/rollback metadata; remove only our consumed upload archive.
rm -- image.tar
# Do not release the coordinator slot before Dokku retires the old web container.
for ((i=0; i<30; i++)); do
    state=$(docker inspect "$old_container" --format '{{.State.Running}}' 2>/dev/null || true)
    if [[ $state != true ]]; then
        printf 'Old container retired.\n'
        exit 0
    fi
    sleep 5
done
echo 'New app healthy, but old container retirement still pending; keep slot held.' >&2
exit 2
