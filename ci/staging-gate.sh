#!/bin/bash
# Production deploys only what staging already runs healthily
# (docs/runbooks/staging.md). Run by deploy.yml's gate job after
# ci/deploy-gate.sh.
#
#   ci/staging-gate.sh <commit-sha>
#
# Polls staging until it reports <commit-sha> on /api/version and answers 200
# on /api/health, for up to STAGING_WAIT_SECONDS (default 900: cd.yml's image
# build plus the staging timer's 5 minutes). Refuses otherwise. Both paths are
# exempt from staging's basic auth in nginx.
#
# Env: STAGING_URL (default https://stg.fundforindonesia.org),
#      STAGING_WAIT_SECONDS, STAGING_POLL_SECONDS (default 30).
# Needs: curl, jq. Tested with a stubbed curl in src/__tests__/staging-gate.test.ts.
set -euo pipefail

sha="${1:-}"
[[ $sha =~ ^[0-9a-f]{40}$ ]] || { echo "::error::staging gate: $(printf '%q' "$sha") is not a full commit SHA"; exit 2; }
base="${STAGING_URL:-https://stg.fundforindonesia.org}"
base="${base%/}"
wait_s="${STAGING_WAIT_SECONDS:-900}"
poll_s="${STAGING_POLL_SECONDS:-30}"

seen=""
for ((waited = 0; ; waited += poll_s)); do
  seen="$(curl -fsS --max-time 10 "$base/api/version" 2> /dev/null | jq -r '.revision // empty' 2> /dev/null || true)"
  if [ "$seen" = "$sha" ] && curl -fsS --max-time 10 -o /dev/null "$base/api/health" 2> /dev/null; then
    echo "staging runs $sha and is healthy"
    exit 0
  fi
  if [ "$waited" -ge "$wait_s" ]; then break; fi
  echo "staging runs ${seen:-unknown}, waiting for $sha (${waited}s of ${wait_s}s)"
  sleep "$poll_s"
done

echo "::error::Refusing to deploy: staging ($base) does not run $sha healthily after ${wait_s}s (it reports ${seen:-nothing}). Check the staging timer on the host, or dispatch with skip_staging for a rollback or an emergency."
exit 1
