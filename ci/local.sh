#!/usr/bin/env bash
# Run the CI jobs of .github/workflows/ci.yml locally, in the same order and
# with the same commands: test, build, migrations, ratchet. The `image` job
# (cd.yml: Docker build + Trivy) is not included; it needs a Docker daemon.
#
# Usage: npm run ci:local            # all jobs
#        npm run ci:local -- test ratchet
#
# The migrations job needs a Postgres it may drop and recreate. By default it
# uses the local server (cloud sessions have one: `service postgresql start`)
# and a throwaway database `ffi_ci_local`. Override with CI_LOCAL_DATABASE_URL.
set -euo pipefail
cd "$(dirname "$0")/.."

jobs=("$@")
[ ${#jobs[@]} -eq 0 ] && jobs=(test build migrations ratchet)

step() { printf '\n\033[1m== %s ==\033[0m\n' "$*"; }

run_test() {
  npx prisma generate
  npx vitest run
}

run_build() {
  # A dummy URL makes src/lib/prisma.ts use its build-time mock, as in CI.
  DATABASE_URL=postgresql://dummy:dummy@localhost:5432/dummy npx next build
}

run_migrations() {
  local url="${CI_LOCAL_DATABASE_URL:-}"
  if [ -z "$url" ]; then
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
    run_sql "DROP DATABASE IF EXISTS ffi_ci_local;"
    run_sql "DO \$\$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='ci') THEN CREATE ROLE ci LOGIN PASSWORD 'ci' CREATEDB; END IF; END \$\$;"
    run_sql "CREATE DATABASE ffi_ci_local OWNER ci;"
    url="postgresql://ci:ci@localhost:5432/ffi_ci_local?schema=public"
  fi
  export DATABASE_URL="$url"
  npx prisma migrate deploy
  local diff_sql
  diff_sql="$(npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script)"
  if ! printf '%s' "$diff_sql" | grep -q "This is an empty migration"; then
    echo "$diff_sql"
    echo "schema.prisma and prisma/migrations disagree; add or fix a migration."
    return 1
  fi
  echo "migrations match schema.prisma"
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
