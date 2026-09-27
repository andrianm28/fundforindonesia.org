#!/usr/bin/env bash
# Run the CI jobs of .github/workflows/ci.yml locally, in the same order and
# with the same commands: test, build, migrations, ratchet. The `image` job
# (cd.yml: Docker build + Trivy) is not included; it needs a Docker daemon.
# Neither is the `e2e` job: it needs Playwright browsers, a production build
# and a throwaway database, so it runs on GitHub Actions only.
#
# Usage: npm run ci:local            # all jobs
#        npm run ci:local -- test ratchet
#
# The migrations job needs a Postgres it may drop and recreate, and the test
# job needs one it may create databases in (the claim-migration test builds a
# throwaway database per test, since a migration cannot be proved against an
# empty one). By default they use the local server (cloud sessions have one:
# `service postgresql start`) and the database `ffi_ci_local`. Override with
# CI_LOCAL_DATABASE_URL.
set -euo pipefail
cd "$(dirname "$0")/.."

jobs=("$@")
[ ${#jobs[@]} -eq 0 ] && jobs=(test build migrations ratchet)

step() { printf '\n\033[1m== %s ==\033[0m\n' "$*"; }

# Points DATABASE_URL at the Postgres the database-touching steps use, creating
# ffi_ci_local if this is the local server. Called with "fresh" by the
# migrations job, which has to prove the migrations apply to an EMPTY database.
local_database() {
  local fresh="${1:-}"
  if [ -n "${CI_LOCAL_DATABASE_URL:-}" ]; then
    export DATABASE_URL="$CI_LOCAL_DATABASE_URL"
    return
  fi
  command -v psql >/dev/null || { echo "psql not found; set CI_LOCAL_DATABASE_URL"; return 1; }
  pg_isready -q 2>/dev/null || service postgresql start >/dev/null 2>&1 || true
  # SQL goes in on stdin so no shell layer expands it.
  run_sql() {
    if [ "$(id -u)" = 0 ]; then
      printf '%s\n' "$1" | su postgres -c "psql -v ON_ERROR_STOP=1 -q"
    else
      printf '%s\n' "$1" | psql -v ON_ERROR_STOP=1 -q
    fi
  }
  run_sql_value() {
    if [ "$(id -u)" = 0 ]; then
      printf '%s\n' "$1" | su postgres -c "psql -v ON_ERROR_STOP=1 -qAt"
    else
      printf '%s\n' "$1" | psql -v ON_ERROR_STOP=1 -qAt
    fi
  }
  run_sql "DO \$\$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='ci') THEN CREATE ROLE ci LOGIN PASSWORD 'ci' CREATEDB; END IF; END \$\$;"
  [ "$fresh" = "fresh" ] && run_sql "DROP DATABASE IF EXISTS ffi_ci_local;"
  if [ "$(run_sql_value "SELECT count(*) FROM pg_database WHERE datname = 'ffi_ci_local';")" = "0" ]; then
    run_sql "CREATE DATABASE ffi_ci_local OWNER ci;"
  fi
  export DATABASE_URL="postgresql://ci:ci@localhost:5432/ffi_ci_local?schema=public"
}

run_test() {
  npx prisma generate
  # Not just for the migrations: the claim-migration test in src/__tests__ needs
  # a database it can create throwaway databases in, or it reports itself
  # skipped -- visible, but not proof.
  local_database
  export LEDGER_CLAIM_TEST_DATABASE_URL="$DATABASE_URL"
  npx vitest run
}

run_build() {
  # A dummy URL makes src/lib/prisma.ts use its build-time mock, as in CI.
  DATABASE_URL=postgresql://dummy:dummy@localhost:5432/dummy npx next build
}

run_migrations() {
  local_database fresh
  npx prisma migrate deploy
  local diff_sql
  diff_sql="$(npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script)"
  if ! printf '%s' "$diff_sql" | grep -q "This is an empty migration"; then
    echo "$diff_sql"
    echo "schema.prisma and prisma/migrations disagree; add or fix a migration."
    return 1
  fi
  echo "migrations match schema.prisma"
  # The claim migration against a database that already holds ledger rows,
  # which the deploy above cannot show: it migrated an empty one.
  npx prisma generate
  export LEDGER_CLAIM_TEST_DATABASE_URL="$DATABASE_URL"
  npx vitest run src/__tests__/ledger-transaction-claim-migration.test.ts
}

run_ratchet() {
  npx prisma generate
  node ci/ratchet.mjs
}

for job in "${jobs[@]}"; do
  step "$job"
  "run_$job"
done
step "all green: ${jobs[*]}"
