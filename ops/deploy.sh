#!/bin/bash
# Deploy one release of Fund for Indonesia to production on this host
# (.scratch/ci-cd-github-actions, ticket 06).
#
#   ops/deploy.sh <commit-sha> <app-digest> <migrate-digest>
#
# e.g. ops/deploy.sh 3f2c...(40 hex) sha256:ab12...(64 hex) sha256:cd34...(64 hex)
#
# The CD deploy job (ticket 07) runs it over SSH as the `deploy` user, whose
# key is locked to this script by a forced command in authorized_keys (ticket
# 08). With a forced command the client's words arrive in SSH_ORIGINAL_COMMAND
# instead of as arguments, so when there are no arguments the script reads the
# same three words from there. Either way anything but a 40-hex commit SHA and
# two sha256 digests is refused before anything runs: a leaked key can deploy
# an image that is already in GHCR, and nothing else.
#
# The digests are the ones cd.yml's image job pushed for that commit (its
# outputs and run summary). Compose runs the images by digest, so what runs is
# exactly what CI built and scanned. The SHA only names the release: in the
# local tags, the backups, the state files and the log.
#
# Steps, each logged:
#   1. validate the arguments; take a lock, so two deploys never overlap
#   2. pull both images by digest, tag them :<sha> and :<sha>-migrate locally
#   3. start the database if needed, and pg_dump it into backups/, keeping 7
#   4. run `prisma migrate deploy` from the migrate image; if it fails, stop:
#      the running app was never touched
#   5. recreate the app on the new image
#   6. poll /api/health for up to 60 s; if it never answers 200, recreate the
#      app on the previous release and exit non-zero. Migrations are not
#      reverted: they are forward-only, and step 3's dump is the way back.
#   7. record the release in state/current, and the one it replaced in
#      state/previous
#   8. remove the images of releases older than the last 3, always keeping the
#      previous release (the rollback target)
#
# Exit codes: 0 deployed; 1 a step failed before the app was switched (the old
# app still runs); 2 bad arguments; 3 the new app was unhealthy and the
# previous release is back and healthy; 4 the new app was unhealthy and there
# was no healthy previous release to go back to (production needs a human).
#
# Layout of the deploy directory (DEPLOY_DIR, by default the parent of this
# script's directory):
#   .env                     production secrets, read by compose only
#   docker-compose.prod.yml  the production compose file from this repo
#   ops/deploy.sh            this script
#   backups/                 <UTC time>-<sha12>.dump, pg_dump custom format
#   logs/deploy.log          every run, appended
#   state/current, previous  "<sha> <app-digest> <migrate-digest>"
#   state/images             releases pulled onto this host, oldest first
#
# The script never reads or prints .env itself. Compose reads it, and the
# commands run here print no environment. pg_dump runs inside the db
# container over its local socket, so it needs no password either.
#
# Tested with stubbed docker and curl in src/__tests__/ops-deploy-script.test.ts.
set -euo pipefail
shopt -s nullglob
export LC_ALL=C
umask 077 # backups hold personal data

