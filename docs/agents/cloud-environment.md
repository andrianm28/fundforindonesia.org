# Cloud environment for Claude Code sessions

Every Claude session for this repo runs in a Claude Code cloud session (see
`CLAUDE.md`, "Sesi agent"). The owner configures its environment once at
claude.ai/code: open the cloud icon above the message box, choose **Add cloud
environment**, and select it for this repo's sessions. Reference:
https://code.claude.com/docs/en/cloud-environments.

## Name and network

- **Name:** `FFI`
- **Network access:** **Trusted**. Its default allowlist already covers every
  host this repo needs:
  - `registry.npmjs.org`, for npm;
  - `nodejs.org`, for the Node 24 download;
  - `binaries.prisma.sh`, for Prisma;
  - `ghcr.io` and Docker Hub;
  - `fonts.googleapis.com`.

  GitHub goes through its own proxy. Use **Custom** only when a ticket needs a
  host outside the list, for example Playwright browsers.
- **API credentials:** none. Never put production secrets in this environment:
  - not SMTP;
  - not the `FIELD_*` encryption keys;
  - not the deploy SSH key.

  Anyone using the environment can read its values. Production secrets live
  only in the host's `.env` and the repo's Actions secrets.

## Environment variables

These are placeholders only, mirroring CI:

```text
NEXT_TELEMETRY_DISABLED=1
DATABASE_URL=postgresql://dummy:dummy@localhost:5432/dummy
NEXTAUTH_SECRET=cloud-placeholder-not-a-secret
NEXTAUTH_URL=http://localhost:3000
NEXT_PUBLIC_BASE_URL=https://fundforindonesia.org
NEXT_PUBLIC_DONATIONS_ENABLED=false
MAIL_PROVIDER=mock
NODE_OPTIONS=--max-old-space-size=6144
BASH_DEFAULT_TIMEOUT_MS=300000
BASH_MAX_TIMEOUT_MS=600000
```

- The dummy `DATABASE_URL` makes `src/lib/prisma.ts` use its build-time mock,
  as CI's build job does.
- The timeouts cover the full vitest suite, which takes about 3–4 minutes.
  The default command timeout is 2 minutes.

## Setup script

The script runs as root on Ubuntu 24.04 before Claude starts. Its result is
cached for about 7 days, and it reruns when the script changes. The image
ships Node 20, 21 and 22 only, while the repo requires 24 (`.nvmrc`,
`engines`).

```bash
#!/bin/bash
set -euo pipefail

# Node 24 (repo: .nvmrc=24; the image ships 20/21/22 only). Checksum-verified.
if [ ! -x /opt/node24/bin/node ]; then
  base=https://nodejs.org/dist/latest-v24.x
  sums=$(curl -fsSL "$base/SHASUMS256.txt")
  f=$(echo "$sums" | grep -o 'node-v24[^ ]*-linux-x64\.tar\.xz' | head -1)
  curl -fsSLo "/tmp/$f" "$base/$f"
  (cd /tmp && echo "$sums" | grep " $f\$" | sha256sum -c -)
  mkdir -p /opt/node24 && tar -xJf "/tmp/$f" -C /opt/node24 --strip-components=1
fi
echo 'export PATH=/opt/node24/bin:$PATH' > /etc/profile.d/node24.sh

# Tools for ops/ and workflow tests. gh is not pre-installed in practice
# (checked 2026-09-26, despite the docs); it authenticates through the
# GitHub proxy (GH_TOKEN=proxy-injected), no login needed.
apt-get update -qq && apt-get install -y -qq shellcheck gh || true

# Local Postgres role/db for trying migrations (throwaway, not a secret)
service postgresql start
su postgres -c "psql -tc \"SELECT 1 FROM pg_roles WHERE rolname='ffi'\" | grep -q 1 || psql -c \"CREATE ROLE ffi LOGIN PASSWORD 'ffi' CREATEDB\""
su postgres -c "psql -tc \"SELECT 1 FROM pg_database WHERE datname='ffi'\" | grep -q 1 || createdb -O ffi ffi"
service postgresql stop
```

## What the repo does on every session

`.claude/hooks/session-start.sh`, registered for `startup|resume`, runs in
cloud sessions only:

- it puts `/opt/node24/bin` first on `PATH`, for the hook and, through
  `$CLAUDE_ENV_FILE`, for every command in the session;
- it runs `npm ci` (never rewrites the lockfile), but only when `package-lock.json` or the Node
  version changed;
- it always runs `npx prisma generate`.

To try a migration:

```sh
service postgresql start
DATABASE_URL='postgresql://ffi:ffi@localhost:5432/ffi?schema=public' npx prisma migrate deploy
```

## Check in the first session

- `node -v` prints v24.
- `npx vitest run` is green.
- `58da2c13-5ed4-4485-9625-fb87b369e6b4:tdd` (Skills For Real Engineers plugin,
  enabled on the owner's claude.ai account) is listed; the vendored `/tdd` is
  only a fallback until that is proven.
- `gh pr list` works (else the built-in GitHub tools cover PRs, checks and merges).

If `node -v` still prints v22, the setup script didn't run or
`$CLAUDE_ENV_FILE` didn't apply. Prefix commands with
`PATH=/opt/node24/bin:$PATH` and report it.
