#!/bin/bash
# SessionStart hook for Claude Code cloud sessions: makes a fresh container
# ready for the full test suite, tsc, lint and build. Local sessions skip it.
# The environment's setup script installs Node 24 at /opt/node24; see
# docs/agents/cloud-environment.md.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

# The repo requires Node 24 (.nvmrc, engines); the cloud image puts 22 on PATH.
if [ -x /opt/node24/bin/node ]; then
  export PATH="/opt/node24/bin:$PATH"
  # Persist for every Bash command Claude runs in this session.
  if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
    echo 'export PATH="/opt/node24/bin:$PATH"' >> "$CLAUDE_ENV_FILE"
  fi
else
  echo "warning: /opt/node24 missing; running on $(node -v). Add the setup script from docs/agents/cloud-environment.md." >&2
fi

# npm is canonical (the Dockerfile and CI use package-lock.json). `npm ci`
# installs the lockfile exactly; `npm install` rewrote it (dropping optional
# peer entries) and left the tree dirty. Skip the install when node_modules
# already matches the lockfile (resumed or cached sessions).
stamp=node_modules/.package-lock.sha256
want=$(sha256sum package-lock.json | cut -d' ' -f1)-$(node -v)
if [ ! -f "$stamp" ] || [ "$(cat "$stamp")" != "$want" ]; then
  npm ci --no-audit --no-fund
  echo "$want" > "$stamp"
fi

# src/generated/prisma is gitignored; without it ~29 test files fail to
# resolve "@/generated/prisma/client". Always regenerate: it is quick, and a
# resumed session may have changed the schema.
npx prisma generate
