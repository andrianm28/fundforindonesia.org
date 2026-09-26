# Stage 1: Dependencies
FROM node:24-alpine AS deps
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

# Stage 2: Build
FROM node:24-alpine AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Repo ships no static assets; ensure the dir exists for the runner stage COPY
RUN mkdir -p public

# Generate Prisma client
RUN npx prisma generate

# Build-time public values. Next inlines NEXT_PUBLIC_* into the server and
# client bundles during `next build`, so these are fixed per image: changing
# one means building a new image, not restarting a container. cd.yml passes
# them from the repository's Actions variables (see the comment there); the
# defaults are production's values, so a plain `docker build` still matches
# production. They are public by nature. Never pass a secret as a build arg:
# build args are recorded in the image history and the provenance attestation.
#   NEXT_PUBLIC_BASE_URL           canonical public site URL (sitemap, SEO
#                                  metadata, Campaign page, email links); the
#                                  same fallback as src/lib/public-url.ts
#   NEXTAUTH_URL                   the URL next-auth sees during the build; the
#                                  running app takes it from the runtime env
#   NEXT_PUBLIC_DONATIONS_ENABLED  "true" to take real donations, else off
ARG NEXT_PUBLIC_BASE_URL="https://fundforindonesia.org"
ARG NEXTAUTH_URL="https://galang.fundforindonesia.org"
ARG NEXT_PUBLIC_DONATIONS_ENABLED="false"

# Build Next.js. DATABASE_URL and NEXTAUTH_SECRET are placeholders, not
# secrets: a "dummy" URL makes src/lib/prisma.ts use its build-time mock. They
# live in this stage only; the runner stage below starts from a clean base and
# gets the real values from the runtime environment.
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
ENV DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy?schema=public"
ENV NEXTAUTH_SECRET="build-time-placeholder-not-a-secret"
ENV NEXTAUTH_URL=$NEXTAUTH_URL
ENV NEXT_PUBLIC_BASE_URL=$NEXT_PUBLIC_BASE_URL
ENV NEXT_PUBLIC_DONATIONS_ENABLED=$NEXT_PUBLIC_DONATIONS_ENABLED
RUN npm run build

# Stage: migrate (`docker build --target migrate`). A small one-off image that
# runs `prisma migrate deploy` against $DATABASE_URL and exits. The app image
# cannot: its standalone output carries neither the prisma CLI nor
# prisma.config.ts. Rather than ship the whole dependency tree (the deps stage
# is most of a gigabyte), it installs just the two packages the CLI and
# prisma.config.ts need, at the exact versions package-lock.json pins, so it
# migrates with the same Prisma the app was built and CI-tested with.
FROM node:24-alpine AS migrate
WORKDIR /app

COPY package-lock.json /tmp/package-lock.json
RUN versions="$(node -e 'const p = require("/tmp/package-lock.json").packages; console.log(["prisma", "dotenv"].map((n) => n + "@" + p["node_modules/" + n].version).join(" "))')" \
    && npm install --no-save --no-package-lock --no-audit --no-fund $versions \
    && npm cache clean --force \
    && rm /tmp/package-lock.json

# --chown for the same reason the runner chowns public/: COPY keeps the build
# context's modes, and a checkout that is drwxrwx--- would leave the
# migrations unreadable to `node`, the base image's stock unprivileged user.
COPY --chown=node:node prisma ./prisma
COPY --chown=node:node prisma.config.ts ./

USER node

CMD ["node_modules/.bin/prisma", "migrate", "deploy"]

# Stage 3: Production
FROM node:24-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Create non-root user
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Copy necessary files
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder /app/src/generated ./src/generated

# Create uploads directory
RUN mkdir -p public/uploads && chown -R nextjs:nodejs public/uploads

# chown the WHOLE public tree, not just uploads. Next scans public/ recursively
# at startup (recursiveReadDir inside setupFsCheck), so one unreadable
# subdirectory is fatal rather than degraded -- the server exits with
#   EACCES: permission denied, scandir '/app/public/images'
# and the container restart-loops. COPY --from=builder preserves the build
# context's file modes, and this repo's working tree is drwxrwx--- / -rw-rw----
# with no other-read, so any asset directory added to public/ is unreadable to
# the nextjs user (uid 1001, neither owner nor group) unless chowned here.
RUN chown -R nextjs:nodejs public

# sharp, and somewhere writable to keep what it produces.
#
# Both were found in production logs rather than in testing: 37 occurrences of
#   'sharp' is required to be installed in standalone mode for the image
#   optimization to function correctly
# in forty minutes, alongside a steady trickle of
#   EACCES: permission denied, mkdir '/app/.next/cache'
#
# Two separate faults wearing one symptom. Without sharp, next/image cannot
# optimize at all in a standalone build, so every cover and avatar is served at
# full weight -- on a donation site browsed mostly over Indonesian mobile data,
# that cost lands hardest on the people least able to absorb it. And with an
# unwritable .next/cache, whatever optimization does happen is recomputed on
# every request, because the result can never be stored.
#
# The same unwritable .next is why ISR could never refresh the homepage, which
# is now force-dynamic (see the comment in src/app/page.tsx). Fixing the cache
# here does not undo that: a live campaign list should not be a build-time
# snapshot whether or not the cache happens to work.
#
# `npm cache clean` drops the download cache the install leaves in /root/.npm:
# dead weight in every pulled image, and most of the Trivy secret scan's time.
RUN npm install --no-save sharp \
    && npm cache clean --force \
    && mkdir -p .next/cache \
    && chown -R nextjs:nodejs .next node_modules/sharp

USER nextjs

EXPOSE 3000

CMD ["node", "server.js"]