IMAGE=ghcr.io/andrianm28/fundforindonesia.org
DEPLOY_DIR="${DEPLOY_DIR:-$(cd "${BASH_SOURCE[0]%/*}/.." && pwd)}"
STATE_DIR="$DEPLOY_DIR/state"
BACKUP_DIR="$DEPLOY_DIR/backups"
LOG_DIR="$DEPLOY_DIR/logs"
HEALTH_URL=http://127.0.0.1:8093/api/health
HEALTH_POLLS=30 # 2 s apart: 60 s
KEEP_BACKUPS=7
KEEP_RELEASES=3

usage() {
  echo "usage: ops/deploy.sh <commit-sha> <app-digest> <migrate-digest>" >&2
  echo "       a 40-hex commit SHA and two sha256:<64 hex> image digests" >&2
  exit 2
}

# --- 1. Arguments, .env, lock, log -------------------------------------------

args=("$@")
if [ $# -eq 0 ] && [ -n "${SSH_ORIGINAL_COMMAND:-}" ]; then
  # `read -a` splits on whitespace and expands nothing (no globs, no $).
  read -r -a args <<< "$SSH_ORIGINAL_COMMAND"
fi
[ "${#args[@]}" -eq 3 ] || usage
[[ ${args[0]} =~ ^[0-9a-f]{40}$ ]] || usage
[[ ${args[1]} =~ ^sha256:[0-9a-f]{64}$ ]] || usage
[[ ${args[2]} =~ ^sha256:[0-9a-f]{64}$ ]] || usage
sha="${args[0]}"
# Compose interpolates the whole file for every command, so both must be set
# even for commands that use neither image.
export APP_DIGEST="${args[1]}" MIGRATE_DIGEST="${args[2]}"

if [ ! -f "$DEPLOY_DIR/.env" ]; then
  echo "error: no production .env in $DEPLOY_DIR" >&2
  exit 1
fi

mkdir -p "$STATE_DIR" "$BACKUP_DIR" "$LOG_DIR"

exec 9> "$STATE_DIR/deploy.lock"
if ! flock -n 9; then
  echo "error: another deploy is running (lock: $STATE_DIR/deploy.lock)" >&2
  exit 1
fi

# Everything from here on goes to the caller and to the log.
exec > >(tee -a "$LOG_DIR/deploy.log") 2>&1

log() { echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) $*"; }

step="starting"
dump=""
switched=""
finish() {
  local rc=$?
  [ -n "$dump" ] && rm -f -- "$dump.partial"
  if [ "$rc" -eq 1 ] && [ -z "$switched" ]; then
    log "FAILED during: $step. The running app was not changed."
  elif [ "$rc" -eq 1 ]; then
    log "FAILED during: $step, after the app was switched to $sha and passed its health check."
  fi
}
trap finish EXIT

compose() {
  docker compose --project-directory "$DEPLOY_DIR" -f "$DEPLOY_DIR/docker-compose.prod.yml" \
    --env-file "$DEPLOY_DIR/.env" "$@"
}

read_state() { if [ -f "$STATE_DIR/$1" ]; then echo "$(< "$STATE_DIR/$1")"; fi; }
write_state() { printf '%s\n' "${@:2}" > "$STATE_DIR/$1.new" && mv "$STATE_DIR/$1.new" "$STATE_DIR/$1"; }

healthy() {
  local i
  for ((i = 1; i <= HEALTH_POLLS; i++)); do
    curl -fsS --max-time 5 -o /dev/null "$HEALTH_URL" 2> /dev/null && return 0
    sleep 2
  done
  return 1
}

current="$(read_state current)"
previous="$(read_state previous)"
log "Deploying $sha (app $APP_DIGEST, migrate $MIGRATE_DIGEST); running now: ${current%% *}"

# --- 2. Pull ------------------------------------------------------------------

step="pulling the images"
log "Pulling the images"
docker pull "$IMAGE@$APP_DIGEST"
docker pull "$IMAGE@$MIGRATE_DIGEST"
docker tag "$IMAGE@$APP_DIGEST" "$IMAGE:$sha"
docker tag "$IMAGE@$MIGRATE_DIGEST" "$IMAGE:$sha-migrate"

# Put this release last in the ledger of pulled releases, which pruning reads.
pulled=()
while read -r line; do
  [ "${line%% *}" = "$sha" ] || pulled+=("$line")
done < <(read_state images)
write_state images "${pulled[@]}" "$sha $APP_DIGEST $MIGRATE_DIGEST"

# --- 3. Backup ----------------------------------------------------------------

step="backing up the database"
log "Backing up the database"
compose up -d --wait db
dump="$BACKUP_DIR/$(date -u +%Y%m%dT%H%M%SZ)-${sha:0:12}.dump"
compose exec -T db pg_dump -U fundindo -d fund_indonesia --format=custom > "$dump.partial"
[ -s "$dump.partial" ] || { log "pg_dump wrote nothing"; exit 1; }
mv "$dump.partial" "$dump"
log "Backup: $dump"
dumps=("$BACKUP_DIR"/*.dump) # sorted by name, so oldest first
if [ "${#dumps[@]}" -gt "$KEEP_BACKUPS" ]; then
  rm -f -- "${dumps[@]:0:${#dumps[@]}-KEEP_BACKUPS}"
fi

# --- 4. Migrate ---------------------------------------------------------------

step="migrating the database"
log "Migrating the database"
compose --profile migrate run --rm -T migrate

# --- 5, 6. Switch, health check, roll back -----------------------------------

step="switching the app"
log "Switching the app to $sha"
if compose up -d app && healthy; then
  log "Healthy: $HEALTH_URL answers 200"
  switched=1
else
  log "The new app did not answer 200 on $HEALTH_URL within $((HEALTH_POLLS * 2)) s"
  if [ -z "$current" ] || [ "${current%% *}" = "$sha" ]; then
    log "No previous release is recorded to roll back to. Production needs a human."
    exit 4
  fi
  read -r _ APP_DIGEST MIGRATE_DIGEST <<< "$current"
  log "Rolling back to ${current%% *}"
  if compose up -d app && healthy; then
    log "Rolled back to ${current%% *}, which is healthy. $sha was not deployed."
    exit 3
  fi
  log "Rolled back to ${current%% *}, but it is not healthy either. Production needs a human."
  exit 4
fi

# --- 7. Record ----------------------------------------------------------------

step="recording the release"
if [ -n "$current" ] && [ "${current%% *}" != "$sha" ]; then
  previous="$current"
  write_state previous "$previous"
fi
write_state current "$sha $APP_DIGEST $MIGRATE_DIGEST"
log "Deployed $sha"

# --- 8. Prune -----------------------------------------------------------------

# Only this repository's images, by name, never `docker image prune` and never
# --force: other stacks share this host, and docker refuses to remove an image
# a container still uses.
step="pruning old images"
mapfile -t pulled < <(read_state images)
keep=()
for i in "${!pulled[@]}"; do
  read -r s a m <<< "${pulled[$i]}"
  if [ "$i" -ge $((${#pulled[@]} - KEEP_RELEASES)) ] || [ "$s" = "$sha" ] || [ "$s" = "${previous%% *}" ]; then
    keep+=("${pulled[$i]}")
    continue
  fi
  log "Pruning the images of $s"
  # Removing the last tags deletes the image with its digest references; the
  # digest pass only catches an image whose tags were already gone.
  docker image rm "$IMAGE:$s" "$IMAGE:$s-migrate" || log "warning: could not remove the images of $s"
  docker image rm "$IMAGE@$a" "$IMAGE@$m" > /dev/null 2>&1 || true
done
write_state images "${keep[@]}"
log "Done"
