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

# Repo ships no static assets; ensure the dir exists for the runtime tree below
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

# Assemble the whole runtime tree inside .next/standalone, so the runner takes
# it in a single COPY. The standalone output is all the server needs: Next
# traces the node_modules files it requires at runtime, and webpack bundles
# the Prisma client (src/generated/prisma, its query compiler and the pg
# adapter) into the server chunks, so neither node_modules/@prisma nor
# src/generated has to be copied separately.
#
# Ownership is set here rather than with `chown -R` in the runner, where it
# would store every file a second time in a new layer. COPY --from keeps the
# numeric owner: uid 1001 is the runner's nextjs user, gid 1001 its nodejs group.
#   public/  Next scans it recursively at startup (recursiveReadDir inside
#            setupFsCheck), so one unreadable subdirectory is fatal: the
#            server exits with `EACCES: permission denied, scandir
#            '/app/public/images'` and the container restart-loops. COPY keeps
#            the build context's modes, and a checkout that is drwxrwx--- /
#            -rw-rw---- leaves any asset unreadable to nextjs unless it owns
#            the tree. public/uploads is where uploaded files are written.
#   .next/   writable, because ISR (campaign/[slug] revalidates every 60 s)
#            rewrites pages under .next/server, and next/image keeps its
#            results in .next/cache. Found in production logs, not testing: an
#            unwritable .next gave a steady trickle of `EACCES: permission
#            denied, mkdir '/app/.next/cache'`, recomputed every optimized
#            image on every request, and kept ISR from ever refreshing a page.
#            (The homepage is force-dynamic regardless; see src/app/page.tsx.)
# The rest (server.js, node_modules) stays root-owned: the app has no reason
# to rewrite its own code.
RUN cp -r public .next/standalone/public \
    && cp -r .next/static .next/standalone/.next/static \
    && mkdir -p .next/standalone/public/uploads .next/standalone/.next/cache \
    && chown -R 1001:1001 .next/standalone/public .next/standalone/.next

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

# Stage: sharp. next/image needs sharp to optimize at all in a standalone
# build. It was found missing in production logs, not in testing: 37
# occurrences of
#   'sharp' is required to be installed in standalone mode for the image
#   optimization to function correctly
# in forty minutes. Without it every cover and avatar is served at full
# weight, on a donation site browsed mostly over Indonesian mobile data.
# (The optimizer is off until the Next upgrade, ticket 15, see next.config.mjs;
# sharp stays so that turning it back on needs no image change.)
#
# It is installed here, alone, rather than with `npm install sharp` in the
# runner: there, npm reified the whole package.json tree next to it (next's
# SWC compiler, prisma's CLI and studio, typescript, …), most of a gigabyte.
# Its own directory also keeps its dependencies from overwriting the
# standalone node_modules. The base image is the runner's, so npm fetches the
# prebuilt binaries for the image's platform (linuxmusl, amd64 or arm64). The
# version is exact, not whatever is latest at build time; bump it here.
FROM node:24-alpine AS sharp
WORKDIR /opt/sharp
ARG SHARP_VERSION="0.35.4"
RUN npm install --no-save --no-package-lock --no-audit --no-fund sharp@$SHARP_VERSION \
    && npm cache clean --force

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

# Everything the server runs from, assembled and owned in the builder stage.
COPY --from=builder /app/.next/standalone ./

# sharp, outside /app/node_modules; next/image requires it from this path.
COPY --from=sharp /opt/sharp/node_modules /opt/sharp/node_modules
ENV NEXT_SHARP_PATH=/opt/sharp/node_modules/sharp

USER nextjs

EXPOSE 3000

CMD ["node", "server.js"]
