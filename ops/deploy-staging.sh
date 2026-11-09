#!/bin/bash
# Deploy the newest staging release (stg.fundforindonesia.org) on this host.
# See docs/runbooks/staging.md.
#
#   ops/deploy-staging.sh            deploy :staging if it moved (what the timer runs)
#   ops/deploy-staging.sh <sha>      deploy that main commit's staging image (pin or roll back)
#   FORCE=1 ops/deploy-staging.sh    redeploy even if nothing changed
#
# Production is never touched: this script knows only docker-compose.staging.yml
# (project fundforindonesia-stg, its own database and ffi_stg_* volumes), the
# staging .env next to it, and loopback port 8094. It never reads or prints the
# .env; compose does.
#
# cd.yml pushes, for every green main commit, a staging app image
# (:<sha>-staging, built with staging's URLs) and moves :staging to it when that
# commit is main's head. The image's org.opencontainers.image.revision label
# names the commit, whose migrate image (:<sha>-migrate) is the one production
# uses for that commit.
#
# Steps: pull :staging (or :<sha>-staging); stop quietly if that release is
# already running; pull the matching migrate image; start the db; dump it
# (keeping 3); migrate; recreate the app; poll /api/health for about 60 s and,
# if it never answers, go back to the release before it (exit 3).
#
# Exit codes: 0 deployed or nothing to do; 1 a step failed; 2 bad argument;
# 3 the new app was unhealthy and the previous release is back.
#
# Layout of the staging deploy directory (DEPLOY_DIR, by default the parent of
# this script's directory), separate from production's:
#   .env                        staging secrets only (sandbox Sumopod, own keys)
#   docker-compose.staging.yml  from this repo
#   ops/deploy-staging.sh       this script
#   backups/ logs/ state/
set -euo pipefail
shopt -s nullglob
export LC_ALL=C
umask 077

