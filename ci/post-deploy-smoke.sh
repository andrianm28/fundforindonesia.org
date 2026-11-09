#!/bin/bash
# Smoke test of production from outside, after deploy.yml's deploy step
# reported success. ops/deploy.sh already polled /api/health on the host's
# loopback; this checks what visitors reach through nginx and TLS.
#
#   ci/post-deploy-smoke.sh <commit-sha>
#
# Passes when the public pages answer 200 and /api/version reports
# <commit-sha>. A release older than /api/version (a rollback) answers 404
# there: that only warns. Read-only GETs; never changes anything.
#
# Env: PUBLIC_URL (default https://fundforindonesia.org), SMOKE_TRIES
#      (default 3), SMOKE_PAUSE_SECONDS (default 10).
# Tested with a stubbed curl in src/__tests__/post-deploy-smoke.test.ts.
set -euo pipefail

sha="${1:-}"
[[ $sha =~ ^[0-9a-f]{40}$ ]] || { echo "::error::smoke: $(printf '%q' "$sha") is not a full commit SHA"; exit 2; }
base="${PUBLIC_URL:-https://fundforindonesia.org}"
base="${base%/}"
tries="${SMOKE_TRIES:-3}"
pause="${SMOKE_PAUSE_SECONDS:-10}"

code_of() { curl -sS --max-time 15 -o /dev/null -w '%{http_code}' "$1" 2> /dev/null || echo 000; }

failed=0
for path in / /explore/all; do
  for ((t = 1; ; t++)); do
    code="$(code_of "$base$path")"
    [ "$code" = 200 ] && break
    if [ "$t" -ge "$tries" ]; then
      echo "::error::smoke: $base$path answered $code after $tries tries"
      failed=1
      break
    fi
    sleep "$pause"
  done
  [ "$code" = 200 ] && echo "smoke: $path 200"
done

seen="$(curl -fsS --max-time 15 "$base/api/version" 2> /dev/null | jq -r '.revision // empty' 2> /dev/null || true)"
if [ -z "$seen" ]; then
  echo "::warning::smoke: $base/api/version reports no revision (a release older than that route?)"
elif [ "$seen" != "$sha" ]; then
  echo "::error::smoke: production reports $seen, not the deployed $sha"
  failed=1
else
  echo "smoke: production reports $sha"
fi

exit "$failed"
