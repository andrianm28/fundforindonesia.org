#!/bin/bash
# Run the whole app inside a Claude Code cloud session (a "thread"), against a
# throwaway local Postgres, so a thread can click through a change without
# touching staging or production. See docs/agents/dev-thread.md.
#
#   scripts/dev-thread.sh            start Postgres, migrate, seed once, run `next dev` on :3000
#   scripts/dev-thread.sh --reset    drop the local database first (fresh seed)
#   scripts/dev-thread.sh --stop     stop the dev server and Postgres
#   scripts/dev-thread.sh --env      print the env exports, to run other commands against the same database
#
# Every value below is a throwaway placeholder, the same kind CI uses. No real
# key, password or provider credential belongs here or in the session env.
# Payments go through the mock provider (allowed only outside NODE_ENV=production);
# mail is the mock mailer (logged, never sent).
set -euo pipefail

cd "$(dirname "$0")/.."
STATE="${DEV_THREAD_STATE:-/tmp/ffi-dev-thread}"
PORT="${PORT:-3000}"
DB_NAME=ffi
DB_USER=ffi
mkdir -p "$STATE"

if [ -x /opt/node24/bin/node ]; then export PATH="/opt/node24/bin:$PATH"; fi

dev_env() {
  cat << EOF
export DATABASE_URL='postgresql://$DB_USER:$DB_USER@localhost:5432/$DB_NAME?schema=public'
export NEXTAUTH_SECRET='dev-thread-placeholder-not-a-secret'
export NEXTAUTH_URL='http://localhost:$PORT'
export NEXT_PUBLIC_BASE_URL='http://localhost:$PORT'
export NEXT_PUBLIC_DONATIONS_ENABLED='true'
export NEXT_PUBLIC_VOLUNTEER_ENABLED='true'
export NEXT_TELEMETRY_DISABLED='1'
export PAYMENT_PROVIDER='mock'
export MOCK_MIDTRANS_SERVER_KEY='dev-thread-placeholder-not-a-secret'
export MAIL_PROVIDER='mock'
export SHOW_DEMO_CAMPAIGNS='true'
export JOBS_SECRET='dev-thread-placeholder-jobs-secret'
export FIELD_ENCRYPTION_KEY='AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='
export FIELD_ENCRYPTION_KEY_ID='enc-dev-1'
export FIELD_HMAC_KEY='AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE='
export FIELD_HMAC_KEY_ID='hmac-dev-1'
export PRIVATE_DOCUMENT_DIR='$STATE/private-documents'
EOF
}

stop_server() {
  if [ -f "$STATE/next.pid" ] && kill -0 "$(cat "$STATE/next.pid")" 2> /dev/null; then
    # next dev forks; take the whole process group down.
    kill -- -"$(cat "$STATE/next.pid")" 2> /dev/null || kill "$(cat "$STATE/next.pid")" || true
  fi
  rm -f "$STATE/next.pid"
}

as_postgres() { if [ "$(id -u)" = 0 ]; then su postgres -c "$1"; else sudo -u postgres sh -c "$1"; fi; }

case "${1:-}" in
  --env)
    dev_env
    exit 0
    ;;
  --stop)
    stop_server
    service postgresql stop > /dev/null 2>&1 || true
    echo "stopped"
    exit 0
    ;;
  --reset | "") ;;
  *)
    sed -n '2,15p' "$0"
    exit 2
    ;;
esac

# shellcheck disable=SC1090
eval "$(dev_env)"
mkdir -p "$PRIVATE_DOCUMENT_DIR"

echo "== Postgres"
service postgresql start > /dev/null
for _ in $(seq 1 20); do pg_isready -q -h localhost && break; sleep 0.5; done
as_postgres "psql -tc \"SELECT 1 FROM pg_roles WHERE rolname='$DB_USER'\" | grep -q 1 || psql -qc \"CREATE ROLE $DB_USER LOGIN PASSWORD '$DB_USER' CREATEDB\""
if [ "${1:-}" = --reset ]; then
  stop_server
  as_postgres "dropdb --if-exists $DB_NAME"
  rm -f "$STATE/seeded"
fi
as_postgres "psql -tc \"SELECT 1 FROM pg_database WHERE datname='$DB_NAME'\" | grep -q 1 || createdb -O $DB_USER $DB_NAME"

echo "== Dependencies"
if [ ! -d node_modules ]; then npm ci --no-audit --no-fund; fi
npx prisma generate > /dev/null

echo "== Migrations"
npx prisma migrate deploy

if [ ! -f "$STATE/seeded" ]; then
  echo "== Demo seed (prisma/seed.ts; every seeded account's password is password123)"
  npx tsx prisma/seed.ts
  touch "$STATE/seeded"
fi

echo "== next dev on :$PORT"
stop_server
setsid npx next dev -p "$PORT" > "$STATE/next.log" 2>&1 < /dev/null &
echo $! > "$STATE/next.pid"
for _ in $(seq 1 120); do
  code="$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:$PORT/api/health" || true)"
  if [ "$code" = 200 ]; then
    echo "ready: http://localhost:$PORT  (log: $STATE/next.log, stop: scripts/dev-thread.sh --stop)"
    echo "sign in as admin@fundforindonesia.test / password123 (Admin), moderator@... (Verifier), donor@... (Donor)"
    exit 0
  fi
  sleep 1
done
echo "next dev did not answer /api/health within 120 s; last log lines:" >&2
tail -30 "$STATE/next.log" >&2
exit 1