IMAGE=ghcr.io/andrianm28/fundforindonesia.org
self="${BASH_SOURCE[0]}"
[[ $self == */* ]] || self="./$self"
DEPLOY_DIR="${DEPLOY_DIR:-$(cd "${self%/*}/.." && pwd)}"
STATE_DIR="$DEPLOY_DIR/state"
BACKUP_DIR="$DEPLOY_DIR/backups"
LOG_FILE="$DEPLOY_DIR/logs/deploy-staging.log"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:8094/api/health}"
HEALTH_SECONDS=60
KEEP_BACKUPS=3

mkdir -p "$STATE_DIR" "$BACKUP_DIR" "${LOG_FILE%/*}"
log() { echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) $*" | tee -a "$LOG_FILE"; }

if [ $# -gt 1 ] || { [ $# -eq 1 ] && ! [[ $1 =~ ^[0-9a-f]{40}$ ]]; }; then
  echo "usage: ops/deploy-staging.sh [<40-hex commit sha on main>]" >&2
  exit 2
fi
tag="${1:+$1-staging}"
tag="${tag:-staging}"

if [ ! -f "$DEPLOY_DIR/.env" ]; then
  log "Refused: no staging .env in $DEPLOY_DIR"
  exit 1
fi
if [ ! -f "$DEPLOY_DIR/docker-compose.staging.yml" ]; then
  log "Refused: no docker-compose.staging.yml in $DEPLOY_DIR"
  exit 1
fi

exec 9> "$STATE_DIR/deploy.lock"
if ! flock -n 9; then
  # The timer fires every few minutes; a deploy still running is normal.
  exit 0
fi

compose() {
  docker compose --project-directory "$DEPLOY_DIR" -f "$DEPLOY_DIR/docker-compose.staging.yml" \
    --env-file "$DEPLOY_DIR/.env" "$@"
}
digest_of() { docker image inspect --format '{{range .RepoDigests}}{{println .}}{{end}}' "$1" | sed -n 's/.*@\(sha256:[0-9a-f]\{64\}\)$/\1/p' | head -1; }
healthy() {
  local polls
  for ((polls = 0; polls < HEALTH_SECONDS / 2; polls++)); do
    curl -fsS --max-time 5 -o /dev/null "$HEALTH_URL" 2> /dev/null && return 0
    sleep 2
  done
  return 1
}
read_state() { if [ -f "$STATE_DIR/$1" ]; then echo "$(< "$STATE_DIR/$1")"; fi; }
write_state() { printf '%s\n' "$2" > "$STATE_DIR/$1.new" && mv "$STATE_DIR/$1.new" "$STATE_DIR/$1"; }

# --- Pull, and stop quietly when nothing moved ------------------------------

step="pulling $IMAGE:$tag"
trap 'log "FAILED (exit $?) during: $step"' ERR
docker pull -q "$IMAGE:$tag" > /dev/null
app_digest="$(digest_of "$IMAGE:$tag")"
sha="$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$IMAGE:$tag")"
if ! [[ $app_digest =~ ^sha256:[0-9a-f]{64}$ ]] || ! [[ $sha =~ ^[0-9a-f]{40}$ ]]; then
  log "FAILED: $IMAGE:$tag has no usable digest ($app_digest) or revision label ($sha)"
  exit 1
fi

docker tag "$IMAGE:$tag" "$IMAGE:$sha-staging"

current="$(read_state current)"
if [ "${FORCE:-}" != 1 ] && [ "$(echo "$current" | cut -d' ' -f1-2)" = "$sha $app_digest" ] && healthy; then
  exit 0
fi
# A release that already failed its health check is not retried by the timer
# every 5 minutes (each retry would dump and migrate again and rotate the good
# dumps out). It waits for a newer :staging, an explicit <sha>, or FORCE=1.
if [ "${FORCE:-}" != 1 ] && [ $# -eq 0 ] && [ "$(read_state failed)" = "$sha $app_digest" ]; then
  exit 0
fi

log "Deploying staging $sha (app $app_digest); running now: ${current:-nothing recorded}"

step="pulling the migrate image"
docker pull -q "$IMAGE:$sha-migrate" > /dev/null
migrate_digest="$(digest_of "$IMAGE:$sha-migrate")"
if ! [[ $migrate_digest =~ ^sha256:[0-9a-f]{64}$ ]]; then
  log "FAILED: $IMAGE:$sha-migrate has no usable digest ($migrate_digest)"
  exit 1
fi
export APP_DIGEST="$app_digest" MIGRATE_DIGEST="$migrate_digest"
release="$sha $APP_DIGEST $MIGRATE_DIGEST"

step="starting the database"
compose up -d --wait db

step="backing up the database"
dump="$BACKUP_DIR/$(date -u +%Y%m%dT%H%M%SZ)-${sha:0:12}.dump"
# shellcheck disable=SC2016 # expanded inside the db container
if ! compose exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$dump.partial"; then
  rm -f -- "$dump.partial"
  false
fi
mv "$dump.partial" "$dump"

step="running the migrations"
compose --profile migrate run --rm -T migrate

step="recreating the app"
compose up -d app
trap - ERR
if ! healthy; then
  write_state failed "$sha $APP_DIGEST"
  if [ -n "$current" ]; then
    log "Unhealthy after 60 s; going back to $(echo "$current" | cut -d' ' -f1)"
    read -r _ APP_DIGEST MIGRATE_DIGEST <<< "$current"
    compose up -d app && healthy && log "Previous staging release is back and healthy"
  else
    log "Unhealthy after 60 s and no previous release recorded"
  fi
  exit 3
fi

[ -n "$current" ] && [ "$current" != "$release" ] && write_state previous "$current"
write_state current "$release"
rm -f -- "$STATE_DIR/failed"
log "Deployed staging $sha; /api/health answers"

# Old dumps go only after a successful deploy, so failures never rotate out the
# dumps taken before them.
backups=("$BACKUP_DIR"/*.dump)
for ((i = 0; i < ${#backups[@]} - KEEP_BACKUPS; i++)); do rm -f -- "${backups[$i]}"; done

# Keep only the images of the current and previous staging releases.
keep="$(read_state current) $(read_state previous)"
while read -r ref; do
  [ -n "$ref" ] || continue
  t="${ref##*:}"
  s="${t%-staging}"
  [[ $keep == *"$s"* ]] || docker image rm "$ref" > /dev/null 2>&1 || true
done < <(docker image ls --format '{{.Repository}}:{{.Tag}}' "$IMAGE" | grep -E -- ':[0-9a-f]{40}-staging$' || true)
