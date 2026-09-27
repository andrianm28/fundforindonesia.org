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
# same three words from there (its first line only). The client must send just
# those three words, not the script's name. Anything but a 40-hex commit SHA
# and two sha256 digests is refused, and logged, before anything runs: a
# leaked key can deploy an image that is already in GHCR, and nothing else.
#
# The digests are the ones cd.yml's image job pushed for that commit (its
# outputs and run summary). Compose runs the images by digest, so what runs is
# exactly what CI built and scanned. The SHA names the release: in the local
# tags, the backups, the state files and the log. A release is the three
# together; a rebuild of the same commit is a different release.
#
# Steps, each logged:
#   1. validate the arguments; take a lock, so two deploys never overlap
#   2. pull both images by digest, tag them :<sha> and :<sha>-migrate locally
#   3. start the database if needed, and pg_dump it into backups/, keeping 7
#   4. run `prisma migrate deploy` from the migrate image; if it fails, stop:
#      the running app was never touched. The contact-field backfill (ADR 0012)
#      is NOT part of this: it is run by hand beforehand, and the migration that
#      drops the plaintext refuses to run without it. See the note at step 4.
#   5. recreate the app on the new image
#   6. poll /api/health for about 60 s; if it never answers 200, recreate the
#      app on the release that was running (or, when that is this very
#      release, on the previous one) and exit non-zero. Migrations are not
#      reverted: they are forward-only, and step 3's dump is the way back.
#   7. record the release in state/current, and the one it replaced in
#      state/previous
#   8. remove this repository's images of releases older than the last 3,
#      always keeping the previous release (the rollback target)
#
# Exit codes: 0 deployed; 1 a step failed (the log says which, and whether the
# app had been switched; before step 5 the old app still runs); 2 bad
# arguments; 3 the new app was unhealthy and the release before it is back and
# healthy; 4 the new app was unhealthy and there was no healthy release to go
# back to (production needs a human).
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
self="${BASH_SOURCE[0]}"
[[ $self == */* ]] || self="./$self"
DEPLOY_DIR="${DEPLOY_DIR:-$(cd "${self%/*}/.." && pwd)}"
STATE_DIR="$DEPLOY_DIR/state"
BACKUP_DIR="$DEPLOY_DIR/backups"
LOG_FILE="$DEPLOY_DIR/logs/deploy.log"
HEALTH_URL=http://127.0.0.1:8093/api/health
HEALTH_SECONDS=60 # polled every 2 s
KEEP_BACKUPS=7
KEEP_RELEASES=3

mkdir -p "$STATE_DIR" "$BACKUP_DIR" "${LOG_FILE%/*}"

log() { echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) $*"; }

# --- 1. Arguments, .env, lock, log -------------------------------------------

words=("$@")
if [ $# -eq 0 ] && [ -n "${SSH_ORIGINAL_COMMAND:-}" ]; then
  # `read -a` splits on whitespace and expands nothing (no globs, no $).
  read -r -a words <<< "$SSH_ORIGINAL_COMMAND"
fi

refuse() {
  # %q, so whatever was sent is logged as one inert line.
  if [ $# -eq 0 ] && [ -n "${SSH_ORIGINAL_COMMAND:-}" ]; then
    log "Refused SSH_ORIGINAL_COMMAND: $(printf '%q' "$SSH_ORIGINAL_COMMAND")" >> "$LOG_FILE"
  else
    log "Refused arguments:$(printf ' %q' "$@")" >> "$LOG_FILE"
  fi
  echo "usage: ops/deploy.sh <commit-sha> <app-digest> <migrate-digest>" >&2
  echo "       a 40-hex commit SHA and two sha256:<64 hex> image digests" >&2
  exit 2
}
if [ "${#words[@]}" -ne 3 ] ||
  ! [[ ${words[0]} =~ ^[0-9a-f]{40}$ ]] ||
  ! [[ ${words[1]} =~ ^sha256:[0-9a-f]{64}$ ]] ||
  ! [[ ${words[2]} =~ ^sha256:[0-9a-f]{64}$ ]]; then
  refuse "$@"
fi
sha="${words[0]}"
# Compose interpolates the whole file for every command, so both must be set
# even for commands that use neither image.
export APP_DIGEST="${words[1]}" MIGRATE_DIGEST="${words[2]}"
release="$sha $APP_DIGEST $MIGRATE_DIGEST"

if [ ! -f "$DEPLOY_DIR/.env" ]; then
  log "Refused $sha: no production .env in $DEPLOY_DIR" | tee -a "$LOG_FILE" >&2
  exit 1
fi

exec 9> "$STATE_DIR/deploy.lock"
if ! flock -n 9; then
  log "Refused $sha: another deploy is running (lock: $STATE_DIR/deploy.lock)" | tee -a "$LOG_FILE" >&2
  exit 1
fi

# Everything from here on goes to the caller and to the log. If the caller
# goes away (the SSH session drops), tee keeps writing the log, and the
# script ignores SIGPIPE rather than dying half-way through a deploy. tee
# does not inherit the lock.
trap '' PIPE
exec > >(exec 9>&-; exec tee -a --output-error=warn-nopipe "$LOG_FILE") 2>&1
tee_pid=$!

step="starting"
dump=""
switched=""
finish() {
  local rc=$?
  [ -n "$dump" ] && rm -f -- "$dump.partial"
  case "$rc" in
    0 | 3 | 4) ;;
    *)
      if [ -z "$switched" ]; then
        log "FAILED during: $step (exit $rc). The running app was not changed."
      else
        log "FAILED during: $step (exit $rc), after the app was switched to $sha and passed its health check."
      fi
      rc=1
      ;;
  esac
  exec >&- 2>&-
  wait "$tee_pid" 2> /dev/null || true
  exit "$rc"
}
trap finish EXIT

compose() {
  docker compose --project-directory "$DEPLOY_DIR" -f "$DEPLOY_DIR/docker-compose.prod.yml" \
    --env-file "$DEPLOY_DIR/.env" "$@"
}

# A release is one "<sha> <app-digest> <migrate-digest>" line.
sha_of() { echo "${1%% *}"; }
read_state() { if [ -f "$STATE_DIR/$1" ]; then echo "$(< "$STATE_DIR/$1")"; fi; }
write_state() { printf '%s\n' "${@:2}" > "$STATE_DIR/$1.new" && mv "$STATE_DIR/$1.new" "$STATE_DIR/$1"; }

healthy() {
  local deadline=$((SECONDS + HEALTH_SECONDS)) polls
  for ((polls = 0; polls < HEALTH_SECONDS / 2 && SECONDS < deadline; polls++)); do
    curl -fsS --max-time 5 -o /dev/null "$HEALTH_URL" 2> /dev/null && return 0
    sleep 2
  done
  return 1
}

# Recreate the app on a release, and wait for it to answer /api/health.
switch_to() {
  read -r _ APP_DIGEST MIGRATE_DIGEST <<< "$1"
  compose up -d app && healthy
}

current="$(read_state current)"
previous="$(read_state previous)"
log "Deploying $sha (app $APP_DIGEST, migrate $MIGRATE_DIGEST); running now: ${current:-nothing recorded}"

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
  [ "$line" = "$release" ] || pulled+=("$line")
done < <(read_state images)
write_state images "${pulled[@]}" "$release"

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

# The backfill is a SEPARATE step, run by hand before this script, and this
# script does not run it. Two reasons, both about what a deploy may do to a
# database that already holds a Donor's contact details:
#
#   - prisma/migrations/20260930010000_drop_contact_plaintext (ADR 0012,
#     prd-compliance 16) drops the plaintext email, phone and bank account
#     number columns. It refuses to run while any row still has a plaintext
#     value with nothing sealed for it, naming the columns, so deploying
#     without the backfill stops HERE with the old app still serving and
#     nothing lost. That refusal is the guarantee; this script does not need to
#     repeat it, and running the backfill itself would take the guard away.
#   - The backfill needs FIELD_ENCRYPTION_KEY and FIELD_HMAC_KEY, which the
#     migrate image has no reason to carry, and on a large database it is long
#     enough that it belongs where a person can watch it, stop it and re-run it.
#
# Do NOT change FIELD_ENCRYPTION_KEY_ID or FIELD_HMAC_KEY_ID between two runs of
# the backfill. The backfill skips rows it has already sealed, so a key that
# changes half-way through leaves one table holding rows under two key ids --
# and there is no keyring yet, so `decrypt` cannot read the older ones. The
# migration refuses that, naming the field, the key ids and the rows; while the
# plaintext is still there, clear the sealed columns on those rows and run the
# backfill again under a single key id.
#
# Run it against the same DATABASE_URL, from a checkout of this release, with
# the production .env loaded:
#
#   npx tsx prisma/backfill-contact-fields.ts
#
# It is safe to run more than once and safe to interrupt. ops/deploy.sh step 3
# has already dumped the database by the time any of this matters, so a backfill
# that goes wrong has a dump to go back to.
step="migrating the database"
log "Migrating the database"
compose --profile migrate run --rm -T migrate

# --- 5, 6. Switch, health check, roll back -----------------------------------

step="switching the app"
log "Switching the app to $sha"
if switch_to "$release"; then
  switched=1
  log "Healthy: $HEALTH_URL answers 200"
else
  log "The new app did not answer 200 on $HEALTH_URL within $HEALTH_SECONDS s"
  # Back to what was running, unless that was this very release.
  target="$current"
  [ "$target" = "$release" ] && target="$previous"
  if [ -z "$target" ]; then
    log "No earlier release is recorded to roll back to. Production needs a human."
    exit 4
  fi
  log "Rolling back to $(sha_of "$target")"
  if switch_to "$target"; then
    log "Rolled back to $(sha_of "$target"), which is healthy. $sha was not deployed."
    exit 3
  fi
  log "Rolled back to $(sha_of "$target"), but it is not healthy either. Production needs a human."
  exit 4
fi

# --- 7. Record ----------------------------------------------------------------

step="recording the release"
if [ -n "$current" ] && [ "$current" != "$release" ]; then
  previous="$current"
  write_state previous "$previous"
fi
write_state current "$release"
log "Deployed $sha"

# --- 8. Prune -----------------------------------------------------------------

# Only this repository's images, by name, never `docker image prune` and never
# --force: other stacks share this host, and docker refuses to remove an image
# a container still uses.
step="pruning old images"
mapfile -t pulled < <(read_state images)
keep=()
for i in "${!pulled[@]}"; do
  if [ "$i" -ge $((${#pulled[@]} - KEEP_RELEASES)) ] ||
    [ "${pulled[$i]}" = "$release" ] || [ "${pulled[$i]}" = "$previous" ]; then
    keep+=("${pulled[$i]}")
  fi
done
kept_shas=" "
for line in "${keep[@]}"; do kept_shas+="$(sha_of "$line") "; done
for line in "${pulled[@]}"; do
  [[ " ${keep[*]} " == *" $line "* ]] && continue
  read -r s a m <<< "$line"
  log "Pruning the images of $s ($a)"
  # A rebuild of a kept commit owns the :<sha> tags now; leave them.
  if [[ $kept_shas != *" $s "* ]]; then
    docker image rm "$IMAGE:$s" "$IMAGE:$s-migrate" || log "warning: could not remove the images of $s"
  fi
  # Removing the last tags deletes the image with its digest references; this
  # catches an untagged image (an older build of a kept commit, say).
  docker image rm "$IMAGE@$a" "$IMAGE@$m" > /dev/null 2>&1 || true
done
write_state images "${keep[@]}"
log "Done"
