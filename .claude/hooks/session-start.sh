#!/bin/bash
# SessionStart hook for Claude Code on the web: makes a fresh cloud container
# ready for `npm run test:run` and `npm run lint`. Local/VPS sessions skip it.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

# npm is canonical (Dockerfile uses package-lock.json); bun.lock is not.
# `npm install` rather than `npm ci` so the cached container state is reused.
npm install --no-audit --no-fund

# src/generated/prisma is gitignored and nothing generates it after install;
# without it ~29 test files fail to resolve "@/generated/prisma/client".
# See docs/agents/issue-tracker.md, "Fresh-worktree setup gap".
npx prisma generate

# The workflow in CLAUDE.md runs on the mattpocock-skills plugin, which
# .claude/settings.json enables but a fresh cloud container does not have
# installed. Idempotent; a failure here must not block the session.
if command -v claude >/dev/null 2>&1; then
  claude plugin install mattpocock-skills@claude-plugins-official || \
    echo "warning: could not install mattpocock-skills plugin" >&2
fi
