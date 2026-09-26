#!/bin/bash
# SessionStart hook for Claude Code cloud sessions: makes a fresh container
# ready for the full test suite, tsc, lint and build. Local sessions skip it.
# Adapted from PR #3; the workflow skills are vendored in .claude/skills, so
# no plugin install is needed.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

# npm is canonical (the Dockerfile uses package-lock.json).
# `npm install` rather than `npm ci` so the cached container state is reused.
npm install --no-audit --no-fund

# src/generated/prisma is gitignored; without it ~29 test files fail to
# resolve "@/generated/prisma/client".
npx prisma generate
